// 迭代生成工具:AI 生成草稿(不保存)→ 用户看 → 满意保存 / 不满意给修改意见继续迭代
import type { CommandContext } from "./types.ts"
import { chat } from "./llm.ts"
import { withBusy } from "./ui.ts"
import { ensureModelConfigured } from "./commands/manage.ts"

export interface GenOptions {
  temperature?: number
  // 附加约束(如"参考已有世界观设定")
  constraints?: string
}

export async function genIterate(
  ctx: CommandContext,
  kind: string, // 如"人物档案""场景""世界观条目"
  initialDesc: string,
  save: (draft: string) => string | null, // 保存草稿,返回文件名(或 null)
  opts?: GenOptions,
): Promise<void> {
  if (!(await ensureModelConfigured(ctx))) return
  let desc = initialDesc
  let lastDraft = ""
  let round = 0
  for (;;) {
    round++
    console.log(`🔍 AI 生成${kind}(第 ${round} 轮)…`)
    const prompt = [
      `你是小说设定助手,为《${ctx.config.name}》生成/完善${kind}。`,
      `原始要求:${initialDesc}`,
      round > 1 ? `上一版:\n${lastDraft}` : "",
      round > 1 ? `用户修改意见:${desc}` : `用户描述:${desc}`,
      round > 1
        ? "请根据上一版和修改意见重新生成完整的新版本(不要只输出改动部分)。必须严格保持原始要求与人物一致性:身份/外貌/性格/动机/初始设定等不要更换,只按修改意见调整,不得偏离原始设定或擅自改变风格。"
        : "",
      opts?.constraints ? `附加要求:${opts.constraints}` : "",
      kind === "人物档案" ? "重点描述外貌与性格:外貌要有具体细节(体型/五官/衣着/气色/习惯动作),性格要写多个侧面并给出具体表现,不要泛泛而谈。" : "",
      "要求:精练、具体、有画面感,可直接用于写作;用 Markdown 格式输出。",
    ]
      .filter(Boolean)
      .join("\n")
    const draft = await withBusy(`🔍 AI 生成${kind}(第 ${round} 轮)`, (signal) =>
      chat(ctx.config.model, [{ role: "user", content: prompt }], { temperature: opts?.temperature ?? 0.7, signal }),
    )
    if (draft === null) {
      console.log("⏹ 已打断(未保存)")
      return
    }
    lastDraft = draft
    console.log("\n" + draft.trim() + "\n")
    const ans = await ctx.ask(`这个${kind}满意吗?[y=保存 / n=放弃 / 输入修改意见继续迭代 / q=取消]:`)
    const a = ans.trim()
    if (a === "" || a.toLowerCase() === "q") {
      console.log("已取消(未保存)")
      return
    }
    if (a.toLowerCase() === "y") {
      const name = save(draft)
      console.log(name ? `✅ 已保存${kind}\n📄 微调:${name}` : `✅ 已保存${kind}`)
      return
    }
    if (a.toLowerCase() === "n") {
      console.log("已放弃(未保存)")
      return
    }
    desc = a // 修改意见 → 下一轮迭代
  }
}

// 从草稿提取 Markdown 标题(# 或 ## 后的文本)作为候选文件名
export function extractTitle(draft: string): string {
  const m = draft.match(/^#{1,2}\s+(.+)$/m)
  return m ? m[1].trim() : ""
}

// 质量与工具:/check(检查) /reader(读者) /export(导出) /stats(统计) /summary(摘要) /search(搜索)
import path from "path"
import { existsSync } from "fs"
import type { Command, CommandContext } from "../types.ts"
import { p } from "../types.ts"
import {
  listChapters,
  listVault,
  listTimeline,
  chapterWords,
  chapterMeta,
  readChapter,
  volOf,
  volRange,
  listVolSummaries,
  readVolSummary,
  writeVolSummary,
  searchChapters,
} from "../novel.ts"
import { chat } from "../llm.ts"
import { withBusy } from "../ui.ts"
import { buildReviewContext } from "../context.ts"
import { splitOp } from "../op.ts"
import { pickOp } from "../menu.ts"
import { ensureModelConfigured } from "./manage.ts"

export const checkCmd: Command = {
  name: "check",
  aliases: ["检查"],
  description: "一致性检查(规则引擎);--deep 追加 AI 深度校验",
  usage: "/check(检查) [--deep]",
  handler: async (ctx: CommandContext, args: string) => {
    const deep = args.includes("--deep")
    console.log("📋 规则引擎检查:")
    // 1. 时间线
    const tl = listTimeline(ctx.root)
    if (tl.length === 0) console.log("  ⏳ 时间线:暂无记录")
    else console.log(`  ⏳ 时间线:${tl.length} 条记录,当前时间点「${ctx.config.currentTime}」`)
    // 2. 伏笔
    const vault = listVault(ctx.root)
    const open = vault.filter((v) => v.status !== "已回收")
    if (vault.length === 0) console.log("  📌 伏笔:台账为空")
    else {
      console.log(`  📌 伏笔:共 ${vault.length} 条,未回收 ${open.length} 条`)
      for (const v of open) console.log(`      - ${v.name}(埋设于 ${v.chapter},计划回收:${v.plan || "未定"})`)
    }
    // 3. 章节
    const chapters = listChapters(ctx.root)
    const cur = Math.min(Math.max(ctx.config.currentChapter ?? 1, 1), Math.max(chapters.length, 1))
    console.log(`  📚 章节:共 ${chapters.length} 章,当前定位第 ${cur} 章`)
    // 4. 章节元数据完整性
    const noMeta = chapters.filter((f) => {
      const m = chapterMeta(ctx.root, f)
      return !m.time || !m.chars || m.chars === "[]"
    })
    if (noMeta.length > 0) {
      console.log(`  ⚠️  章节元数据待补(时间/出场人物):${noMeta.join(", ")}`)
      console.log("     建议编辑章节头部 --- 区域,/time(时间线) 添加 记录时间点")
    } else {
      console.log("  ✅ 章节元数据完整")
    }
    console.log("\n(规则检查完成)")

    if (deep) {
      if (!(await ensureModelConfigured(ctx))) return
      console.log("🔍 AI 深度校验中…")
      try {
        const task =
          "请审阅最近章节,检查:1)人物设定是否崩坏(与档案矛盾) 2)时间线是否错乱 3)战力/能力是否失衡 4)伏笔是否提前揭露或遗漏。输出问题清单和修改建议。"
        const messages = buildReviewContext(ctx, task)
        const result = await withBusy("🔍 AI 深度校验中", (signal) => chat(ctx.config.model, messages, { temperature: 0.3, signal }))
        if (result === null) {
          console.log("⏹ 已打断")
          return
        }
        console.log("\n" + result + "\n")
      } catch (e) {
        console.log(`❌ ${(e as Error).message}`)
      }
    }
  },
}

export const readerCmd: Command = {
  name: "reader",
  aliases: ["读者"],
  description: "AI 模拟读者反馈(毒点/节奏/断章评估)",
  usage: "/读者",
  handler: async (ctx: CommandContext, args: string) => {
    const chapters = listChapters(ctx.root)
    if (chapters.length === 0) return console.log("还没有章节可读,先 /write(写作) 写几章")
    if (!(await ensureModelConfigured(ctx))) return
    console.log(`👁  AI 读者正在阅读最近 ${Math.min(3, chapters.length)} 章…`)
    try {
      const task =
        "你是一名追更的网文读者。请对最近章节给出:1)整体观感 2)爽点/毒点(如有) 3)节奏问题 4)断章位置是否抓人 5)下一章你会期待什么。口语化,像真实读者。"
      const messages = buildReviewContext(ctx, task)
      const result = await withBusy("👁 AI 读者分析中", (signal) => chat(ctx.config.model, messages, { temperature: 0.8, signal }))
      if (result === null) {
        console.log("⏹ 已打断")
        return
      }
      console.log("\n" + result + "\n")
    } catch (e) {
      console.log(`❌ ${(e as Error).message}`)
    }
  },
}

export const exportCmd: Command = {
  name: "export",
  aliases: ["导出"],
  description: "导出作品:无参数 = 选择格式;md/txt",
  usage: "/export(导出) [md|txt]",
  handler: async (ctx: CommandContext, args: string) => {
    let fmt = args.trim()
    if (!fmt) {
      const f = await pickOp(ctx, "导出格式(↑↓ 移动 · 回车 选择 · Esc 返回):", [
        { value: "md", label: "md", description: "Markdown" },
        { value: "txt", label: "txt", description: "纯文本" },
      ])
      if (!f) return
      fmt = f
    }
    if (fmt !== "md" && fmt !== "txt") return console.log("用法:/export(导出) [md|txt]")
    const chapters = listChapters(ctx.root)
    if (chapters.length === 0) return console.log("还没有章节可导出")
    const lines: string[] = [`《${ctx.config.name}》`, `=`.repeat(ctx.config.name.length + 2), ""]
    for (const f of chapters) {
      const meta = chapterMeta(ctx.root, f)
      lines.push(`\n${fmt === "md" ? "## " : ""}${meta.title ?? f}`, "")
      const text = (await Bun.file(path.join(ctx.root, "章节", f)).text().catch(() => "")) ?? ""
      const body = text.replace(/^---\n[\s\S]*?\n---\n/, "").trim()
      lines.push(body, "")
    }
    const outFile = path.join(ctx.root, `export-${(ctx.config.name ?? "novel").replace(/[\\/:*?"<>|]/g, "_")}.${fmt}`)
    await Bun.write(outFile, lines.join("\n"))
    console.log(`✅ 已导出 ${outFile}(${chapters.length} 章)`)
  },
}

export const statsCmd: Command = {
  name: "stats",
  aliases: ["统计"],
  description: "写作统计:字数/章节",
  usage: "/统计",
  handler: async (ctx: CommandContext) => {
    const stats = chapterWords(ctx.root)
    if (stats.length === 0) return console.log("还没有章节")
    const total = stats.reduce((s, x) => s + x.words, 0)
    console.log(`📊 全书字数:${total} | 章节数:${stats.length} | 均章:${Math.round(total / stats.length)}字`)
    console.log("\n各章:")
    for (const s of stats) console.log(`  ${s.file} | ${s.words} 字`)
  },
}

export const summaryCmd: Command = {
  name: "summary",
  aliases: ["摘要"],
  description: "卷摘要管理:无参数 = 操作菜单;生成/查看/全部(记忆金字塔)",
  usage: "/summary(摘要) [生成|查看|全部]",
  examples: ["/summary(摘要) 生成", "/summary(摘要) 查看", "/summary(摘要) 全部"],
  handler: async (ctx: CommandContext, args: string) => {
    const { op } = splitOp(args)
    if (!op) {
      const act = await pickOp(ctx, "卷摘要操作(↑↓ 移动 · 空格/回车 选择 · Esc 返回):", [
        { value: "gen", label: "生成摘要", description: "AI 浓缩本卷剧情" },
        { value: "view", label: "查看摘要", description: "当前卷摘要" },
        { value: "all", label: "全部摘要", description: "列出所有卷" },
      ])
      if (!act) return
      await summaryCmd.handler(ctx, act)
      return
    }
    const op2 = op || "view"
    const chapters = listChapters(ctx.root)
    if (chapters.length === 0) return console.log("还没有章节")
    const curNum = chapters.length
    const vol = volOf(curNum)
    if (op2 === "gen") {
      const r = volRange(vol)
      const inVol = chapters.filter((f) => {
        const n = Number(f.replace(/\D/g, "")) || 0
        return n >= r.start && n <= r.end
      })
      if (inVol.length === 0) return console.log("当前卷还没有章节")
      if (!(await ensureModelConfigured(ctx))) return
      console.log(`🔍 正在为第 ${r.start}-${Math.min(r.end, curNum)} 章(卷${vol})生成摘要…`)
      try {
        const body = inVol
          .map((f) => `### ${f}\n${readChapter(ctx.root, f) ?? ""}`)
          .join("\n")
          .slice(0, 20000)
        const prompt = `以下是小说章节,请生成卷摘要:1)本卷主要剧情线 2)关键事件与转折 3)出场人物及状态变化 4)埋下的伏笔 5)本卷结尾状态。精炼中文要点,300-500字:`
        const result = await withBusy(`🔍 卷${vol} 摘要生成中`, (signal) =>
          chat(ctx.config.model, [{ role: "user", content: prompt + "\n\n" + body }], { temperature: 0.3, signal }),
        )
        if (result === null) {
          console.log("⏹ 已打断")
          return
        }
        writeVolSummary(ctx.root, vol, result.trim())
        console.log(`✅ 卷${vol} 摘要已写入,此后写作会自动注入该摘要\n📄 微调:${p(ctx, `摘要/vol${vol}.md`)}`)
      } catch (e) {
        console.log(`❌ ${(e as Error).message}`)
      }
      return
    }
    if (op2 === "all") {
      const all = listVolSummaries(ctx.root)
      if (all.length === 0) return console.log("还没有卷摘要,/summary(摘要) 生成 生成")
      for (const s of all) console.log(`【卷${s.vol}】\n${s.text.trim().slice(0, 400)}${s.text.trim().length > 400 ? "…" : ""}\n`)
      return
    }
    // 查看
    const sum = readVolSummary(ctx.root, vol)
    if (sum) {
      console.log(`【卷${vol} 摘要】\n${sum.trim()}`)
    } else {
      console.log(`卷${vol} 还没有摘要。运行 /summary(摘要) 生成 生成(之后写作时自动注入,防止 AI 遗忘早期剧情)`)
    }
  },
}

export const searchCmd: Command = {
  name: "search",
  aliases: ["搜索"],
  description: "全文检索:查找关键词在哪些章节出现(带上下文)",
  usage: "/search(搜索) <关键词>",
  examples: ["/search(搜索) 玉佩", "/search(搜索) 沈无涯"],
  handler: async (ctx: CommandContext, args: string) => {
    let kw = args.trim()
    if (!kw) {
      kw = (await ctx.askCancellable("关键词(回车 = 取消):"))?.trim() ?? ""
      if (!kw) return
    }
    const hits = searchChapters(ctx.root, kw, 10)
    if (hits.length === 0) {
      console.log(`未找到「${kw}」`)
      return
    }
    console.log(`🔍 「${kw}」出现于 ${hits.length} 处:`)
    for (const h of hits) console.log(`  ${h.file}: ${h.line}`)
    console.log("\n提示:写作指令里写 [查:关键词] 可让 AI 写作前自动检索相关内容")
  },
}

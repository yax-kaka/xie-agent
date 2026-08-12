// 上下文组装器 v0.3:记忆金字塔(当前章→近章→卷摘要→前卷梗概)+ 出场人物动态注入 + 全文检索
import type { NovelConfig } from "./config.ts"
import type { ChatMessage } from "./llm.ts"
import {
  listChapters,
  readChapter,
  chapterMeta,
  listCharacters,
  readCharacter,
  readStyle,
  listWorld,
  readWorld,
  listTimeline,
  listVault,
  readGrowth,
  readOutline,
  chapterPlan,
  volOf,
  volRange,
  listVolSummaries,
  readVolSummary,
  searchChapters,
  readScene,
} from "./novel.ts"

export interface WriteCtx {
  root: string
  config: NovelConfig
}

// 解析章节 YAML chars 字段:[林晚, 沈无涯] 或 "林晚, 沈无涯"
function parseChars(raw: string | undefined): string[] {
  if (!raw || raw === "[]" || raw === "") return []
  return raw
    .replace(/[\[\]"']/g, "")
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function buildWritingContext(
  ctx: WriteCtx,
  instruction: string,
  opts?: { chapter?: string; lastOutput?: string; scene?: string; chars?: string[] },
): ChatMessage[] {
  const { root, config } = ctx
  const parts: string[] = []
  const chapters = listChapters(root)
  const targetChapter =
    opts?.chapter ??
    (chapters.length > 0
      ? chapters[Math.min(chapters.length - 1, Math.max((config.currentChapter ?? 1) - 1, 0))]
      : "")
  const targetNum = targetChapter ? Number(targetChapter.replace(/\D/g, "")) || 0 : 0
  const vol = volOf(targetNum || chapters.length || 1)

  parts.push(`你是小说写作助手,正在创作《${config.name}》。面向中文网文读者,保持人物设定与时间线一致。`)
  parts.push(`当前剧情时间点:${config.currentTime ?? "未知"}`)

  // 固定层:风格指南
  const style = readStyle(root)
  if (style.trim()) parts.push(`【风格指南】\n${style.trim()}`)

  // 固定层:总纲 + 章节大纲
  const outline = readOutline(root)
  if (outline.trim().split("\n").length > 2) parts.push(`【总纲】\n${outline.trim()}`)
  const plans = chapterPlan(root)
  const plan = plans.find((p) => p.num === targetNum)
  if (plan) parts.push(`【本章大纲】\n第${plan.num}章 ${plan.title}${plan.content ? `:${plan.content}` : ""}`)

  // 记忆金字塔第 1 层:目标章节全文(超长时截断:开头锚点 500 字 + 最近 4000 字)
  if (targetChapter) {
    let curText = readChapter(root, targetChapter) ?? ""
    if (curText.length > 4500) {
      curText = curText.slice(0, 500) + "\n…(中段省略,共" + curText.length + "字)…\n" + curText.slice(-4000)
    }
    parts.push(`【当前章节 ${targetChapter}】\n${curText}`)
  } else {
    parts.push("【当前章节】暂无章节,请先用 /写作 创建章节")
  }

  // 记忆金字塔第 2 层:近 2 章全文(不含目标章)
  const others = chapters.filter((f) => f !== targetChapter).slice(-2)
  if (others.length > 0) {
    parts.push(`【前情提要(最近章节)】\n${others.map((f) => `### ${f}\n${readChapter(root, f) ?? ""}`).join("\n")}`)
  }

  // 记忆金字塔第 3 层:本卷摘要
  const volSum = readVolSummary(root, vol)
  if (volSum) {
    const r = volRange(vol)
    parts.push(`【本卷摘要(第${r.start}-${Math.min(r.end, targetNum || 9999)}章)】\n${volSum.trim()}`)
  }

  // 记忆金字塔第 4 层:前卷梗概(近 2 卷全文摘要 + 更早卷浓缩)
  const prevVols = listVolSummaries(root).filter((s) => s.vol < vol)
  if (prevVols.length > 0) {
    const recent = prevVols.slice(-2)
    const older = prevVols.slice(0, -2)
    let text = recent.map((s) => `【卷${s.vol}】${s.text.trim().slice(0, 800)}`).join("\n")
    if (older.length > 0) {
      text += `\n【更早卷浓缩】${older.map((s) => `卷${s.vol}:${s.text.trim().slice(0, 150)}`).join(" ")}`
    }
    parts.push(`【前卷梗概】\n${text}`)
  } else if (vol > 1) {
    parts.push(`【前卷梗概】卷 ${vol - 1} 尚未生成摘要,可运行 /摘要 生成 生成`)
  }

  // 按需层:本章场景(优先用 opts.scene 临时场景;否则读章节 location 对应的持久场景)
  const meta = targetChapter ? chapterMeta(root, targetChapter) : {}
  let sceneText: string | undefined
  if (opts?.scene) {
    sceneText = opts.scene
    parts.push(`【本章场景(临时,不保存)】\n${sceneText}`)
  } else {
    const loc = (meta.location ?? "").trim()
    if (loc !== "") {
      const scene = readScene(root, loc)
      sceneText = scene ? `${loc}:\n${scene}` : loc
      parts.push(`【本章场景】\n${sceneText}`)
    }
  }

  // 按需层:出场人物动态注入(优先 opts.chars,否则读目标章节 YAML chars;为空则回退前 3 个人物)
  let chars = opts?.chars ?? parseChars(meta.chars)
  if (chars.length === 0) chars = listCharacters(root).slice(0, 3).map((c) => c.replace(/\.md$/, ""))
  if (chars.length > 0) {
    parts.push(
      `【出场人物档案】\n${chars
        .map((c) => `--- ${c} ---\n${readCharacter(root, c) ?? "(暂无档案)"}`)
        .join("\n")}`,
    )
  }

  // 按需层:世界观(前 5 条)
  const world = listWorld(root).slice(0, 5)
  if (world.length > 0) {
    parts.push(`【世界观设定】\n${world.map((w) => `--- ${w} ---\n${readWorld(root, w) ?? ""}`).join("\n")}`)
  }

  // 按需层:时间线(最近 5 条)
  const tl = listTimeline(root).slice(-5)
  if (tl.length > 0) {
    parts.push(`【剧情时间线(最近)】\n${tl.map((r) => `- ${r.join(" | ")}`).join("\n")}`)
  }

  // 按需层:未回收伏笔
  const vault = listVault(root).filter((v) => v.status !== "已回收")
  if (vault.length > 0) {
    parts.push(
      `【未回收伏笔(写作时注意铺垫,不要提前揭露)】\n${vault
        .map((v) => `- ${v.name}(埋设于${v.chapter},计划回收:${v.plan || "未定"})`)
        .join("\n")}`,
    )
  }

  // 按需层:主角成长
  const growth = readGrowth(root)
  if (growth.trim().split("\n").length > 2) parts.push(`【主角成长记录】\n${growth.trim()}`)

  // 按需层:[查:关键词] 全文检索注入
  const qm = instruction.matchAll(/\[查:([^\]]+)\]/g)
  for (const m of qm) {
    const hits = searchChapters(root, m[1].trim(), 3)
    if (hits.length > 0) {
      parts.push(`【检索:${m[1].trim()}】\n${hits.map((h) => `- ${h.file}: ${h.line}`).join("\n")}`)
    }
  }

  // 批量衔接:上一章 AI 输出结尾
  if (opts?.lastOutput) {
    parts.push(`【上一章结尾(本章开头需自然衔接)】\n${opts.lastOutput.slice(-300)}`)
  }

  parts.push(`【写作指令】\n${instruction}`)
  parts.push("要求:直接输出正文,不要解释;保持风格一致,章末留钩子;对话符合人物设定;单章 2000-4000 字。")
  return [{ role: "system", content: parts.join("\n\n") }]
}

// 校验类任务上下文(供 /check --deep 与 /reader 使用)
export function buildReviewContext(ctx: WriteCtx, task: string): ChatMessage[] {
  const { root, config } = ctx
  const parts: string[] = []
  parts.push(`你是资深网文编辑,正在审阅《${config.name}》。`)
  const chapters = listChapters(root)
  const recent = chapters.slice(-3)
  if (recent.length > 0) {
    parts.push(`【最近章节】\n${recent.map((f) => `### ${f}\n${readChapter(root, f) ?? ""}`).join("\n")}`)
  }
  const chars = listCharacters(root).slice(0, 8)
  if (chars.length > 0) {
    parts.push(`【人物档案】\n${chars.map((c) => `--- ${c} ---\n${readCharacter(root, c) ?? ""}`).join("\n")}`)
  }
  const tl = listTimeline(root).slice(-10)
  if (tl.length > 0) parts.push(`【时间线】\n${tl.map((r) => `- ${r.join(" | ")}`).join("\n")}`)
  const vault = listVault(root)
  if (vault.length > 0) parts.push(`【伏笔台账】\n${vault.map((v) => `- ${v.name} | ${v.chapter} | ${v.status}`).join("\n")}`)
  parts.push(`【任务】\n${task}`)
  parts.push("用中文输出,给出具体问题和修改建议,不要泛泛而谈。")
  return [{ role: "system", content: parts.join("\n\n") }]
}

// AI 意图路由(参考 opencode 的 agent 工具调用):
// 自由文本 → 让模型从工具注册表里选工具(JSON 数组)→ 回车确认 → 交互补齐缺参 → 执行。
// 无 key/测试桩/调用失败时回退到内置规则表;仍未命中则交给写作流程。
import type { CommandContext } from "./types.ts"
import { chat, isMockMode, resolveApiKey } from "./llm.ts"
import { withBusy } from "./ui.ts"
import { TOOLS, toolById } from "./tools.ts"

export interface ToolCall {
  tool: string
  args: Record<string, string>
}

function buildPrompt(text: string): string {
  const toolList = TOOLS.map((t) => ({
    tool: t.id,
    label: t.label,
    params: Object.fromEntries(t.params.map((q) => [q.name, { required: q.required, desc: q.desc }])),
  }))
  return [
    "你是 xie-agent(小说写作助手)的意图调度器。",
    "用户输入可能是写作指令,也可能是对作品的操作请求。可调用工具(JSON):",
    JSON.stringify(toolList, null, 1),
    "规则:",
    '1) 明确的操作请求 → 输出 JSON 数组,如 [{"tool":"char_add","args":{"name":"林晚","desc":"黑发剑客"}}],可一次调用多个工具。',
    "2) 写作指令(续写、情节推进、场景描写等)→ 输出 []。",
    "3) 无法判断 → 输出 []。",
    '文件工具(read_file/write_file/append_file/list_files)的 file/dir 用相对作品目录的路径,如 "人物/林晚.md"。',
    "只输出 JSON,不要解释、不要 Markdown 代码块。",
    `用户输入:${text}`,
  ].join("\n")
}

export function parseToolCalls(out: string): ToolCall[] {
  const s = out.trim()
  const start = s.indexOf("[")
  const end = s.lastIndexOf("]")
  if (start === -1 || end <= start) return []
  try {
    const data = JSON.parse(s.slice(start, end + 1))
    const arr = Array.isArray(data) ? data : [data]
    const calls: ToolCall[] = []
    for (const item of arr) {
      if (!item || typeof item.tool !== "string" || !toolById(item.tool)) continue
      const args: Record<string, string> = {}
      if (item.args && typeof item.args === "object") {
        for (const [k, v] of Object.entries(item.args)) {
          if (typeof v === "string" || typeof v === "number") args[k] = String(v)
        }
      }
      calls.push({ tool: item.tool, args })
    }
    return calls
  } catch {
    return []
  }
}

// ---------- 回退规则(无 key/测试桩/模型失败时使用) ----------
interface Rule {
  re: RegExp
  tool: string
  args: (m: RegExpMatchArray) => Record<string, string>
}

const P = "^(?:\u5e2e\u6211|\u8bf7|\u6211\u60f3|\u60f3\u8981|\u9ebb\u70e6)?" // 帮我/请/我想/想要/麻烦

const RULES: Rule[] = [
  { re: new RegExp(P + "(?:\u65b0\u5efa|\u521b\u5efa|\u6dfb\u52a0|\u65b0\u589e)(?:\u4e00\u4e2a)?(?:\u89d2\u8272|\u4eba\u7269)\\s*([^\u3001\uff0c,\uff0c\u3001\\s]+)?(?:[\uff0c,\u3001\\s]+(.*))?"), tool: "char_add", args: (m) => ({ name: m[1] ?? "", desc: m[2] ?? "" }) },
  { re: new RegExp(P + "(?:\u65b0\u5efa|\u521b\u5efa|\u6dfb\u52a0|\u65b0\u589e)(?:\u4e00\u4e2a)?(?:\u573a\u666f|\u5730\u70b9)\\s*([^\u3001\uff0c,\u3001\\s]+)?(?:[\uff0c,\u3001\\s]+(.*))?"), tool: "scene_add", args: (m) => ({ name: m[1] ?? "", desc: m[2] ?? "" }) },
  { re: new RegExp(P + "(?:\u65b0\u5efa|\u521b\u5efa|\u6dfb\u52a0|\u65b0\u589e)(?:\u4e00\u4e2a)?(?:\u4e16\u754c\u89c2|\u8bbe\u5b9a)\u6761\u76ee?\\s*([^\u3001\uff0c,\u3001\\s]+)?(?:[\uff0c,\u3001\\s]+(.*))?"), tool: "world_add", args: (m) => ({ name: m[1] ?? "", content: m[2] ?? "" }) },
  { re: new RegExp(P + "(?:生成|写一个)(?:角色|人物)\s*(.*)?"), tool: "char_gen", args: (m) => ({ desc: m[1] ?? "" }) },
  { re: new RegExp(P + "(?:生成|写一个)(?:场景|地点)\s*(.*)?"), tool: "scene_gen", args: (m) => ({ desc: m[1] ?? "" }) },
  { re: new RegExp(P + "(?:生成|写一个)(?:世界观|设定)\s*(.*)?"), tool: "world_gen", args: (m) => ({ desc: m[1] ?? "" }) },
  { re: new RegExp(P + "(?:生成|规划|写一个)(?:一下)?大纲\s*(.*)?"), tool: "outline_gen", args: (m) => ({ content: m[1] ?? "" }) },

  { re: new RegExp(P + "(?:\u67e5\u770b|\u770b\u770b|\u770b\u4e0b|\u67e5\u4e00\u4e0b)(?:\u89d2\u8272|\u4eba\u7269)([^\u3001\uff0c,\u3001\\s]*)?"), tool: "char_view", args: (m) => ({ name: m[1] ?? "" }) },
  { re: new RegExp(P + "(?:\u67e5\u770b|\u770b\u770b|\u770b\u4e0b|\u67e5\u4e00\u4e0b)(?:\u573a\u666f|\u5730\u70b9)([^\u3001\uff0c,\u3001\\s]*)?"), tool: "scene_view", args: (m) => ({ name: m[1] ?? "" }) },
  { re: new RegExp(P + "(?:\u67e5\u770b|\u770b\u770b|\u770b\u4e0b|\u67e5\u4e00\u4e0b)(?:\u4e16\u754c\u89c2|\u8bbe\u5b9a)([^\u3001\uff0c,\u3001\\s]*)?"), tool: "world_view", args: (m) => ({ name: m[1] ?? "" }) },
  { re: new RegExp(P + "(?:列出|看看有哪些|有哪些)(?:角色|人物)"), tool: "char_list", args: () => ({}) },
  { re: new RegExp(P + "(?:列出|看看有哪些|有哪些)(?:场景|地点)"), tool: "scene_list", args: () => ({}) },
  { re: new RegExp(P + "(?:列出|看看有哪些|有哪些)(?:世界观|设定)"), tool: "world_list", args: () => ({}) },
  { re: /^(?:角色|人物)列表$/, tool: "char_list", args: () => ({}) },
  { re: /^(?:场景|地点)列表$/, tool: "scene_list", args: () => ({}) },
  { re: /^(?:世界观|设定)列表$/, tool: "world_list", args: () => ({}) },

  { re: new RegExp(P + "(?:\u5220\u9664|\u79fb\u9664|\u5220\u6389)(?:\u89d2\u8272|\u4eba\u7269)([^\u3001\uff0c,\u3001\\s]*)?"), tool: "char_del", args: (m) => ({ name: m[1] ?? "" }) },
  { re: new RegExp(P + "(?:\u5220\u9664|\u79fb\u9664|\u5220\u6389)(?:\u573a\u666f|\u5730\u70b9)([^\u3001\uff0c,\u3001\\s]*)?"), tool: "scene_del", args: (m) => ({ name: m[1] ?? "" }) },
  { re: new RegExp(P + "(?:\u5220\u9664|\u79fb\u9664|\u5220\u6389)(?:\u4e16\u754c\u89c2|\u8bbe\u5b9a)([^\u3001\uff0c,\u3001\\s]*)?"), tool: "world_del", args: (m) => ({ name: m[1] ?? "" }) },

  { re: new RegExp(P + "(?:\u628a|\u5c06)([^\u3001\uff0c,\u3001\\s]+)(?:\u89d2\u8272|\u4eba\u7269)?(?:\u6539\u6210|\u6539\u4e3a|\u4fee\u6539\u6210|\u8c03\u6574\u4e3a|\u66f4\u65b0\u4e3a)(.*)"), tool: "char_edit", args: (m) => ({ name: m[1] ?? "", instruction: m[2] ?? "" }) },
  { re: new RegExp(P + "(?:\u628a|\u5c06)([^\u3001\uff0c,\u3001\\s]+)(?:\u573a\u666f|\u5730\u70b9)?(?:\u6539\u6210|\u6539\u4e3a|\u4fee\u6539\u6210|\u8c03\u6574\u4e3a|\u66f4\u65b0\u4e3a)(.*)"), tool: "scene_edit", args: (m) => ({ name: m[1] ?? "", instruction: m[2] ?? "" }) },
  { re: new RegExp(P + "(?:\u4fee\u6539|\u66f4\u65b0|\u8c03\u6574)(?:\u4e16\u754c\u89c2|\u8bbe\u5b9a)([^\u3001\uff0c,\u3001\\s]*)(?:[\uff0c,\u3001\\s]+(.*))?"), tool: "world_edit", args: (m) => ({ name: m[1] ?? "", instruction: m[2] ?? "" }) },

  { re: new RegExp(P + "(?:\u65b0\u5efa|\u521b\u5efa|\u65b0\u589e)(?:\u4e00\u4e2a)?(?:\u7ae0\u8282|\u7ae0)\\s*(.*)?"), tool: "chapter_new", args: (m) => ({ title: m[1] ?? "" }) },
  { re: new RegExp(P + "(?:\u8bbe\u7f6e|\u6539\u6210|\u8c03\u6574)(?:\u5199\u4f5c)?\u98ce\u683c\\s*(.*)?"), tool: "style_set", args: (m) => ({ desc: m[1] ?? "" }) },
  { re: new RegExp(P + "(?:\u6dfb\u52a0|\u8bb0|\u5199|\u65b0\u589e)(?:\u4e00\u6761)?\u5927\u7eb2\\s*(.*)?"), tool: "outline_add", args: (m) => ({ content: m[1] ?? "" }) },
  { re: new RegExp(P + "(?:\u6dfb\u52a0|\u8bb0|\u5199)(?:\u4e00\u6761)?\u65f6\u95f4\u7ebf\\s*(.*)?"), tool: "time_add", args: (m) => ({}) },
  { re: new RegExp(P + "(?:\u6dfb\u52a0|\u8bb0)(?:\u4e00\u6761)?\u6210\u957f\\s*(.*)?"), tool: "growth_add", args: (m) => ({ stage: m[1] ?? "" }) },
  { re: new RegExp(P + "(?:\u57cb|\u6dfb\u52a0|\u8bb0)(?:\u4e00\u4e2a)?\u4f0f\u7b14\\s*([^\u3001\uff0c,\u3001\\s]+)?(?:[\uff0c,\u3001\\s]+(.*))?"), tool: "vault_add", args: (m) => ({ name: m[1] ?? "", plan: m[2] ?? "" }) },
  { re: new RegExp(P + "(?:\u8bb0|\u5b58|\u6dfb\u52a0)(?:\u4e00\u6761)?\u7075\u611f\\s*(.*)?"), tool: "idea_add", args: (m) => ({ content: m[1] ?? "" }) },

  { re: new RegExp(P + "(?:\u641c\u7d22|\u67e5\u627e|\u641c\u4e00\u4e0b|\u627e\u4e00\u4e0b)\\s*(.*)?"), tool: "search", args: (m) => ({ keyword: m[1] ?? "" }) },
  { re: new RegExp(P + "(?:\u68c0\u67e5|\u6821\u9a8c)(?:\u4e00\u4e0b|\u5168\u6587|\u4f5c\u54c1|\u4e0b)?$"), tool: "check", args: () => ({}) },
  { re: new RegExp(P + "(?:\u8bfb\u8005|\u8bfb\u540e|\u9605\u8bfb\u53cd\u9988)(?:\u53cd\u9988)?$"), tool: "reader", args: () => ({}) },
  { re: new RegExp(P + "(?:\u751f\u6210|\u5199)?(?:\u5377)?\u6458\u8981(?:[\u751f\u6210\uff1f?])?$"), tool: "summary_gen", args: () => ({}) },
  { re: new RegExp(P + "(?:\u7edf\u8ba1|\u5b57\u6570|\u770b\u770b\u5b57\u6570)(?:\u4e00\u4e0b|\u4e0b)?$"), tool: "stats", args: () => ({}) },
  { re: new RegExp(P + "\u5bfc\u51fa(?:[\u4f5c\u54c1|\u5168\u4e66])?\\s*(\\w+)?"), tool: "export", args: (m) => ({ fmt: m[1] ?? "" }) },

  { re: new RegExp(P + "(?:\u914d\u7f6e|\u8bbe\u7f6e|\u6362)(?:\u4e00\u4e0b)?(?:\u6a21\u578b|\u6a21\u578b\u914d\u7f6e)$"), tool: "model", args: () => ({}) },
  { re: new RegExp(P + "(?:\u7ee7\u7eed|\u63a5\u7740)(?:\u5de5\u4f5c|\u5199)?$"), tool: "continue_work", args: () => ({}) },
  { re: /^(?:\u9000\u51fa|\u5173\u95ed|\u62dc\u62dc)$/, tool: "quit", args: () => ({}) },

  { re: new RegExp(P + "(?:\u67e5\u770b|\u770b\u770b|\u8bfb)(?:\u4e00\u4e0b)?(?:\u5927\u7eb2)"), tool: "read_file", args: () => ({ file: "\u5927\u7eb2/\u603b\u7eb2.md" }) },
  { re: new RegExp(P + "(?:\u67e5\u770b|\u770b\u770b|\u8bfb)(?:\u4e00\u4e0b)?(?:\u98ce\u683c)"), tool: "read_file", args: () => ({ file: "\u98ce\u683c.md" }) },
  { re: new RegExp(P + "(?:\u67e5\u770b|\u770b\u770b|\u8bfb)(?:\u4e00\u4e0b)?(?:\u65f6\u95f4\u7ebf)"), tool: "read_file", args: () => ({ file: "\u65f6\u95f4\u7ebf.md" }) },
  { re: new RegExp(P + "(?:\u67e5\u770b|\u770b\u770b|\u8bfb)(?:\u4e00\u4e0b)?(?:\u6210\u957f)"), tool: "read_file", args: () => ({ file: "\u6210\u957f.md" }) },
  { re: new RegExp(P + "(?:\u67e5\u770b|\u770b\u770b|\u8bfb)(?:\u4e00\u4e0b)?(?:\u4f0f\u7b14)"), tool: "read_file", args: () => ({ file: "\u4f0f\u7b14.md" }) },
  { re: new RegExp(P + "(?:\u67e5\u770b|\u770b\u770b|\u8bfb)(?:\u4e00\u4e0b)?(?:\u7075\u611f)"), tool: "read_file", args: () => ({ file: "\u7b14\u8bb0/\u7075\u611f.md" }) },
  { re: new RegExp(P + "(?:\u8bfb|\u6253\u5f00|\u67e5\u770b)(?:\u4e00\u4e0b)?(?:\u6587\u4ef6|file)\\s*(\\S+)?"), tool: "read_file", args: (m) => ({ file: m[1] ?? "" }) },
]

export function ruleMatch(text: string): ToolCall[] {
  const t = text.trim()
  for (const r of RULES) {
    const m = t.match(r.re)
    if (m) {
      const args = r.args(m)
      return [{ tool: r.tool, args }]
    }
  }
  return []
}

// ---------- 分类(LLM 优先,回退规则) ----------
export async function classifyToolCalls(ctx: CommandContext, text: string): Promise<ToolCall[] | "aborted"> {
  const cfg = ctx.config.model
  if (!isMockMode(cfg) && resolveApiKey(cfg)) {
    try {
      const out = await withBusy("\u6b63\u5728\u7406\u89e3\u4f60\u7684\u6307\u4ee4\u2026", (signal) =>
        chat(cfg, [{ role: "user", content: buildPrompt(text) }], { temperature: 0, maxTokens: 800, signal }),
      )
      if (out === null) return "aborted"
      return parseToolCalls(out)
    } catch (e) {
      if ((e as Error).name === "AbortError") return "aborted"
      // 调用失败 → 回退规则
    }
  }
  return ruleMatch(text)
}

function argSummary(c: ToolCall): string {
  const tool = toolById(c.tool)
  if (!tool) return ""
  const parts = tool.params
    .filter((q) => c.args[q.name])
    .map((q) => `${q.desc}「${c.args[q.name]}」`)
  return parts.length > 0 ? `(${parts.join(", ")})` : ""
}

// ---------- 主入口:命中管理意图 → 确认 → 补齐 → 执行;否则返回 false 走写作 ----------
export async function routeFreeText(ctx: CommandContext, text: string): Promise<boolean> {
  const calls = await classifyToolCalls(ctx, text)
  if (calls === "aborted") {
    console.log("\u5df2\u53d6\u6d88\u672c\u6b21\u8f93\u5165")
    return true
  }
  const valid = calls.filter((c) => toolById(c.tool))
  if (valid.length === 0) return false

  const desc = valid.map((c) => toolById(c.tool)!.label + argSummary(c)).join("\u3001")
  const noAi = isMockMode(ctx.config.model) || !resolveApiKey(ctx.config.model)
  const hint = noAi ? "(未配 key,内置识别;配 key 后由 AI 判断意图)" : ""
  const ans = await ctx.askCancellable(`识别为:${desc}${hint}。回车执行 / Esc 取消:`)
  if (ans === null || ans.trim() !== "") {
    console.log("\u5df2\u53d6\u6d88")
    return true
  }

  const ready: ToolCall[] = []
  for (const c of valid) {
    const tool = toolById(c.tool)!
    const args = { ...c.args }
    for (const q of tool.params) {
      if (q.required && !args[q.name]) {
        const v = await ctx.askCancellable(q.prompt, { initial: args[q.name] })
        if (v === null) {
          console.log("\u5df2\u53d6\u6d88")
          return true
        }
        args[q.name] = v.trim()
        if (!args[q.name]) {
          console.log(`\u7f3a\u5c11 ${q.name},\u5df2\u53d6\u6d88`)
          return true
        }
      }
    }
    ready.push({ tool: c.tool, args })
  }

  for (const c of ready) {
    try {
      await toolById(c.tool)!.run(ctx, c.args)
    } catch (e) {
      console.log(`\u274c ${toolById(c.tool)!.label} \u5931\u8d25:${(e as Error).message}`)
    }
  }
  return true
}

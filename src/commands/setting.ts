// 设定管理:/world(世界观) /style(风格) /outline(大纲) /time(时间线) /growth(成长)
import path from "path"
import { writeFileSync } from "fs"
import type { Command, CommandContext } from "../types.ts"
import { p } from "../types.ts"
import {
  listWorld,
  readWorld,
  addWorld,
  updateWorld,
  deleteWorld,
  readStyle,
  writeStyle,
  readOutline,
  appendOutline,
  addTimeline,
  listTimeline,
  readGrowth,
  addGrowth,
  listChapters,
  chapterMeta,
  readChapter,
} from "../novel.ts"
import { saveConfig } from "../config.ts"
import { chat, isMockMode, resolveApiKey } from "../llm.ts"
import { withBusy } from "../ui.ts"
import { buildReviewContext } from "../context.ts"
import { genIterate, extractTitle } from "../gen.ts"
import { splitOp } from "../op.ts"
import { entityOpsMenu } from "./entity.ts"
import { pickOp } from "../menu.ts"
import { ensureModelConfigured } from "./manage.ts"

export const worldCmd: Command = {
  name: "world",
  aliases: ["世界观"],
  description: "世界观管理:无参数 = 操作菜单;列表/查看/添加/生成/修改/删除",
  usage: "/world(世界观) 列表 | /world(世界观) 查看 <名> | /world(世界观) 添加 <名> <内容> | /world(世界观) 生成 <描述> | /world(世界观) 修改 <名> <意见> | /world(世界观) 删除 <名>",
  handler: async (ctx: CommandContext, args: string) => {
    const { op, rest } = splitOp(args)
    if (!op) {
      await entityOpsMenu(ctx, {
        kind: "世界观条目",
        names: () => listWorld(ctx.root).map((n) => n.replace(/\.md$/, "")),
        runAdd: (name, content) => worldCmd.handler(ctx, `添加 ${name} ${content}`),
        runView: (name) => worldCmd.handler(ctx, `查看 ${name}`),
        runEdit: (name, instruction) => worldCmd.handler(ctx, `修改 ${name}${instruction ? " " + instruction : ""}`),
        runGen: (desc) => worldCmd.handler(ctx, `生成 ${desc}`),
        runDel: (name) => worldCmd.handler(ctx, `删除 ${name}`),
        runList: () => worldCmd.handler(ctx, "列表"),
      })
      return
    }
    if (op === "list") {
      const list = listWorld(ctx.root)
      if (list.length === 0) console.log("暂无设定条目,/world(世界观) 添加 <名> <内容> 添加(如:/world(世界观) 添加 修真境界 炼气→筑基→金丹)")
      else console.log("世界观条目:\n" + list.map((w) => `  - ${w.replace(/\.md$/, "")}`).join("\n"))
      return
    }
    if (op === "view") {
      const name = rest.join(" ")
      const content = readWorld(ctx.root, name)
      console.log(content ?? `未找到设定「${name}」`)
      return
    }
    if (op === "add") {
      const name = rest[0]
      const content = rest.slice(1).join(" ")
      if (!name || !content) return console.log("用法:/world(世界观) 添加 <名> <内容>")
      addWorld(ctx.root, name, content)
      console.log(`✅ 已添加世界观条目「${name}」\n📄 微调:${p(ctx, `世界观/${name}.md`)}`)
      return
    }
    if (op === "gen") {
      const desc = rest.join(" ")
      if (!desc) return console.log("用法:/world(世界观) 生成 <描述>(AI 迭代生成,满意才保存)")
      await genIterate(ctx, "世界观条目", desc, (draft) => {
        const name = extractTitle(draft) || `设定${Date.now()}`
        writeFileSync(path.join(ctx.root, "世界观", `${name}.md`), draft.trim() + "\n", "utf-8")
        return p(ctx, `世界观/${name}.md`)
      })
      return
    }
    if (op === "edit") {
      const name = rest[0]
      if (!name) return console.log("用法:/world(世界观) 修改 <名字> [修改意见]")
      const current = readWorld(ctx.root, name)
      if (!current) return console.log(`没有找到设定「${name}」,先用 /world(世界观) 添加 创建`)
      const instruction = rest.slice(1).join(" ")
      if (isMockMode(ctx.config.model) || !resolveApiKey(ctx.config.model)) {
        const content = (await ctx.ask(`「${name}」新的完整内容(回车 = 取消):`)).trim()
        if (!content) { console.log("已取消,未修改"); return }
        updateWorld(ctx.root, name, content)
        console.log(`✅ 已更新世界观「${name}」\n📄 微调:${p(ctx, `世界观/${name}.md`)}`)
        return
      }
      console.log(`📖 当前「${name}」内容:\n${current.trim()}\n`)
      await genIterate(ctx, "世界观条目", instruction || "基于现有设定继续完善", (draft) => {
        updateWorld(ctx.root, name, draft)
        return p(ctx, `世界观/${name}.md`)
      }, { constraints: `参考现有内容(在其基础上修改):\n${current}`, temperature: 0.7 })
      return
    }

    if (op === "del") {
      const name = rest.join(" ")
      if (!name) return console.log("用法:/world(世界观) 删除 <名字>")
      const ans = await ctx.ask(`⚠️ 确认删除世界观条目「${name}」?此操作不可恢复[y/N]:`)
      if (ans.trim().toLowerCase() !== "y") {
        console.log("已取消")
        return
      }
      console.log(deleteWorld(ctx.root, name) ? `✅ 已删除条目「${name}」` : `未找到条目「${name}」`)
      return
    }
    console.log("用法:/world(世界观) 列表 | /world(世界观) 查看 <名> | /world(世界观) 添加 <名> <内容> | /world(世界观) 生成 <描述> | /world(世界观) 修改 <名> <意见> | /world(世界观) 删除 <名>")
  },
}

export const styleCmd: Command = {
  name: "style",
  aliases: ["风格"],
  description: "风格管理:无参数 = 操作菜单;查看/设置/提炼(提炼 用 AI 从样章提取风格)",
  usage: "/style(风格) 查看 | /style(风格) 设置 <描述> | /style(风格) 提炼 <样章文件>",
  handler: async (ctx: CommandContext, args: string) => {
    const { op, rest } = splitOp(args)
    if (!op) {
      const act = await pickOp(ctx, "风格操作(↑↓ 移动 · 空格/回车 选择 · Esc 返回):", [
        { value: "view", label: "查看风格", description: "打印当前风格指南" },
        { value: "set", label: "设置风格", description: "输入风格描述" },
        { value: "extract", label: "提炼风格", description: "用 AI 从样章提取" },
      ])
      if (!act) return
      if (act === "set") {
        const desc = (await ctx.askCancellable("风格描述(回车 = 取消):"))?.trim()
        if (!desc) return
        await styleCmd.handler(ctx, `设置 ${desc}`)
      } else if (act === "extract") {
        const file = (await ctx.askCancellable("样章文件(章节文件名或路径,回车 = 取消):"))?.trim()
        if (!file) return
        await styleCmd.handler(ctx, `提炼 ${file}`)
      } else {
        await styleCmd.handler(ctx, "查看")
      }
      return
    }
    if (op === "view") {
      console.log(readStyle(ctx.root))
      console.log(`当前风格参数:${ctx.config.style ?? "(未设置)"}`)
      return
    }
    if (op === "set") {
      const desc = rest.join(" ")
      if (!desc) return console.log("用法:/style(风格) 设置 <风格描述>")
      ctx.config.style = desc
      saveConfig(ctx.root, ctx.config)
      writeStyle(ctx.root, `# 写作风格\n\n${desc}\n`)
      console.log(`✅ 风格已更新:${desc}\n📄 微调:${p(ctx, "风格.md")}`)
      return
    }
    if (op === "extract") {
      const file = rest[0]
      if (!file) return console.log("用法:/style(风格) 提炼 <样章文件路径>")
      const text = path.isAbsolute(file) ? (await Bun.file(file).text().catch(() => "")) : (readChapter(ctx.root, file) ?? "")
      if (!text.trim()) return console.log(`无法读取样章:${file}`)
      if (!(await ensureModelConfigured(ctx))) return
      console.log("🔍 正在用 AI 提取风格…")
      try {
        const prompt = `以下是样章,请提炼出可用于 AI 续写的风格指南(视角/人称/句长/描写密度/对话风格/节奏特点/常用修辞),输出精炼的中文要点列表:\n\n${text.slice(0, 4000)}`
        const result = await withBusy("🔍 正在用 AI 提取风格", (signal) =>
          chat(ctx.config.model, [{ role: "user", content: prompt }], { temperature: 0.3, signal }),
        )
        if (result === null) {
          console.log("⏹ 已打断")
          return
        }
        writeStyle(ctx.root, `# 写作风格\n\n${result}\n`)
        console.log(`✅ 风格指南已写入\n📄 微调:${p(ctx, "风格.md")}\n\n${result}`)
      } catch (e) {
        console.log(`❌ ${(e as Error).message}`)
      }
      return
    }
    console.log("用法:/style(风格) 查看 | /style(风格) 设置 <描述> | /style(风格) 提炼 <样章文件>")
  },
}

export const outlineCmd: Command = {
  name: "outline",
  aliases: ["大纲"],
  description: "大纲管理:无参数 = 操作菜单;查看/添加(支持「第N章 标题:内容」章节大纲,供 /write(写作) --n 批量写作使用)",
  usage: "/outline(大纲) 查看 | /outline(大纲) 添加 <内容> | /outline(大纲) 添加 第N章 标题:内容",
  examples: [
    "/outline(大纲) 添加 主线:林晚寻兄复仇",
    "/outline(大纲) 添加 第5章 夜探客栈:林晚潜入客栈,发现玉佩线索",
    "/outline(大纲) 添加 第6章 狭路相逢:与沈无涯对峙,身份疑云",
  ],
  handler: async (ctx: CommandContext, args: string) => {
    const { op, rest } = splitOp(args)
    if (!op) {
      const act = await pickOp(ctx, "大纲操作(↑↓ 移动 · 空格/回车 选择 · Esc 返回):", [
        { value: "view", label: "查看大纲", description: "打印总纲" },
        { value: "add", label: "添加大纲", description: "追加一条(支持 第N章 标题:内容)" },
      ])
      if (!act) return
      if (act === "add") {
        const content = (await ctx.askCancellable("大纲内容(回车 = 取消):"))?.trim()
        if (!content) return
        await outlineCmd.handler(ctx, `添加 ${content}`)
      } else {
        await outlineCmd.handler(ctx, "查看")
      }
      return
    }
    if (op === "view") {
      console.log(readOutline(ctx.root))
      return
    }
    if (op === "add") {
      const line = rest.join(" ")
      if (!line) return console.log("用法:/outline(大纲) 添加 <内容> 或 /outline(大纲) 添加 第N章 标题:内容")
      if (/^第\s*\d+\s*章/.test(line)) {
        const text = readOutline(ctx.root)
        if (!text.includes("## 章节大纲")) appendOutline(ctx.root, "\n## 章节大纲\n")
        appendOutline(ctx.root, `- ${line}`)
        console.log(`✅ 已加入章节大纲(大纲/总纲.md 的 ## 章节大纲 区),/write(写作) --n N 时自动按此写每章\n📄 微调:${p(ctx, "大纲/总纲.md")}`)
      } else {
        appendOutline(ctx.root, `- ${line}`)
        console.log(`✅ 已追加到大纲\n📄 微调:${p(ctx, "大纲/总纲.md")}`)
      }
      return
    }
    console.log("用法:/outline(大纲) 查看 | /outline(大纲) 添加 <内容> | /outline(大纲) 添加 第N章 标题:内容")
  },
}

export const timeCmd: Command = {
  name: "time",
  aliases: ["时间线"],
  description: "时间线管理:无参数 = 操作菜单;查看/添加/推进",
  usage: "/time(时间线) 查看 | /time(时间线) 添加 <章节> <时间点> <事件> | /time(时间线) 推进 <新时间点>",
  handler: async (ctx: CommandContext, args: string) => {
    const { op, rest } = splitOp(args)
    if (!op) {
      const act = await pickOp(ctx, "时间线操作(↑↓ 移动 · 空格/回车 选择 · Esc 返回):", [
        { value: "view", label: "查看时间线", description: "打印剧情时间线" },
        { value: "add", label: "添加记录", description: "章节/时间点/事件" },
        { value: "next", label: "推进时间", description: "更新当前时间点" },
      ])
      if (!act) return
      if (act === "add") {
        const chapter = (await ctx.askCancellable("章节(回车 = 取消):"))?.trim()
        if (!chapter) return
        const time = (await ctx.askCancellable("时间点(回车 = 取消):"))?.trim()
        if (!time) return
        const event = (await ctx.askCancellable("事件(回车 = 取消):"))?.trim()
        if (!event) return
        await timeCmd.handler(ctx, `添加 ${chapter} ${time} ${event}`)
      } else if (act === "next") {
        const time = (await ctx.askCancellable("新时间点(回车 = 取消):"))?.trim()
        if (!time) return
        await timeCmd.handler(ctx, `推进 ${time}`)
      } else {
        await timeCmd.handler(ctx, "查看")
      }
      return
    }
    if (op === "view") {
      const tl = listTimeline(ctx.root)
      if (tl.length === 0) console.log("时间线暂无记录(/time(时间线) 添加 添加)")
      else console.log("剧情时间线:\n" + tl.map((r) => `  ${r.join(" | ")}`).join("\n"))
      console.log(`当前时间点:${ctx.config.currentTime}`)
      return
    }
    if (op === "add") {
      const [chapter, time, ...ev] = rest
      if (!chapter || !time || ev.length === 0) return console.log("用法:/time(时间线) 添加 <章节> <时间点> <事件>")
      addTimeline(ctx.root, chapter, time, ev.join(" "))
      ctx.config.currentTime = time
      saveConfig(ctx.root, ctx.config)
      console.log(`✅ 已记录,当前时间点更新为「${time}」\n📄 微调:${p(ctx, "时间线.md")}`)
      return
    }
    if (op === "next") {
      const time = rest.join(" ")
      if (!time) return console.log("用法:/time(时间线) 推进 <新时间点>")
      ctx.config.currentTime = time
      saveConfig(ctx.root, ctx.config)
      console.log(`✅ 当前时间点 → ${time}\n📄 微调:${p(ctx, "novel.json")} 的 currentTime 字段`)
      return
    }
    console.log("用法:/time(时间线) 查看 | /time(时间线) 添加 <章节> <时间> <事件> | /time(时间线) 推进 <时间>")
  },
}

export const growthCmd: Command = {
  name: "growth",
  aliases: ["成长"],
  description: "主角成长管理:无参数 = 操作菜单;查看/添加",
  usage: "/growth(成长) 查看 | /growth(成长) 添加 <阶段> <成长描述>",
  handler: async (ctx: CommandContext, args: string) => {
    const { op, rest } = splitOp(args)
    if (!op) {
      const act = await pickOp(ctx, "成长操作(↑↓ 移动 · 空格/回车 选择 · Esc 返回):", [
        { value: "view", label: "查看成长", description: "打印主角成长记录" },
        { value: "add", label: "添加成长", description: "阶段 + 描述" },
      ])
      if (!act) return
      if (act === "add") {
        const stage = (await ctx.askCancellable("阶段(回车 = 取消):"))?.trim()
        if (!stage) return
        const desc = (await ctx.askCancellable("成长描述(回车 = 取消):"))?.trim()
        if (!desc) return
        await growthCmd.handler(ctx, `添加 ${stage} ${desc}`)
      } else {
        await growthCmd.handler(ctx, "查看")
      }
      return
    }
    if (op === "view") {
      console.log(readGrowth(ctx.root))
      return
    }
    if (op === "add") {
      const [stage, ...desc] = rest
      if (!stage || desc.length === 0) return console.log("用法:/growth(成长) 添加 <阶段> <成长描述>")
      const chapters = listChapters(ctx.root)
      const cur =
        chapters.length > 0
          ? chapters[Math.min(chapters.length - 1, Math.max((ctx.config.currentChapter ?? 1) - 1, 0))]
          : "(尚无章节)"
      addGrowth(ctx.root, stage, cur, desc.join(" "))
      console.log(`✅ 已记录成长阶段「${stage}」(章节 ${cur})\n📄 微调:${p(ctx, "成长.md")}`)
      return
    }
    console.log("用法:/growth(成长) 查看 | /growth(成长) 添加 <阶段> <描述>")
  },
}

// 供 /write(写作) 使用:当前章节的元数据摘要
export function currentChapterInfo(ctx: CommandContext): string {
  const chapters = listChapters(ctx.root)
  const cur = chapters[Math.min(chapters.length - 1, Math.max((ctx.config.currentChapter ?? 1) - 1, 0))]
  const meta = chapterMeta(ctx.root, cur)
  return `当前章节:${cur} | 标题:${meta.title ?? "?"} | 时间:${meta.time ?? ctx.config.currentTime ?? "?"}`
}

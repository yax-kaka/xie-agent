// 实体管理:/char(人物) /chapter(章节) /vault(伏笔) /idea(灵感) /scene(场景)
import path from "path"
import { existsSync, writeFileSync } from "fs"
import type { Command, CommandContext, SelectOption } from "../types.ts"
import { p } from "../types.ts"
import {
  listCharacters,
  readCharacter,
  addCharacter,
  updateCharacter,
  deleteCharacter,
  listChapters,
  readChapter,
  newChapter,
  chapterMeta,
  listVault,
  addVault,
  closeVault,
  addIdea,
  listIdeas,
  listScenes,
  readScene,
  addScene,
  updateScene,
  deleteScene,
} from "../novel.ts"
import { saveConfig, isCharHidden, isSceneHidden, setCharHidden, setSceneHidden } from "../config.ts"
import { genIterate, extractTitle } from "../gen.ts"
import { splitOp } from "../op.ts"
import { pickOp } from "../menu.ts"
import { isMockMode, resolveApiKey } from "../llm.ts"

// 通用:创建后询问是否出现在候选中
async function askPickerVisibility(
  ctx: CommandContext,
  kind: "人物" | "场景",
  name: string,
  defaultValue: "visible" | "hidden",
): Promise<void> {
  const opts =
    defaultValue === "visible"
      ? [
          { value: "visible", label: "可见(默认)" },
          { value: "hidden", label: "隐藏" },
        ]
      : [
          { value: "hidden", label: "隐藏(默认)" },
          { value: "visible", label: "可见" },
        ]
  const res = await ctx.pickSingle<string>({
    title: `「${name}」是否出现在候选中?`,
    options: opts,
  })
  const hidden = res.kind === "ok" && res.value === "hidden"
  if (kind === "人物") setCharHidden(ctx.root, name, hidden)
  else setSceneHidden(ctx.root, name, hidden)
  console.log(hidden ? `  已设为不在候选中显示(输入名字仍可选中;/${kind} 显示 恢复)` : `  已设为在候选中显示`)
}

// 无参数时的人物/场景/世界观操作菜单(opencode 式选项)
export async function entityOpsMenu(
  ctx: CommandContext,
  cfg: {
    kind: string
    names: () => string[]
    toggleHidden?: (name: string) => void | Promise<void>
    runAdd: (name: string, desc: string) => void | Promise<void>
    runView: (name: string) => void | Promise<void>
    runEdit: (name: string, instruction: string) => void | Promise<void>
    runGen: (desc: string) => void | Promise<void>
    runDel: (name: string) => void | Promise<void>
    runList: () => void | Promise<void>
  },
): Promise<void> {
  const names = cfg.names()
  const opts: SelectOption<string>[] = [
    { value: "add", label: `添加${cfg.kind}`, description: "新建档案" },
    { value: "view", label: `查看${cfg.kind}`, description: names.length > 0 ? `现有:${names.slice(0, 6).join("、")}${names.length > 6 ? "…" : ""}` : "暂无" },
    { value: "edit", label: `修改${cfg.kind}`, description: "AI 迭代修改或直接重写" },
    { value: "gen", label: `生成${cfg.kind}`, description: "AI 迭代生成,满意才保存" },
    ...(cfg.toggleHidden ? [{ value: "toggle", label: `隐藏/显示${cfg.kind}`, description: "切换候选可见性" }] : []),
    { value: "del", label: `删除${cfg.kind}`, description: "需二次确认" },
    { value: "list", label: "查看列表", description: "打印全部" },
  ]
  const res = await ctx.pickSingle<string>({
    title: `${cfg.kind}操作(↑↓ 移动 · 空格/回车 选择 · Esc 返回):`,
    options: opts,
  })
  if (res.kind === "cancel" || res.value === null) return
  const act = res.value
  if (act === "list") {
    await cfg.runList()
    return
  }
  if (act === "add") {
    const name = (await ctx.askCancellable(`${cfg.kind}名字(回车 = 取消):`))?.trim()
    if (!name) return
    const desc = (await ctx.askCancellable("一句话设定(回车 = 取消):"))?.trim()
    if (!desc) return
    await cfg.runAdd(name, desc)
    return
  }
  if (act === "gen") {
    const desc = (await ctx.askCancellable(`${cfg.kind}描述(回车 = 取消):`))?.trim()
    if (!desc) return
    await cfg.runGen(desc)
    return
  }
  if (names.length === 0) {
    console.log(`还没有${cfg.kind},先选 添加${cfg.kind}`)
    return
  }
  const pick = await ctx.pickSingle<string>({
    title: `选择${cfg.kind}(↑↓ 移动 · 回车 选择 · Esc 返回):`,
    options: names.map((n) => ({ value: n, label: n })),
  })
  if (pick.kind === "cancel" || pick.value === null) return
  const name = pick.value
  if (act === "view") await cfg.runView(name)
  else if (act === "edit") {
    const instruction = (await ctx.askCancellable("修改意见(回车 = AI 自动完善):"))?.trim() ?? ""
    await cfg.runEdit(name, instruction)
  } else if (act === "toggle" && cfg.toggleHidden) await cfg.toggleHidden(name)
  else if (act === "del") await cfg.runDel(name)
}
export const charCmd: Command = {
  name: "char",
  aliases: ["人物"],
  description: "人物管理:无参数 = 操作菜单;列表/查看/添加/生成/修改/隐藏/显示/删除",
  usage: "/char(人物) 列表 | /char(人物) 查看 <名字> | /char(人物) 添加 <名字> <设定> | /char(人物) 生成 <描述> | /char(人物) 修改 <名字> <意见> | /char(人物) 隐藏|显示|删除 <名字>",
  handler: async (ctx: CommandContext, args: string) => {
    const { op, rest } = splitOp(args)
    if (!op) {
      await entityOpsMenu(ctx, {
        kind: "角色",
        names: () => listCharacters(ctx.root).map((n) => n.replace(/\.md$/, "")),
        toggleHidden: async (name) => {
          const hidden = isCharHidden(ctx.root, name)
          await charCmd.handler(ctx, hidden ? `显示 ${name}` : `隐藏 ${name}`)
        },
        runAdd: (name, desc) => charCmd.handler(ctx, `添加 ${name} ${desc}`),
        runView: (name) => charCmd.handler(ctx, `查看 ${name}`),
        runEdit: (name, instruction) => charCmd.handler(ctx, `修改 ${name}${instruction ? " " + instruction : ""}`),
        runGen: (desc) => charCmd.handler(ctx, `生成 ${desc}`),
        runDel: (name) => charCmd.handler(ctx, `删除 ${name}`),
        runList: () => charCmd.handler(ctx, "列表"),
      })
      return
    }
    if (op === "list") {
      const names = listCharacters(ctx.root)
      if (names.length === 0) console.log("还没有人物,用 /char(人物) 添加 创建(如:/char(人物) 添加 林晚 黑发剑客,外冷内热)")
      else {
        console.log("人物列表:")
        for (const n of names) {
          const name = n.replace(/\.md$/, "")
          const mark = isCharHidden(ctx.root, name) ? "（已隐藏）" : ""
          console.log(`  - ${name}${mark}`)
        }
      }
      return
    }
    if (op === "view") {
      const name = rest.join(" ")
      if (!name) return console.log("用法:/char(人物) 查看 <名字>")
      console.log(readCharacter(ctx.root, name) ?? `未找到人物「${name}」`)
      return
    }
    if (op === "add") {
      const name = rest[0]
      const desc = rest.slice(1).join(" ")
      if (!name || !desc) return console.log("用法:/char(人物) 添加 <名字> <一句话设定>")
      const file = path.join(ctx.root, "人物", `${name}.md`)
      if (!existsSync(file)) {
        addCharacter(ctx.root, name, desc)
        console.log(`✅ 已创建人物「${name}」\n📄 微调:${p(ctx, `人物/${name}.md`)}`)
        await askPickerVisibility(ctx, "人物", name, "visible")
      } else {
        console.log(`「${name}」已存在,直接编辑 人物/${name}.md 即可`)
      }
      return
    }
    if (op === "gen") {
      const desc = rest.join(" ")
      if (!desc) return console.log("用法:/char(人物) 生成 <描述>(AI 迭代生成,满意才保存)")
      await genIterate(ctx, "人物档案", desc, (draft) => {
        const name = extractTitle(draft) || `人物${Date.now()}`
        writeFileSync(path.join(ctx.root, "人物", `${name}.md`), draft.trim() + "\n", "utf-8")
        return p(ctx, `人物/${name}.md`)
      })
      return
    }
    if (op === "edit") {
      const name = rest[0]
      if (!name) return console.log("用法:/char(人物) 修改 <名字> [修改意见]")
      const current = readCharacter(ctx.root, name)
      if (!current) return console.log(`没有找到人物「${name}」,先用 /char(人物) 添加 创建`)
      const instruction = rest.slice(1).join(" ")
      if (isMockMode(ctx.config.model) || !resolveApiKey(ctx.config.model)) {
        const content = (await ctx.ask(`「${name}」新的完整内容(回车 = 取消):`)).trim()
        if (!content) { console.log("已取消,未修改"); return }
        updateCharacter(ctx.root, name, content)
        console.log(`✅ 已更新人物「${name}」\n📄 微调:${p(ctx, `人物/${name}.md`)}`)
        return
      }
      console.log(`📖 当前「${name}」档案:\n${current.trim()}\n`)
      await genIterate(ctx, "人物档案", instruction || "基于现有设定继续完善", (draft) => {
        updateCharacter(ctx.root, name, draft)
        return p(ctx, `人物/${name}.md`)
      }, { constraints: `参考现有内容(在其基础上修改):\n${current}`, temperature: 0.7 })
      return
    }

    if (op === "hide") {
      const name = rest.join(" ")
      if (!name) return console.log("用法:/char(人物) 隐藏 <名字>")
      setCharHidden(ctx.root, name, true)
      console.log(`✅ 已隐藏「${name}」(不在候选中出现,输入名字仍可选中)`)
      return
    }
    if (op === "unhide") {
      const name = rest.join(" ")
      if (!name) return console.log("用法:/char(人物) 显示 <名字>")
      setCharHidden(ctx.root, name, false)
      console.log(`✅ 已恢复「${name}」的候选显示`)
      return
    }
    if (op === "del") {
      const name = rest.join(" ")
      if (!name) return console.log("用法:/char(人物) 删除 <名字>")
      const ans = await ctx.ask(`⚠️ 确认删除人物「${name}」?此操作不可恢复[y/N]:`)
      if (ans.trim().toLowerCase() !== "y") {
        console.log("已取消")
        return
      }
      if (deleteCharacter(ctx.root, name)) {
        setCharHidden(ctx.root, name, false)
        console.log(`✅ 已删除人物「${name}」`)
      } else {
        console.log(`未找到人物「${name}」`)
      }
      return
    }
    console.log("用法:/char(人物) 列表 | /char(人物) 查看 <名> | /char(人物) 添加 <名> <设定> | /char(人物) 生成 <描述> | /char(人物) 修改 <名> <意见> | /char(人物) 隐藏|显示|删除 <名>")
  },
}

export const chapterCmd: Command = {
  name: "chapter",
  aliases: ["章节"],
  description: "章节管理:无参数 = 操作菜单;列表/新建/定位",
  usage: "/chapter(章节) 列表 | /chapter(章节) 新建 <标题> | /chapter(章节) 定位 <编号>",
  handler: async (ctx: CommandContext, args: string) => {
    const { op, rest } = splitOp(args)
    const chapters = listChapters(ctx.root)
    if (!op) {
      const act = await pickOp(ctx, "章节操作(↑↓ 移动 · 空格/回车 选择 · Esc 返回):", [
        { value: "new", label: "新建章节", description: "输入标题创建" },
        { value: "go", label: "定位章节", description: "从现有章节里选" },
        { value: "list", label: "查看列表", description: "打印全部章节" },
      ])
      if (!act) return
      if (act === "new") {
        const title = (await ctx.askCancellable("章节标题(回车 = 自动编号):"))?.trim() ?? ""
        await chapterCmd.handler(ctx, `新建 ${title}`)
      } else if (act === "go") {
        if (chapters.length === 0) { console.log("暂无章节,先 新建章节"); return }
        const pick = await pickOp(ctx, "选择章节(↑↓ 移动 · 回车 选择 · Esc 返回):", chapters.map((f) => ({ value: f, label: f.replace(/\.md$/, "") })))
        if (!pick) return
        await chapterCmd.handler(ctx, `定位 ${pick.replace(/\D/g, "")}`)
      } else {
        await chapterCmd.handler(ctx, "列表")
      }
      return
    }
    if (op === "list") {
      if (chapters.length === 0) return console.log("暂无章节,/chapter(章节) 新建 <标题> 创建")
      console.log("章节列表:")
      for (const f of chapters) {
        const meta = chapterMeta(ctx.root, f)
        const cur = ctx.config.currentChapter ?? 1
        const mark = f.replace(/\.md$/, "") === String(Math.min(cur, chapters.length)).padStart(3, "0") ? " ← 当前" : ""
        console.log(`  ${f} | ${meta.title ?? "无标题"}${mark}`)
      }
      return
    }
    if (op === "new") {
      const title = rest.join(" ") || `第${chapters.length + 1}章`
      const filename = newChapter(ctx.root, title)
      ctx.config.currentChapter = listChapters(ctx.root).length
      saveConfig(ctx.root, ctx.config)
      console.log(`✅ 已创建 ${filename}「${title}」并定位到该章\n📄 微调:${p(ctx, `章节/${filename}`)}`)
      return
    }
    if (op === "go") {
      const n = Number(rest[0])
      if (!n || n < 1 || n > chapters.length) return console.log(`用法:/chapter(章节) 定位 <1-${chapters.length}>`)
      ctx.config.currentChapter = n
      saveConfig(ctx.root, ctx.config)
      console.log(`✅ 已定位到第 ${n} 章:${chapters[n - 1]}`)
      return
    }
    console.log("用法:/chapter(章节) 列表 | /chapter(章节) 新建 <标题> | /chapter(章节) 定位 <编号>")
  },
}

export const vaultCmd: Command = {
  name: "vault",
  aliases: ["伏笔"],
  description: "伏笔管理:无参数 = 操作菜单;列表/添加/关闭",
  usage: "/vault(伏笔) 列表 | /vault(伏笔) 添加 <伏笔名> [埋设章节] [计划回收章] | /vault(伏笔) 关闭 <伏笔名>",
  handler: async (ctx: CommandContext, args: string) => {
    const { op, rest } = splitOp(args)
    if (!op) {
      const act = await pickOp(ctx, "伏笔操作(↑↓ 移动 · 空格/回车 选择 · Esc 返回):", [
        { value: "add", label: "添加伏笔", description: "登记一条伏笔" },
        { value: "close", label: "关闭伏笔", description: "标记已回收" },
        { value: "list", label: "查看列表", description: "打印伏笔台账" },
      ])
      if (!act) return
      if (act === "add") {
        const name = (await ctx.askCancellable("伏笔名字(回车 = 取消):"))?.trim()
        if (!name) return
        const plan = (await ctx.askCancellable("计划回收(回车 = 无):"))?.trim() ?? ""
        await vaultCmd.handler(ctx, `添加 ${name}${plan ? " " + plan : ""}`)
      } else if (act === "close") {
        const open = listVault(ctx.root).filter((v) => v.status !== "已回收")
        if (open.length === 0) { console.log("没有未回收的伏笔"); return }
        const pick = await pickOp(ctx, "选择伏笔(↑↓ 移动 · 回车 选择 · Esc 返回):", open.map((v) => ({ value: v.name, label: v.name })))
        if (!pick) return
        await vaultCmd.handler(ctx, `关闭 ${pick}`)
      } else {
        await vaultCmd.handler(ctx, "列表")
      }
      return
    }
    if (op === "list") {
      const vault = listVault(ctx.root)
      if (vault.length === 0) console.log("暂无伏笔记录(/vault(伏笔) 添加 添加)")
      else {
        console.log("伏笔台账:")
        for (const v of vault) {
          console.log(`  ${v.name} | 埋设:${v.chapter} | ${v.status} | 计划回收:${v.plan || "未定"}`)
        }
      }
      return
    }
    if (op === "add") {
      const name = rest[0]
      if (!name) return console.log("用法:/vault(伏笔) 添加 <伏笔名> [章节] [计划回收]")
      const chapters = listChapters(ctx.root)
      const cur = chapters[Math.min(chapters.length - 1, Math.max((ctx.config.currentChapter ?? 1) - 1, 0))]
      const chapter = rest[1] ?? cur
      const plan = rest.slice(2).join(" ")
      addVault(ctx.root, name, chapter, plan)
      console.log(`✅ 伏笔「${name}」已登记(埋设于 ${chapter})\n📄 微调:${p(ctx, "伏笔.md")}`)
      return
    }
    if (op === "close") {
      const name = rest.join(" ")
      if (!name) return console.log("用法:/vault(伏笔) 关闭 <伏笔名>")
      console.log(closeVault(ctx.root, name) ? `✅ 伏笔「${name}」已标记回收` : `未找到伏笔「${name}」`)
      return
    }
    console.log("用法:/vault(伏笔) 列表 | /vault(伏笔) 添加 <名> [章节] [计划] | /vault(伏笔) 关闭 <名>")
  },
}

export const sceneCmd: Command = {
  name: "scene",
  aliases: ["场景"],
  description: "场景管理:无参数 = 操作菜单;列表/查看/添加/生成/修改/隐藏/显示/删除(新场景默认不在候选中)",
  usage: "/scene(场景) 列表 | /scene(场景) 查看 <名> | /scene(场景) 添加 <名> <描述> | /scene(场景) 生成 <描述> | /scene(场景) 修改 <名> <意见> | /scene(场景) 隐藏|显示|删除 <名>",
  examples: [
    "/scene(场景) 添加 青州城门 城墙斑驳,守军盘查,进城需验令牌",
    "/scene(场景) 添加 宗门大殿 九根盘龙柱,掌门高坐,弟子列队",
    "/scene(场景) 列表",
  ],
  handler: async (ctx: CommandContext, args: string) => {
    const { op, rest } = splitOp(args)
    if (!op) {
      await entityOpsMenu(ctx, {
        kind: "场景",
        names: () => listScenes(ctx.root).map((n) => n.replace(/\.md$/, "")),
        toggleHidden: async (name) => {
          const hidden = isSceneHidden(ctx.root, name)
          await sceneCmd.handler(ctx, hidden ? `显示 ${name}` : `隐藏 ${name}`)
        },
        runAdd: (name, desc) => sceneCmd.handler(ctx, `添加 ${name} ${desc}`),
        runView: (name) => sceneCmd.handler(ctx, `查看 ${name}`),
        runEdit: (name, instruction) => sceneCmd.handler(ctx, `修改 ${name}${instruction ? " " + instruction : ""}`),
        runGen: (desc) => sceneCmd.handler(ctx, `生成 ${desc}`),
        runDel: (name) => sceneCmd.handler(ctx, `删除 ${name}`),
        runList: () => sceneCmd.handler(ctx, "列表"),
      })
      return
    }
    if (op === "list") {
      const scenes = listScenes(ctx.root)
      if (scenes.length === 0) {
        console.log("暂无持久场景。用 /scene(场景) 添加 <名> <描述> 添加;或在 /write(写作) 向导里直接输入临时场景(不保存)")
      } else {
        console.log("场景列表:")
        for (const s of scenes) {
          const name = s.replace(/\.md$/, "")
          const mark = isSceneHidden(ctx.root, name) ? "（已隐藏）" : ""
          console.log(`  - ${name}${mark}`)
        }
      }
      return
    }
    if (op === "view") {
      const name = rest.join(" ")
      console.log(readScene(ctx.root, name) ?? `未找到场景「${name}」`)
      return
    }
    if (op === "add") {
      const name = rest[0]
      const content = rest.slice(1).join(" ")
      if (!name || !content) return console.log("用法:/scene(场景) 添加 <名> <描述>")
      addScene(ctx.root, name, content)
      console.log(`✅ 已保存场景「${name}」(写入该场景的章节会带上完整描述)\n📄 微调:${p(ctx, `场景/${name}.md`)}`)
      await askPickerVisibility(ctx, "场景", name, "hidden")
      return
    }
    if (op === "gen") {
      const desc = rest.join(" ")
      if (!desc) return console.log("用法:/scene(场景) 生成 <描述>(AI 迭代生成,满意才保存)")
      await genIterate(ctx, "场景", desc, (draft) => {
        const name = extractTitle(draft) || `场景${Date.now()}`
        writeFileSync(path.join(ctx.root, "场景", `${name}.md`), draft.trim() + "\n", "utf-8")
        return p(ctx, `场景/${name}.md`)
      })
      return
    }
    if (op === "edit") {
      const name = rest[0]
      if (!name) return console.log("用法:/scene(场景) 修改 <名字> [修改意见]")
      const current = readScene(ctx.root, name)
      if (!current) return console.log(`没有找到场景「${name}」,先用 /char(场景) 添加 创建`)
      const instruction = rest.slice(1).join(" ")
      if (isMockMode(ctx.config.model) || !resolveApiKey(ctx.config.model)) {
        const content = (await ctx.ask(`「${name}」新的完整内容(回车 = 取消):`)).trim()
        if (!content) { console.log("已取消,未修改"); return }
        updateScene(ctx.root, name, content)
        console.log(`✅ 已更新场景「${name}」\n📄 微调:${p(ctx, `场景/${name}.md`)}`)
        return
      }
      console.log(`📖 当前「${name}」档案:\n${current.trim()}\n`)
      await genIterate(ctx, "场景", instruction || "基于现有设定继续完善", (draft) => {
        updateScene(ctx.root, name, draft)
        return p(ctx, `场景/${name}.md`)
      }, { constraints: `参考现有内容(在其基础上修改):\n${current}`, temperature: 0.7 })
      return
    }

    if (op === "hide") {
      const name = rest.join(" ")
      if (!name) return console.log("用法:/scene(场景) 隐藏 <名字>")
      setSceneHidden(ctx.root, name, true)
      console.log(`✅ 已隐藏「${name}」(不在候选中出现,输入名字仍可选中)`)
      return
    }
    if (op === "unhide") {
      const name = rest.join(" ")
      if (!name) return console.log("用法:/scene(场景) 显示 <名字>")
      setSceneHidden(ctx.root, name, false)
      console.log(`✅ 已恢复「${name}」的候选显示`)
      return
    }
    if (op === "del") {
      const name = rest.join(" ")
      if (!name) return console.log("用法:/scene(场景) 删除 <名字>")
      const ans = await ctx.ask(`⚠️ 确认删除场景「${name}」?此操作不可恢复[y/N]:`)
      if (ans.trim().toLowerCase() !== "y") {
        console.log("已取消")
        return
      }
      if (deleteScene(ctx.root, name)) {
        setSceneHidden(ctx.root, name, false)
        console.log(`✅ 已删除场景「${name}」`)
      } else {
        console.log(`未找到场景「${name}」`)
      }
      return
    }
    console.log("用法:/scene(场景) 列表 | /scene(场景) 查看 <名> | /scene(场景) 添加 <名> <描述> | /scene(场景) 生成 <描述> | /scene(场景) 修改 <名> <意见> | /scene(场景) 隐藏|显示|删除 <名>")
  },
}

export const ideaCmd: Command = {
  name: "idea",
  aliases: ["灵感"],
  description: "灵感库:无参数 = 操作菜单;添加/列表",
  usage: "/idea(灵感) <灵感内容> | /idea(灵感) 列表",
  handler: async (ctx: CommandContext, args: string) => {
    let trimmed = args.trim()
    if (trimmed.startsWith("添加 ") || trimmed.startsWith("add ")) trimmed = trimmed.slice(3).trim()
    if (!trimmed) {
      const act = await pickOp(ctx, "灵感操作(↑↓ 移动 · 空格/回车 选择 · Esc 返回):", [
        { value: "add", label: "记录灵感", description: "存一条灵感碎片" },
        { value: "list", label: "查看列表", description: "打印灵感库" },
      ])
      if (!act) return
      if (act === "add") {
        const content = (await ctx.askCancellable("灵感内容(回车 = 取消):"))?.trim()
        if (!content) return
        await ideaCmd.handler(ctx, content)
      } else {
        await ideaCmd.handler(ctx, "列表")
      }
      return
    }
    if (trimmed === "列表" || trimmed === "list") {
      const ideas = listIdeas(ctx.root)
      if (ideas.length === 0) console.log("灵感库为空(/idea(灵感) 记一笔)")
      else console.log("灵感碎片:\n" + ideas.map((i) => `  - ${i}`).join("\n"))
      return
    }
    addIdea(ctx.root, trimmed)
    console.log(`✅ 已记入灵感库\n📄 微调:${p(ctx, "笔记/灵感.md")}`)
  },
}

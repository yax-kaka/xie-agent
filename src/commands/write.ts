// 写作执行:/write(写作) — 向导模式(选择器交互配置每章)+ 参数模式(批量);每章约 3000 字,不足自动补写
import type { Command, CommandContext, SelectOption } from "../types.ts"
import { p } from "../types.ts"
import {
  listChapters,
  readChapter,
  appendChapter,
  newChapter,
  chapterPlan,
  listScenes,
  readScene,
  addScene,
  deleteScene,
  updateChapterMeta,
  firstEmptyChapter,
  listCharacters,
  readCharacter,
  addCharacter,
  deleteCharacter,
} from "../novel.ts"
import { saveConfig, isCharHidden, isSceneHidden, setCharHidden, setSceneHidden } from "../config.ts"
import { chat, type ChatMessage } from "../llm.ts"
import { withBusy } from "../ui.ts"
import { buildWritingContext } from "../context.ts"
import { setPendingWrite, loadSession } from "../session.ts"
import { ensureModelConfigured } from "./manage.ts"

const TARGET_WORDS = 3000
const MIN_WORDS = 2500 // 目标 3000±500,剧情合理即合格,非硬规定

function countWords(text: string): number {
  return text.replace(/\s/g, "").length
}

function stripMd(f: string): string {
  return f.replace(/\.md$/, "")
}

// 人物档案里的一句话简介(取「初始设定」)
function charDesc(root: string, name: string): string {
  const text = readCharacter(root, name) ?? ""
  const m = text.match(/- 初始设定:\s*(.*)/)
  return m?.[1]?.trim() ?? ""
}

// 场景描述(标题行后的第一行)
function sceneDesc(root: string, name: string): string {
  const text = readScene(root, name) ?? ""
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)
  return lines[1] ?? ""
}

// 生成一章 + 字数检查自动补写(最多补 2 轮)
// 写入前检查:目标章节已有正文时需用户确认(避免意外重复追加)
async function confirmAppend(ctx: CommandContext, filename: string): Promise<boolean> {
  const existing = readChapter(ctx.root, filename) ?? ""
  const body = existing.replace(/^---\n[\s\S]*?\n---\n/, "").trim()
  if (body) {
    const ans = await ctx.ask(`⚠️ ${filename} 已有正文(${body.length}字),新内容将追加在后面。继续?[y/N]:`)
    return ans.trim().toLowerCase() === "y"
  }
  return true
}

async function generateChapter(
  ctx: CommandContext,
  messages: ChatMessage[],
  label: string,
): Promise<{ content: string; words: number } | null> {
  const first = await withBusy(`✍️ ${label} 生成中`, (signal) =>
    chat(ctx.config.model, messages, { temperature: 0.9, signal }),
  )
  if (first === null) return null
  let content = first
  let words = countWords(content)
  for (let i = 0; i < 2 && words < MIN_WORDS; i++) {
    console.log(`  ⏳ ${label} 当前 ${words} 字,未达目标 ${TARGET_WORDS}±500,自动补写…`)
    const more = await withBusy(`⏳ ${label} 补写中`, (signal) =>
      chat(
        ctx.config.model,
        [
          ...messages,
          { role: "assistant", content },
          { role: "user", content: `本章目前约 ${words} 字,目标 3000 字左右(±500 均可)。请继续扩写:补充环境描写、对话交锋与心理活动,推进剧情。如果剧情已自然收束,可以适度收尾,不要为凑字数硬写。直接输出续写正文,不要解释。` },
        ],
        { temperature: 0.9, signal },
      ),
    )
    if (more === null) return null // 打断:丢弃未保存内容
    content += "\n\n" + more
    words = countWords(content)
  }
  return { content, words }
}

// ---------- 向导模式 ----------
interface ChapterSpec {
  num: number
  title: string
  chars: string[]
  scene: string // 场景描述(持久场景名或临时描述)
  scenePersist: boolean // 是否持久场景
  plot: string // 剧情大纲(空 = AI 自动写)
}

// 人物选择(多选):空格切换,回车确定,h 隐藏/显示,d 删除,可新建
async function pickCharacters(ctx: CommandContext): Promise<string[] | null> {
  const names = listCharacters(ctx.root).map(stripMd)
  const options: SelectOption<string>[] = names.map((name) => ({
    value: name,
    label: name,
    description: charDesc(ctx.root, name),
    hidden: isCharHidden(ctx.root, name),
  }))
  const res = await ctx.pickMany<string>({
    title: "登场人物",
    options,
    allowNone: true,
    onCreate: async () => {
      const name = (await ctx.ask("  新人物名字(回车取消):")).trim()
      if (!name) return null
      const desc = (await ctx.ask("  一句话设定(回车跳过):")).trim()
      addCharacter(ctx.root, name, desc || "待完善")
      const vis = await ctx.pickSingle<string>({
        title: `「${name}」是否出现在候选中?(人物默认可见)`,
        options: [
          { value: "visible", label: "可见(默认)" },
          { value: "hidden", label: "隐藏" },
        ],
      })
      setCharHidden(ctx.root, name, vis.kind === "ok" && vis.value === "hidden")
      return name
    },
    onCreated: (opt) => {
      opt.hidden = isCharHidden(ctx.root, opt.label)
    },
    onToggleHidden: (opt) => setCharHidden(ctx.root, opt.label, opt.hidden ?? false),
    onDelete: (opt) => {
      deleteCharacter(ctx.root, opt.label)
    },
  })
  if (res.kind === "cancel") return null
  return res.values
}

type SceneChoice = { kind: "saved"; name: string } | { kind: "temp" }

// 场景选择(单选):空格/回车确定,可临时描述、可新建保存(默认隐藏)
async function pickScene(ctx: CommandContext): Promise<{ scene: string; persist: boolean } | null> {
  const scenes = listScenes(ctx.root).map(stripMd)
  const options: SelectOption<SceneChoice>[] = scenes.map((name) => ({
    value: { kind: "saved", name },
    label: name,
    description: sceneDesc(ctx.root, name),
    hidden: isSceneHidden(ctx.root, name),
  }))
  options.push({ value: { kind: "temp" }, label: "直接描述新场景(临时,不保存)" })
  const res = await ctx.pickSingle<SceneChoice>({
    title: "场景",
    options,
    allowNone: true,
    onCreate: async () => {
      const name = (await ctx.ask("  新场景名字(回车取消):")).trim()
      if (!name) return null
      const desc = (await ctx.ask("  场景描述(回车跳过):")).trim()
      addScene(ctx.root, name, desc || "")
      const vis = await ctx.pickSingle<string>({
        title: `「${name}」是否出现在候选中?(场景默认隐藏)`,
        options: [
          { value: "hidden", label: "隐藏(默认)" },
          { value: "visible", label: "可见" },
        ],
      })
      setSceneHidden(ctx.root, name, !(vis.kind === "ok" && vis.value === "visible"))
      return { kind: "saved", name }
    },
    onCreated: (opt) => {
      const v = opt.value as SceneChoice
      if (v.kind === "saved") opt.hidden = isSceneHidden(ctx.root, v.name)
    },
    onToggleHidden: (opt) => {
      const v = opt.value as SceneChoice
      if (v.kind === "saved") setSceneHidden(ctx.root, v.name, opt.hidden ?? false)
    },
    onDelete: (opt) => {
      const v = opt.value as SceneChoice
      if (v.kind === "saved") deleteScene(ctx.root, v.name)
    },
  })
  if (res.kind === "cancel") return null
  if (res.value === null) return { scene: "", persist: false }
  if (res.value.kind === "temp") {
    const d = (await ctx.ask("  描述新场景(回车 = 无):")).trim()
    return { scene: d, persist: false }
  }
  return { scene: res.value.name, persist: true }
}

async function runWizard(ctx: CommandContext): Promise<ChapterSpec[] | null> {
  const askC = ctx.askCancellable
  console.log("\n📝 写作向导(按 Esc 返回上一步;输入 q 完全取消)")
  let count = 1
  let chapterIdx = 0
  let step = 0 // 0=章数 1=标题 2=人物 3=场景 4=大纲
  const specs: Partial<ChapterSpec>[] = []

  // 文本步骤:Esc=null(返回上一步),输入 q=完全取消
  const text = async (prompt: string, initial = ""): Promise<string | "q" | null> => {
    const v = await askC(prompt, { initial })
    if (v === null) return null
    if (v.trim() === "q") return "q"
    return v
  }

  for (;;) {
    if (step === 0) {
      const v = await text("📖 要写几章?(默认 1):")
      if (v === "q" || v === null) {
        console.log("已取消")
        return null
      }
      count = Math.min(Math.max(parseInt(v) || 1, 1), 20)
      while (specs.length < count) specs.push({})
      chapterIdx = 0
      step = 1
      continue
    }
    const spec = specs[chapterIdx]
    if (step === 1) {
      console.log(`\n📄 第 ${chapterIdx + 1} 章:`)
      const v = await text(`  标题(回车 = 第${chapterIdx + 1}章):`, spec.title ?? "")
      if (v === "q") {
        console.log("已取消")
        return null
      }
      if (v === null) {
        // 返回上一步:第一章回到章数,其余回到上一章的大纲
        if (chapterIdx === 0) step = 0
        else {
          chapterIdx--
          step = 4
        }
        continue
      }
      spec.title = v || `第${chapterIdx + 1}章`
      step = 2
      continue
    }
    if (step === 2) {
      const chars = await pickCharacters(ctx)
      if (chars === null) {
        step = 1
        continue
      }
      spec.chars = chars
      step = 3
      continue
    }
    if (step === 3) {
      const sceneSel = await pickScene(ctx)
      if (sceneSel === null) {
        step = 2
        continue
      }
      spec.scene = sceneSel.scene
      spec.scenePersist = sceneSel.persist
      step = 4
      continue
    }
    if (step === 4) {
      const v = await text("  剧情大纲(回车 = AI 自动写):", spec.plot ?? "")
      if (v === "q") {
        console.log("已取消")
        return null
      }
      if (v === null) {
        step = 3
        continue
      }
      spec.plot = v
      if (chapterIdx + 1 < count) {
        chapterIdx++
        step = 1
        continue
      }
      // 确认
      console.log("\n📋 确认:")
      specs.forEach((s, idx) => {
        const sceneTxt = s.scene ? ` 场景:${s.scene}${s.scenePersist ? "" : "(临时)"}` : ""
        const charsTxt = s.chars && s.chars.length > 0 ? ` 人物:${s.chars.join("、")}` : ""
        const plotTxt = s.plot ? ` 剧情:${s.plot.slice(0, 50)}` : " 剧情:AI 自动写"
        console.log(`  第${idx + 1}章《${s.title}》${charsTxt}${sceneTxt}${plotTxt}`)
      })
      const go = await text("开始写作?[y/N]:")
      if (go === "q") {
        console.log("已取消")
        return null
      }
      if (go === null) {
        step = 4
        continue
      }
      if (go.trim().toLowerCase() !== "y") {
        console.log("已取消")
        return null
      }
      return specs as ChapterSpec[]
    }
  }
}

export const writeCmd: Command = {
  name: "write",
  aliases: ["写作"],
  description: "写小说:/write(写作) 进入向导(逐章选择标题/人物/场景/outline(大纲));或 /write(写作) --n N [--from N] 批量",
  usage: "/write(写作) | /write(写作) [指令] [--n 数量] [--from 起始章号] [--new 标题] [;; 分章指令]",
  examples: [
    "/写作",
    "/write(写作) 主角进城对峙宿敌",
    "/write(写作) --n 3 --from 1 按大纲写",
    "/write(写作) --n 2 第5章写夜探客栈;;第6章写狭路相逢",
  ],
  handler: async (ctx: CommandContext, args: string) => {
    const trimmed = args.trim()

    // 无参数 → 交互向导
    if (!trimmed) {
      const specs = await runWizard(ctx)
      if (!specs) return
      if (!(await ensureModelConfigured(ctx))) return
      const chapters = listChapters(ctx.root)
      const firstEmpty = firstEmptyChapter(ctx.root)
      // 新作品从第 1 章开始;否则接着末尾写
      let startNum = firstEmpty ? Number(firstEmpty.replace(/\D/g, "")) : chapters.length + 1
      let lastOutput: string | undefined
      console.log(`\n✍️  开始写作 ${specs.length} 章…`)
      for (let i = 0; i < specs.length; i++) {
        const spec = specs[i]
        const num = startNum + i
        const filename = newChapter(ctx.root, spec.title, num, {
          location: spec.scene,
          chars: spec.chars,
        })
        if (!(await confirmAppend(ctx, filename))) {
          console.log(`  ⏭️ 跳过 ${filename}(用户取消)`)
          continue
        }
        const instruction = spec.plot
          ? `${spec.plot}\n(本章字数目标约 ${TARGET_WORDS} 字,±500 均可,剧情合理优先)`
          : `本章剧情由你发挥:结合前文推进故事,写出精彩的一章。\n(本章字数目标约 ${TARGET_WORDS} 字,±500 均可,剧情合理优先)`
        console.log(`  ✍️  写作 ${filename}《${spec.title}》…`)
        try {
          const messages = buildWritingContext(ctx, instruction, {
            chapter: filename,
            lastOutput,
            scene: spec.scene || undefined,
            chars: spec.chars.length > 0 ? spec.chars : undefined,
          })
          const result = await generateChapter(ctx, messages, `${filename}《${spec.title}》`)
          if (result === null) {
            console.log(`  ⏹ ${filename} 已打断(未保存)`)
            break
          }
          const { content, words } = result
          appendChapter(ctx.root, filename, content)
          updateChapterMeta(ctx.root, filename, { location: spec.scene, chars: spec.chars })
          lastOutput = content
          ctx.config.currentChapter = listChapters(ctx.root).length
          saveConfig(ctx.root, ctx.config)
          console.log(`  ✅ 完成 → ${p(ctx, `章节/${filename}`)}(${words}字${words < MIN_WORDS ? ",未达 2500" : ",字数合格"})`)
        } catch (e) {
          console.log(`  ❌ ${filename} 失败:${(e as Error).message}(已跳过)`)
        }
      }
      console.log(`\n🎉 写作结束。运行 /check(检查) 校验,/stats(统计) 查看字数,/summary(摘要) 生成 卷摘要`)
      return
    }

    // ---------- 参数模式 ----------
    let instruction = trimmed
    let count = 1
    let from: number | undefined
    let newTitle: string | undefined
    const mN = instruction.match(/--n\s+(\d+)/)
    if (mN) {
      count = Math.min(Math.max(parseInt(mN[1]), 1), 20)
      instruction = instruction.replace(/--n\s+\d+/, "")
    }
    const mF = instruction.match(/--from\s+(\d+)/)
    if (mF) {
      from = parseInt(mF[1])
      instruction = instruction.replace(/--from\s+\d+/, "")
    }
    const mT = instruction.match(/--new\s+(\S.*)$/)
    if (mT) {
      newTitle = mT[1].trim()
      instruction = instruction.replace(/--new\s+\S.*$/, "")
    }
    instruction = instruction.trim()
    if (!instruction) instruction = "继续往下写,保持前文风格与人物设定,推进剧情"

    const chapters = listChapters(ctx.root)
    const plans = chapterPlan(ctx.root)
    const startNum = from ?? (newTitle ? chapters.length + 1 : Math.max(chapters.length, 1))

    if (count === 1 && !from && !newTitle) {
      // 续写当前章
      const cur = chapters[Math.min(chapters.length - 1, Math.max((ctx.config.currentChapter ?? 1) - 1, 0))]
      if (!(await ensureModelConfigured(ctx))) return
      console.log(`✍️  正在写作 章节/${cur}…`)
      try {
        const plan = plans.find((pl) => pl.num === Number(cur.replace(/\D/g, "")))
        const segs = instruction.split(";;").map((s) => s.trim()).filter(Boolean)
        const instr = plan?.content && segs.length === 0 ? `${instruction}\n本章要点:${plan.content}` : instruction
        const messages = buildWritingContext(ctx, instr, { chapter: cur })
        const result = await generateChapter(ctx, messages, cur)
        if (result === null) {
          console.log("⏹ 已打断,未保存")
          return
        }
        const { content, words } = result
        appendChapter(ctx.root, cur, "\n\n" + content)
        console.log(`✅ 已保存到 ${p(ctx, `章节/${cur}`)}(${words}字${words < MIN_WORDS ? ",未达 2500" : ",字数合格"})\n`)
        console.log(content.slice(0, 400) + (content.length > 400 ? "\n…(全文已保存)" : ""))
      } catch (e) {
        console.log(`❌ ${(e as Error).message}`)
      }
      return
    }

    // 批量模式
    if (!(await ensureModelConfigured(ctx))) return
    console.log(`📚 批量写作:从第 ${startNum} 章起,共 ${count} 章`)
    const segs = instruction.split(";;").map((s) => s.trim()).filter(Boolean)
    setPendingWrite(ctx.root, { startNum, count, done: 0, instruction, at: new Date().toISOString() })
    let lastOutput: string | undefined
    let failed = 0
    for (let i = 0; i < count; i++) {
      const num = startNum + i
      const plan = plans.find((pl) => pl.num === num)
      const title = plan?.title || (newTitle && i === 0 ? newTitle : `第${num}章`)
      const filename = newChapter(ctx.root, title, num)
      if (!(await confirmAppend(ctx, filename))) {
        console.log(`  ⏭️ 跳过 ${filename}(用户取消)`)
        continue
      }
      const instr = segs.length > 0
        ? (plan?.content ? `${segs[Math.min(i, segs.length - 1)]}\n本章要点:${plan.content}` : segs[Math.min(i, segs.length - 1)])
        : (plan?.content ? `${instruction}\n本章要点:${plan.content}` : instruction)
      console.log(`  ✍️  写作 ${filename}「${title}」…`)
      try {
        const messages = buildWritingContext(ctx, instr, { chapter: filename, lastOutput })
        const result = await generateChapter(ctx, messages, `${filename}「${title}」`)
        if (result === null) {
          console.log(`  ⏹ ${filename} 已打断(未保存;断点已保留,可 -c 继续)`)
          break
        }
        const { content, words } = result
        appendChapter(ctx.root, filename, content)
        lastOutput = content
        ctx.config.currentChapter = listChapters(ctx.root).length
        saveConfig(ctx.root, ctx.config)
        setPendingWrite(ctx.root, { startNum, count, done: i + 1, instruction, at: new Date().toISOString() })
        console.log(`  ✅ 完成 → ${p(ctx, `章节/${filename}`)}(${words}字${words < MIN_WORDS ? ",未达 2500" : ",字数合格"})`)
      } catch (e) {
        failed++
        console.log(`  ❌ ${filename} 失败:${(e as Error).message}(已跳过,继续下一章)`)
      }
    }
    setPendingWrite(ctx.root, failed === 0 ? undefined : loadSession(ctx.root).pendingWrite)
    console.log(`\n🎉 批量写作结束。运行 /check(检查) 校验,/stats(统计) 查看字数,/summary(摘要) 生成 卷摘要`)
  },
}

export function lastChapterText(ctx: CommandContext, n: number): string {
  const chapters = listChapters(ctx.root)
  return chapters
    .slice(-n)
    .map((f) => `### ${f}\n${readChapter(ctx.root, f) ?? ""}`)
    .join("\n")
}

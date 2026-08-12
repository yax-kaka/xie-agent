// xie-agent 入口 v0.9:TTY 用组件化交互层(候选补全 + 选择器 + Esc/Ctrl+C 双击),管道用行队列
import { stdin as input, stdout as output } from "node:process"
import path from "path"
import { readFileSync } from "fs"
import { findNovelRoot, migrateNovelLayout, listChapters, appendChapter } from "./novel.ts"
import { loadConfig, type NovelConfig } from "./config.ts"
import { getCommand, listCommands, cmdLabel } from "./commands/index.ts"
import type {
  CommandContext,
  PickManyOptions,
  PickManyResult,
  PickSingleOptions,
  PickSingleResult,
} from "./types.ts"
import { chat, resolveApiKey } from "./llm.ts"
import { buildWritingContext } from "./context.ts"
import { appendEntry } from "./session.ts"
import { continueCmd, ensureModelConfigured } from "./commands/manage.ts"
import { createScreen, setScreen, withBusy, type Screen } from "./ui.ts"
import { routeFreeText } from "./intent.ts"

const cwd = process.cwd()
const root = findNovelRoot(cwd)
const isTty = input.isTTY === true

if (root) migrateNovelLayout(root) // 旧版英文目录自动迁移为中文

console.log("📖 xie-agent — 小说写作 CLI Agent v0.9")
console.log("输入 /help(帮助) 查看命令;直接输入文字 = 让 AI 写作;Ctrl+C 两次退出;Esc 两次打断\n")

let config: NovelConfig
if (!root) {
  console.log(`⚠️  当前目录不是作品目录:${cwd}`)
  console.log("运行 /init(初始化) <作品名> 在此初始化一部作品,或 cd 到已有作品目录")
  config = {
    name: path.basename(cwd),
    model: { provider: "deepseek", model: "deepseek-v4-flash" },
  }
} else {
  config = loadConfig(root)
  console.log(`📚 当前作品:${config.name} (${root})`)
  const modeText = resolveApiKey(config.model) ? "真实" : "⚠️ 未配置 API Key → 运行 /model(模型)"
  console.log(`🤖 模型:${config.model.provider}/${config.model.model ?? "默认"} | 模式:${modeText}`)
}

// ---------- TTY 交互层 ----------
let screen: Screen | null = null
if (isTty) {
  screen = createScreen({
    suggest(line) {
      if (!line.startsWith("/")) return { names: [], labels: [], hint: "" }
      const rest = line.slice(1)
      const spaceIdx = rest.indexOf(" ")
      if (spaceIdx > 0) {
        const cmd = getCommand(rest.slice(0, spaceIdx))
        return { names: [], labels: [], hint: cmd?.usage ? `用法: ${cmd.usage}` : "" }
      }
      const names: string[] = []
      const labels: string[] = []
      for (const c of [...listCommands()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
        if (c.name.startsWith(rest) || (c.aliases ?? []).some((a) => a.startsWith(rest))) {
          names.push(c.name)
          labels.push(cmdLabel(c))
        }
      }
      return { names, labels, hint: "" }
    },
  })
  setScreen(screen)
}

// ---------- 管道输入:一次性读完整 stdin 按行处理(无交互,最可靠) ----------
const pipeLines: string[] = isTty ? [] : readFileSync(0, "utf-8").split(/\r?\n/)
let pipeIdx = 0

async function nextLine(): Promise<string> {
  if (pipeIdx < pipeLines.length) return pipeLines[pipeIdx++]
  return ""
}

async function askPipe(question: string): Promise<string> {
  output.write(question + " ")
  return (await nextLine()).trim()
}

// 非 TTY 的文本回退选择器(旧式编号输入)
async function pickSingleText<T>(opts: PickSingleOptions<T>): Promise<PickSingleResult<T>> {
  const list = opts.options.filter((o) => !o.hidden)
  console.log(opts.title)
  if (list.length === 0) {
    console.log("  (无可用选项)")
    return { kind: "cancel" }
  }
  list.forEach((o, i) => console.log(`  [${i + 1}] ${o.label}${o.description ? " " + o.description : ""}`))
  if (opts.allowNone) console.log("  [0] (无)")
  const ans = await askPipe("选择编号(回车 = 取消):")
  if (opts.allowNone && ans.trim() === "0") return { kind: "ok", value: null }
  const n = parseInt(ans)
  if (!isNaN(n) && n >= 1 && n <= list.length) return { kind: "ok", value: list[n - 1].value }
  return { kind: "cancel" }
}

async function pickManyText<T>(opts: PickManyOptions<T>): Promise<PickManyResult<T>> {
  const list = opts.options.filter((o) => !o.hidden)
  if (list.length === 0) return { kind: "ok", values: [] }
  console.log(opts.title)
  list.forEach((o, i) => console.log(`  [${i + 1}] ${o.label}${o.description ? " " + o.description : ""}`))
  const ans = await askPipe("输入编号(逗号分隔;回车 = 无):")
  const values: T[] = []
  for (const part of ans.split(/[,，]/)) {
    const n = parseInt(part.trim())
    if (!isNaN(n) && n >= 1 && n <= list.length) values.push(list[n - 1].value)
  }
  return { kind: "ok", values }
}

const ctx: CommandContext = {
  root: root ?? cwd,
  cwd,
  config,
  ask: (q) => (screen ? screen.ask(q, { remember: false }).then((v) => v ?? "") : askPipe(q)),
  askCancellable: (q, opts) =>
    screen
      ? screen.ask(q, { cancelable: true, suggest: null, remember: false, initial: opts?.initial })
      : askPipe(q),
  pickSingle: <T>(opts: PickSingleOptions<T>) => (screen ? screen.pickSingle(opts) : pickSingleText(opts)),
  pickMany: <T>(opts: PickManyOptions<T>) => (screen ? screen.pickMany(opts) : pickManyText(opts)),
}

const args = process.argv.slice(2)
const continueMode = args.includes("-c") || args.includes("--continue")

async function main() {
  // -c / --continue:回顾上次会话 + 续跑中断任务
  if (ctx.root && continueMode) {
    console.log("\n🔁 继续上次工作:\n")
    try {
      await continueCmd.handler(ctx, "")
      console.log("")
    } catch (e) {
      console.log(`❌ 恢复失败:${(e as Error).message}`)
    }
  }
  for (;;) {
    const line = (await (screen ? screen.ask("xie> ") : askPipe("xie> "))) ?? ""
    if (!isTty && line === "" && pipeIdx >= pipeLines.length) break // 管道输入消费完毕
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed === "/退出" || trimmed === "/quit" || trimmed === "exit") break

    if (trimmed.startsWith("/")) {
      if (ctx.root) appendEntry(ctx.root, "user", trimmed)
      const [name, ...rest] = trimmed.slice(1).split(/\s+/)
      const cmd = getCommand(name)
      if (cmd) {
        try {
          await cmd.handler(ctx, rest.join(" "))
        } catch (e) {
          console.log(`❌ 命令执行失败:${(e as Error).message}`)
        }
      } else {
        console.log(`未知命令 /${name},/help(帮助) 查看全部命令`)
      }
    } else {
      // 自由输入 = 写作指令(自动保存到当前章节,与 /write(写作) 一致)
      if (!ctx.root) {
        console.log("⚠️  当前目录还没有作品,先 /init(初始化) 初始化")
      } else {
        try {
          appendEntry(ctx.root, "user", trimmed)
          if (isTty && (await routeFreeText(ctx, trimmed))) continue
          const chapters = listChapters(ctx.root)
          if (chapters.length === 0) {
            console.log("⚠️ 还没有章节,请先 /write(写作) 创建第一章(向导或 /write(写作) --n 1 --from 1)")
          } else {
            if (!(await ensureModelConfigured(ctx))) continue
            const messages = buildWritingContext(ctx, trimmed)
            const content = await withBusy("✍️ AI 写作中", (signal) =>
              chat(config.model, messages, { temperature: 0.9, signal }),
            )
            if (content === null) {
              console.log("⏹ 已打断,未保存")
            } else {
              console.log("\n" + content + "\n")
              appendEntry(ctx.root, "assistant", content)
              const cur = chapters[Math.min(chapters.length - 1, Math.max((config.currentChapter ?? 1) - 1, 0))]
              appendChapter(ctx.root, cur, "\n\n" + content)
              console.log(`💾 已保存到 ${path.join(ctx.root, "章节", cur)}`)
            }
          }
        } catch (e) {
          console.log(`❌ ${(e as Error).message}`)
        }
      }
    }
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(`发生错误:${(e as Error).message}`)
  process.exit(1)
})

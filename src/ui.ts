// 终端交互层 v0.8:组件化输入(文本/选择器)+ 忙碌状态栏 + 按键解析
// 交互键位对齐 opencode:候选补全、光标编辑、Esc 返回、Esc 双击打断、Ctrl+C 双击退出
import { stdin as input, stdout as output } from "node:process"
import type { PickManyOptions, PickManyResult, PickSingleOptions, PickSingleResult, SelectOption } from "./types.ts"
import { COLOR, paint } from "./color.ts"

const FRAMES = ["|", "/", "-", "\\"]
const ESC_SEQ_MS = 50 // Esc 序列等待(区分单独 Esc 与方向键)
const CTRL_C_WINDOW = 3000
const ESC_ARM_WINDOW = 5000
const DELETE_ARM_WINDOW = 5000

// ---------- 按键 ----------
type Key =
  | { type: "char"; ch: string }
  | { type: "enter" }
  | { type: "tab" }
  | { type: "backspace" }
  | { type: "delete" }
  | { type: "esc" }
  | { type: "up" | "down" | "left" | "right" | "home" | "end" }
  | { type: "ctrl-c" | "ctrl-a" | "ctrl-e" | "ctrl-u" | "ctrl-k" | "ctrl-w" }
  | { type: "ignore" }

const ESC_SEQS: [string, Key][] = [
  ["\x1b[A", { type: "up" }],
  ["\x1b[B", { type: "down" }],
  ["\x1b[C", { type: "right" }],
  ["\x1b[D", { type: "left" }],
  ["\x1b[H", { type: "home" }],
  ["\x1b[F", { type: "end" }],
  ["\x1b[1~", { type: "home" }],
  ["\x1b[4~", { type: "end" }],
  ["\x1b[7~", { type: "home" }],
  ["\x1b[8~", { type: "end" }],
  ["\x1b[3~", { type: "delete" }],
  ["\x1bOA", { type: "up" }],
  ["\x1bOB", { type: "down" }],
  ["\x1bOC", { type: "right" }],
  ["\x1bOD", { type: "left" }],
]

// 判断是否为"不完整的转义序列"(等待后续字节)
function isIncompleteEscape(seq: string): boolean {
  if (seq === "\x1b" || seq === "\x1b[" || seq === "\x1bO") return true
  return /^\x1b\[[0-9;]*$/.test(seq)
}

const CTRL_KEYS: Record<string, Key> = {
  "\x01": { type: "ctrl-a" },
  "\x05": { type: "ctrl-e" },
  "\x15": { type: "ctrl-u" },
  "\x0b": { type: "ctrl-k" },
  "\x17": { type: "ctrl-w" },
}

class KeyReader {
  private escBuf = ""
  private escTimer: ReturnType<typeof setTimeout> | null = null

  onData(chunk: string, handler: (k: Key) => void): void {
    // 合并上一次不完整的转义序列,统一扫描(支持一个数据块内多个按键)
    // \r\n 先归一化为 \n,避免 CRLF 触发两次回车
    const full = (this.escBuf + chunk).replace(/\r\n/g, "\n")
    this.escBuf = ""
    if (this.escTimer) clearTimeout(this.escTimer)
    let i = 0
    while (i < full.length) {
      const c = full[i]
      if (c === "\x1b") {
        const rest = full.slice(i)
        const hit = ESC_SEQS.find(([s]) => rest.startsWith(s))
        if (hit) {
          handler(hit[1])
          i += hit[0].length
          continue
        }
        if (isIncompleteEscape(rest)) {
          this.escBuf = rest
          this.armEsc(handler)
          return
        }
        i = full.length // 未知序列,跳过剩余
        continue
      }
      const ctrl = CTRL_KEYS[c]
      if (ctrl) handler(ctrl)
      else if (c === "\r" || c === "\n") {
        // 换行后同一数据块里还有文字 = 粘贴中的换行(按文字插入);否则是回车提交
        const after = full.slice(i + 1)
        const afterText = [...after].some((ch) => ch !== "\r" && ch !== "\n" && ch !== "\x1b" && ch >= " ")
        if (afterText) handler({ type: "char", ch: "\n" })
        else handler({ type: "enter" })
      }
      else if (c === "\x03") handler({ type: "ctrl-c" })
      else if (c === "\x7f" || c === "\b") handler({ type: "backspace" })
      else if (c === "\t") handler({ type: "tab" })
      else handler({ type: "char", ch: c })
      i++
    }
  }
  private armEsc(handler: (k: Key) => void): void {
    if (this.escTimer) clearTimeout(this.escTimer)
    this.escTimer = setTimeout(() => {
      this.escTimer = null
      if (this.escBuf) {
        const seq = this.escBuf
        this.escBuf = ""
        if (seq === "\x1b") handler({ type: "esc" })
      }
    }, ESC_SEQ_MS)
  }
}

// ---------- 帧渲染:整块重绘,支持任意行数 ----------
class Frame {
  private lines = 0

  render(lines: string[]): void {
    const n = lines.length
    if (this.lines > 1) output.write(`\x1b[${this.lines - 1}A`)
    for (let i = 0; i < n; i++) {
      if (i > 0) output.write("\r\n")
      output.write("\r\x1b[2K" + lines[i])
    }
    if (this.lines > n) output.write("\x1b[J") // 清除比之前少时遗留的行
    this.lines = n
  }

  /** 若光标被定位到帧中间(如行中编辑),先移回最后一行的行尾再重绘 */
  resetCursor(): void {
    if (this.lines > 1) output.write(`\x1b[${this.lines - 1}B`)
  }

  close(): void {
    if (this.lines > 1) output.write(`\x1b[${this.lines - 1}A`)
    output.write("\r\x1b[J")
    this.lines = 0
  }
}

interface Widget {
  refresh(): void
  onKey(k: Key): void
}

interface SuggestResult {
  names: string[]
  labels?: string[]
  hint: string
}

export interface AskOptions {
  /** 按 Esc 返回 null(向导"返回上一步"用) */
  cancelable?: boolean
  /** null = 不显示候选/用法提示;缺省 = 主输入框的命令候选 */
  suggest?: ((line: string) => SuggestResult) | null
  /** false = 不读写主历史(向导文本框) */
  remember?: boolean
  /** 预填文本(返回上一步时保留已填值) */
  initial?: string
}

const EMPTY_SUGGEST = (): SuggestResult => ({ names: [], hint: "" })

// ---------- 文本输入组件 ----------
class TextInputWidget implements Widget {
  private line = ""
  private cursor = 0
  private cursorUp = 0
  private names: string[] = []
  private labels: string[] = []
  private hint = ""
  private tabIndex = -1
  private histIndex: number
  private frame = new Frame()
  onDone: ((value: string | null) => void) | null = null

  constructor(
    private screen: Screen,
    private prompt: string,
    private suggest: (line: string) => SuggestResult,
    private history: string[],
    private opts: AskOptions,
  ) {
    this.line = opts.initial ?? ""
    this.cursor = [...this.line].length
    this.histIndex = history.length
  }

  refresh(): void {
    this.render()
  }

  close(): void {
    this.frame.close()
  }

  private update(): void {
    const s = this.suggest(this.line)
    this.names = s.names
    this.labels = s.labels ?? []
    this.hint = s.hint
    this.tabIndex = -1
  }

  private render(): void {
    const input = this.inputRows()
    const lines: string[] = [...input.rows]
    if (this.screen.ctrlCHint) {
      lines.push(this.screen.ctrlCHint)
    } else if (this.hint) {
      lines.push(paint(this.hint, COLOR.dim))
    } else if (this.names.length > 0) {
      // 纵向候选列表(对齐 opencode 补全弹层)
      const MAX = 8
      let start = 0
      if (this.names.length > MAX) {
        start = Math.max(0, Math.min(this.tabIndex - Math.floor(MAX / 2), this.names.length - MAX))
      }
      for (let i = start; i < Math.min(start + MAX, this.names.length); i++) {
        const label = this.labels[i] ?? "/" + this.names[i]
        const active = i === this.tabIndex
        const mark = active ? paint("▶", COLOR.cyanBold) : "  "
        lines.push(mark + paint(truncate(label, 72), active ? COLOR.cyanBold : COLOR.dim))
      }
      const more = this.names.length > MAX ? ` · 共 ${this.names.length} 个` : ""
      lines.push(paint(`[Tab 补全 · ↑↓ 选择]${more}`, COLOR.dim))
    }
    // 回到上一帧末尾(精确回退上次上移的距离),再整帧重绘
    if (this.cursorUp > 0) output.write(`\x1b[${this.cursorUp}B`)
    this.cursorUp = 0
    this.frame.render(lines)
    // 光标定位到多行/折行后的实际行列
    if (input.cursorRow >= 0) {
      const up = lines.length - 1 - input.cursorRow
      if (up > 0) {
        output.write(`\x1b[${up}A`)
        this.cursorUp = up
      }
      output.write(`\x1b[${input.cursorCol + 1}G`)
    }
  }

  // 把 prompt+line 按终端宽度展开为物理行,并算出光标所在行列
  private inputRows(): { rows: string[]; cursorRow: number; cursorCol: number } {
    const cols = Math.max(20, output.columns || 80)
    const text = this.prompt + this.line
    const chars = [...text]
    const beforeLen = [...this.prompt + [...this.line].slice(0, this.cursor).join("")].length
    const rows: string[] = [""]
    let cursorRow = 0
    let cursorCol = 0
    let i = 0
    for (const ch of chars) {
      if (i === beforeLen) {
        cursorRow = rows.length - 1
        cursorCol = Bun.stringWidth(rows[rows.length - 1] ?? "")
      }
      if (ch === "\n") {
        rows.push("")
      } else {
        const w = ch === "\t" ? 4 : Bun.stringWidth(ch)
        if (Bun.stringWidth(rows[rows.length - 1] ?? "") + w > cols) rows.push("")
        rows[rows.length - 1] = (rows[rows.length - 1] ?? "") + ch
      }
      i++
    }
    if (i === beforeLen) {
      cursorRow = rows.length - 1
      cursorCol = Bun.stringWidth(rows[rows.length - 1] ?? "")
    }
    return { rows, cursorRow, cursorCol }
  }

  onKey(k: Key): void {
    switch (k.type) {
      case "char": {
        const arr = [...this.line]
        arr.splice(this.cursor, 0, k.ch)
        this.line = arr.join("")
        this.cursor++
        this.update()
        break
      }
      case "backspace":
        if (this.cursor > 0) {
          const arr = [...this.line]
          arr.splice(this.cursor - 1, 1)
          this.line = arr.join("")
          this.cursor--
          this.update()
        }
        break
      case "delete":
        if (this.cursor < [...this.line].length) {
          const arr = [...this.line]
          arr.splice(this.cursor, 1)
          this.line = arr.join("")
          this.update()
        }
        break
      case "left":
        this.cursor = Math.max(0, this.cursor - 1)
        break
      case "right":
        this.cursor = Math.min([...this.line].length, this.cursor + 1)
        break
      case "home":
      case "ctrl-a":
        this.cursor = 0
        break
      case "end":
      case "ctrl-e":
        this.cursor = [...this.line].length
        break
      case "ctrl-u": {
        const arr = [...this.line]
        this.line = arr.slice(this.cursor).join("")
        this.cursor = 0
        this.update()
        break
      }
      case "ctrl-k": {
        const arr = [...this.line]
        this.line = arr.slice(0, this.cursor).join("")
        this.update()
        break
      }
      case "ctrl-w": {
        const arr = [...this.line]
        let i = this.cursor
        while (i > 0 && arr[i - 1] === " ") i--
        while (i > 0 && arr[i - 1] !== " ") i--
        arr.splice(i, this.cursor - i)
        this.line = arr.join("")
        this.cursor = i
        this.update()
        break
      }
      case "enter":
        this.commit()
        return
      case "tab":
        this.complete()
        break
      case "up":
        if (this.names.length > 0) {
          // 候选存在:只移动高亮,不覆盖已输入内容
          this.tabIndex = (this.tabIndex - 1 + this.names.length) % this.names.length
        } else if (this.histIndex > 0) {
          this.histIndex--
          this.line = this.history[this.histIndex] ?? ""
          this.cursor = [...this.line].length
          this.update()
        }
        break
      case "down":
        if (this.names.length > 0) {
          this.tabIndex = (this.tabIndex + 1) % this.names.length
        } else if (this.histIndex < this.history.length) {
          this.histIndex++
          this.line = this.history[this.histIndex] ?? ""
          this.cursor = [...this.line].length
          this.update()
        }
        break
      case "esc":
        if (this.names.length > 0) {
          // 收起候选列表
          this.names = []
          this.tabIndex = -1
          this.hint = ""
        } else if (this.opts.cancelable) {
          const done = this.onDone
          this.onDone = null
          done?.(null)
          return
        } else {
          return
        }
        break
      default:
        return
    }
    this.render()
  }

  private complete(): void {
    if (this.names.length === 0) this.update()
    if (this.names.length === 0) return
    // 应用当前高亮(无高亮时取第一个);↑/↓ 负责轮转
    if (this.tabIndex < 0) this.tabIndex = 0
    this.line = "/" + this.names[this.tabIndex]
    this.cursor = [...this.line].length
    this.hint = ""
    this.render()
  }

  private commit(): void {
    if (this.tabIndex >= 0 && this.names.length > 0) {
      this.line = "/" + this.names[this.tabIndex]
      this.cursor = [...this.line].length
    }
    const done = this.onDone
    this.onDone = null
    done?.(this.line)
  }
}

// ---------- 选择器组件(单/多选,分组/当前标记,支持 h 隐藏、d 删除、输入过滤) ----------
type Entry<T> =
  | { kind: "opt"; opt: SelectOption<T> }
  | { kind: "none" }
  | { kind: "new" }

interface Row<T> {
  kind: "header" | "entry"
  text?: string
  entry?: Entry<T>
  rowIndex?: number
}

class SelectWidget<T> implements Widget {
  private frame = new Frame()
  private options: SelectOption<T>[] = []
  private selected = new Set<SelectOption<T>>()
  private index = 0
  private filter = ""
  private footerHint = ""
  private hintTimer: ReturnType<typeof setTimeout> | null = null
  private pendingDeleteName = ""
  private pendingDeleteAt = 0
  private deleteTimer: ReturnType<typeof setTimeout> | null = null
  onDone: ((r: PickSingleResult<T> | PickManyResult<T>) => void) | null = null

  constructor(
    private screen: Screen,
    private opts: PickManyOptions<T> & { multi: boolean },
  ) {
    this.options = [...opts.options]
  }

  refresh(): void {
    this.render()
  }

  close(): void {
    this.frame.close()
  }

  private entries(): Entry<T>[] {
    const out: Entry<T>[] = []
    const q = this.filter
    for (const opt of this.options) {
      const shown =
        q === "" ? !opt.hidden : opt.label.includes(q) || (opt.description ?? "").includes(q)
      if (shown) out.push({ kind: "opt", opt })
    }
    if (this.opts.allowNone) out.push({ kind: "none" })
    if (this.opts.onCreate) out.push({ kind: "new" })
    return out
  }

  private rows(): Row<T>[] {
    const rows: Row<T>[] = []
    let lastCat: string | undefined
    const E = this.entries()
    E.forEach((e, i) => {
      if (e.kind === "opt" && e.opt.category && e.opt.category !== lastCat) {
        rows.push({ kind: "header", text: e.opt.category })
        lastCat = e.opt.category
      }
      rows.push({ kind: "entry", entry: e, rowIndex: i })
    })
    return rows
  }

  private render(): void {
    const E = this.entries()
    if (this.index >= E.length) this.index = Math.max(0, E.length - 1)
    const lines: string[] = [this.opts.title]
    if (this.filter) lines.push(`筛选: ${this.filter}`)
    const rows = this.rows()
    const entryRow = rows.findIndex((r) => r.kind === "entry" && r.rowIndex === this.index)
    let start = 0
    if (rows.length > 10) {
      start = Math.max(0, Math.min(entryRow - 4, rows.length - 10))
    }
    const shown = rows.slice(start, start + 10)
    if (shown.length === 0) lines.push("  (无匹配)")
    for (const r of shown) {
      if (r.kind === "header") {
        lines.push(paint(`  — ${r.text} —`, COLOR.dim))
        continue
      }
      const e = r.entry!
      const active = r.rowIndex === this.index
      let line: string
      if (e.kind === "opt") {
        const mark = this.opts.multi
          ? this.selected.has(e.opt)
            ? "[x]"
            : "[ ]"
          : active
            ? "▶"
            : " "
        const cur = e.opt.current ? paint("●", COLOR.green) + " " : " "
        const rest = truncate(`${e.opt.label}${e.opt.description ? ` — ${e.opt.description}` : ""}`, 72)
        line = (active ? paint("▶", COLOR.cyanBold) : mark) + " " + cur + paint(rest, active ? COLOR.cyanBold : COLOR.dim)
      } else if (e.kind === "none") {
        line = (active ? paint("▶", COLOR.cyanBold) : " ") + " (无)"
      } else {
        line = (active ? paint("▶", COLOR.cyanBold) : " ") + " ＋ 新建…"
      }
      lines.push(line)
    }
    const nav = this.opts.multi ? "空格 选择 · 回车 确定" : "空格/回车 选择"
    let footer = `↑↓ 移动 · ${nav} · Esc 返回 · 输入 过滤`
    if (this.footerHint) footer += `\r\n${this.footerHint}`
    if (this.screen.ctrlCHint) footer += `\r\n${this.screen.ctrlCHint}`
    lines.push(paint(footer, COLOR.dim))
    this.frame.render(lines)
  }

  onKey(k: Key): void {
    switch (k.type) {
      case "up":
        this.move(-1)
        break
      case "down":
        this.move(1)
        break
      case "char":
        if (k.ch === " ") {
          if (this.opts.multi) this.toggleCurrent()
          else void this.activate()
          return
        }
        if (k.ch === "h" && this.filter === "") {
          this.toggleHidden()
          break
        }
        if (k.ch === "d" && this.filter === "") {
          this.requestDelete()
          break
        }
        if (k.ch === "\n") break
        this.filter += k.ch
        this.index = 0
        break
      case "backspace":
        this.filter = this.filter.slice(0, -1)
        this.index = 0
        break
      case "enter":
        void this.activate()
        return
      case "esc":
        if (this.filter !== "") {
          this.filter = ""
          this.index = 0
        } else {
          this.cancel()
          return
        }
        break
      default:
        return
    }
    this.render()
  }

  private move(dir: number): void {
    const E = this.entries()
    if (E.length === 0) return
    this.index = (this.index + dir + E.length) % E.length
  }

  private async activate(): Promise<void> {
    const E = this.entries()
    const cur = E[this.index]
    if (!cur) return
    if (cur.kind === "opt") {
      if (this.opts.multi) {
        this.confirmMany(this.options.filter((o) => this.selected.has(o)).map((o) => o.value))
      } else {
        this.confirm(cur.opt.value)
      }
      return
    }
    if (cur.kind === "none") {
      if (this.opts.multi) this.confirmMany([])
      else this.confirm(null)
      return
    }
    await this.runNew()
  }

  private toggleCurrent(): void {
    const E = this.entries()
    const cur = E[this.index]
    if (!cur || cur.kind !== "opt") return
    if (this.selected.has(cur.opt)) this.selected.delete(cur.opt)
    else this.selected.add(cur.opt)
    this.render()
  }

  private async runNew(): Promise<void> {
    const onCreate = this.opts.onCreate
    if (!onCreate) return
    this.frame.close()
    try {
      const value = await onCreate()
      if (value === null) {
        this.render()
        return
      }
      const opt: SelectOption<T> = { value, label: String(value) }
      this.options.push(opt)
      this.opts.onCreated?.(opt)
      if (this.opts.multi) {
        this.selected.add(opt)
        this.filter = ""
        const E = this.entries()
        this.index = Math.max(0, E.length - 1)
        this.showFooterHint(`已新建「${opt.label}」并选中`)
      } else {
        this.confirm(opt.value)
        return
      }
    } catch (e) {
      this.showFooterHint(`新建失败:${(e as Error).message}`)
    }
    this.render()
  }

  private toggleHidden(): void {
    const E = this.entries()
    const cur = E[this.index]
    if (!cur || cur.kind !== "opt") return
    const opt = cur.opt
    const next = !opt.hidden
    opt.hidden = next
    if (next && this.opts.multi) this.selected.delete(opt)
    try {
      void this.opts.onToggleHidden?.(opt)
    } catch {
      /* 持久化失败不阻塞 */
    }
    this.showFooterHint(next ? `已隐藏「${opt.label}」(输入名字仍可选中)` : `已显示「${opt.label}」`)
    if (this.filter === "") this.index = Math.max(0, Math.min(this.index, this.entries().length - 1))
  }

  private requestDelete(): void {
    const E = this.entries()
    const cur = E[this.index]
    if (!cur || cur.kind !== "opt") return
    const opt = cur.opt
    const now = Date.now()
    if (this.pendingDeleteName === opt.label && now - this.pendingDeleteAt < DELETE_ARM_WINDOW) {
      this.pendingDeleteName = ""
      if (this.deleteTimer) clearTimeout(this.deleteTimer)
      try {
        void this.opts.onDelete?.(opt)
        const idx = this.options.indexOf(opt)
        if (idx >= 0) this.options.splice(idx, 1)
        this.selected.delete(opt)
        this.showFooterHint(`已删除「${opt.label}」`)
      } catch (e) {
        this.showFooterHint(`删除失败:${(e as Error).message}`)
      }
      this.index = Math.max(0, Math.min(this.index, this.entries().length - 1))
    } else {
      this.pendingDeleteName = opt.label
      this.pendingDeleteAt = now
      this.showFooterHint(`再按 d 确认删除「${opt.label}」`)
      if (this.deleteTimer) clearTimeout(this.deleteTimer)
      this.deleteTimer = setTimeout(() => {
        this.pendingDeleteName = ""
        this.footerHint = ""
        this.render()
      }, DELETE_ARM_WINDOW)
    }
  }

  private showFooterHint(msg: string): void {
    this.footerHint = msg
    if (this.hintTimer) clearTimeout(this.hintTimer)
    this.hintTimer = setTimeout(() => {
      this.footerHint = ""
      this.render()
    }, 2600)
    this.render()
  }

  private confirm(value: T | null): void {
    const done = this.onDone
    this.onDone = null
    done?.({ kind: "ok", value } as PickSingleResult<T>)
  }

  private confirmMany(values: T[]): void {
    const done = this.onDone
    this.onDone = null
    done?.({ kind: "ok", values } as PickManyResult<T>)
  }

  private cancel(): void {
    const done = this.onDone
    this.onDone = null
    done?.({ kind: "cancel" } as PickSingleResult<T> | PickManyResult<T>)
  }
}

// ---------- 忙碌状态(运行指示器 + Esc 双击打断) ----------
interface BusyState {
  text: string
  controller: AbortController
  timer: ReturnType<typeof setInterval>
  escTimer: ReturnType<typeof setTimeout> | null
  escArmedAt: number
  hint: string
  i: number
  frame: Frame
}

// ---------- 屏幕 ----------
export class Screen {
  ctrlCHint = ""
  private stack: Widget[] = []
  private history: string[] = []
  private lastCtrlC = 0
  private ctrlHintTimer: ReturnType<typeof setTimeout> | null = null
  private busy: BusyState | null = null
  private keys = new KeyReader()
  private suggest: (line: string) => SuggestResult

  constructor(suggest: (line: string) => SuggestResult) {
    this.suggest = suggest
    input.setRawMode(true)
    input.resume()
    input.setEncoding("utf8")
    input.on("data", (chunk: string) => {
      this.keys.onData(chunk, (k) => this.dispatch(k))
    })
  }

  ask(prompt: string, opts: AskOptions = {}): Promise<string | null> {
    return new Promise((resolve) => {
      const sg = opts.suggest === null ? EMPTY_SUGGEST : (opts.suggest ?? this.suggest)
      const history = opts.remember === false ? [] : this.history
      const w = new TextInputWidget(this, prompt, sg, history, opts)
      this.stack.push(w)
      w.refresh()
      w.onDone = (value) => {
        this.stack.pop()
        w.close()
        if (value !== null && value.trim() && opts.remember !== false) {
          this.history.push(value.trim())
        }
        resolve(value)
        this.refresh()
      }
    })
  }

  pickSingle<T>(opts: PickSingleOptions<T>): Promise<PickSingleResult<T>> {
    return new Promise((resolve) => {
      const w = new SelectWidget<T>(this, { ...opts, multi: false })
      this.stack.push(w)
      w.refresh()
      w.onDone = (r) => {
        this.stack.pop()
        w.close()
        resolve(r as PickSingleResult<T>)
        this.refresh()
      }
    })
  }

  pickMany<T>(opts: PickManyOptions<T>): Promise<PickManyResult<T>> {
    return new Promise((resolve) => {
      const w = new SelectWidget<T>(this, { ...opts, multi: true })
      this.stack.push(w)
      w.refresh()
      w.onDone = (r) => {
        this.stack.pop()
        w.close()
        resolve(r as PickManyResult<T>)
        this.refresh()
      }
    })
  }

  isBusy(): boolean {
    return this.busy !== null
  }

  abortCurrent(): void {
    this.busy?.controller.abort()
  }

  async withBusy<T>(text: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
    if (this.busy) return null
    const controller = new AbortController()
    const state: BusyState = {
      text,
      controller,
      timer: null as unknown as ReturnType<typeof setInterval>,
      escTimer: null,
      escArmedAt: 0,
      hint: "",
      i: 0,
      frame: new Frame(),
    }
    const renderBusy = () => {
      state.frame.render([paint(`${state.text} ${FRAMES[state.i]} ${state.hint}`.trimEnd(), COLOR.yellow)])
    }
    this.busy = state
    renderBusy()
    state.timer = setInterval(() => {
      state.i = (state.i + 1) % FRAMES.length
      renderBusy()
    }, 120)
    try {
      const result = await fn(controller.signal)
      return result
    } catch (e) {
      if (controller.signal.aborted) return null
      throw e
    } finally {
      clearInterval(state.timer)
      if (state.escTimer) clearTimeout(state.escTimer)
      state.frame.close()
      this.busy = null
    }
  }

  private refresh(): void {
    const w = this.stack[this.stack.length - 1]
    if (w) w.refresh()
  }

  private dispatch(k: Key): void {
    if (this.busy) {
      if (k.type === "esc") this.onBusyEsc()
      else if (k.type === "ctrl-c") this.onCtrlC()
      return
    }
    if (k.type === "ctrl-c") {
      this.onCtrlC()
      return
    }
    const w = this.stack[this.stack.length - 1]
    if (w) w.onKey(k)
  }

  private onCtrlC(): void {
    const now = Date.now()
    if (now - this.lastCtrlC < CTRL_C_WINDOW) process.exit(0)
    this.lastCtrlC = now
    this.ctrlCHint = "⚠️ 再按一次 Ctrl+C 退出(3 秒内)"
    if (this.ctrlHintTimer) clearTimeout(this.ctrlHintTimer)
    this.ctrlHintTimer = setTimeout(() => {
      this.ctrlCHint = ""
      this.refresh()
    }, CTRL_C_WINDOW)
    this.refresh()
  }

  private onBusyEsc(): void {
    const b = this.busy
    if (!b) return
    const now = Date.now()
    if (b.escArmedAt && now - b.escArmedAt < ESC_ARM_WINDOW) {
      b.escArmedAt = 0
      if (b.escTimer) clearTimeout(b.escTimer)
      b.hint = "⏹ 正在停止…"
      b.i = 0
      b.controller.abort()
      return
    }
    b.escArmedAt = now
    b.hint = "· 再按 Esc 打断(5 秒内)"
    if (b.escTimer) clearTimeout(b.escTimer)
    b.escTimer = setTimeout(() => {
      b.escArmedAt = 0
      b.hint = ""
      b.i = 0
      if (this.busy === b) this.renderBusy(b)
    }, ESC_ARM_WINDOW)
    this.renderBusy(b)
  }

  private renderBusy(b: BusyState): void {
    b.frame.render([paint(`${b.text} ${FRAMES[b.i]} ${b.hint}`.trimEnd(), COLOR.yellow)])
  }
}

// ---------- 模块级单例(兼容旧 withBusy 调用) ----------
let screen: Screen | null = null

export function createScreen(opts: { suggest: (line: string) => SuggestResult }): Screen {
  return new Screen(opts.suggest)
}

export function setScreen(s: Screen | null): void {
  screen = s
}

export function isBusy(): boolean {
  return screen?.isBusy() ?? false
}

export function abortCurrent(): void {
  screen?.abortCurrent()
}

export async function withBusy<T>(
  text: string,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T | null> {
  if (screen) return screen.withBusy(text, fn)
  // 非 TTY:无指示器,直接执行(仍支持 signal)
  const controller = new AbortController()
  try {
    return await fn(controller.signal)
  } catch (e) {
    if (controller.signal.aborted) return null
    throw e
  }
}

function truncate(s: string, max: number): string {
  const chars = [...s]
  return chars.length > max ? chars.slice(0, max).join("") + "…" : s
}

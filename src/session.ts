// 会话持久化:记录最近对话 + 批量写作断点(用于 -c/continue 继续工作)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { LAYOUT } from "./novel.ts"

export interface SessionEntry {
  role: "user" | "assistant"
  content: string
  time: string
}

export interface PendingWrite {
  startNum: number
  count: number
  done: number
  instruction: string
  at: string
}

export interface SessionData {
  entries: SessionEntry[]
  pendingWrite?: PendingWrite
}

export function sessionPath(root: string): string {
  return path.join(root, LAYOUT.agent, "session.json")
}

export function loadSession(root: string): SessionData {
  try {
    if (existsSync(sessionPath(root))) {
      return JSON.parse(readFileSync(sessionPath(root), "utf-8")) as SessionData
    }
  } catch {
    /* 损坏则重置 */
  }
  return { entries: [] }
}

export function saveSession(root: string, data: SessionData) {
  const p = sessionPath(root)
  const dir = path.dirname(p)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(p, JSON.stringify(data, null, 2), "utf-8")
}

// 追加一条对话记录(保留最近 max 条,单条截断 2000 字)
export function appendEntry(root: string, role: "user" | "assistant", content: string, max = 20) {
  const data = loadSession(root)
  data.entries.push({ role, content: content.slice(0, 2000), time: new Date().toISOString() })
  if (data.entries.length > max) data.entries = data.entries.slice(-max)
  saveSession(root, data)
}

export function setPendingWrite(root: string, pending: PendingWrite | undefined) {
  const data = loadSession(root)
  data.pendingWrite = pending
  saveSession(root, data)
}

// 显示会话回顾(最近 n 条)
export function showSession(root: string, n = 5): void {
  const data = loadSession(root)
  if (data.entries.length === 0) {
    console.log("暂无历史会话记录")
    return
  }
  console.log(`📜 最近会话回顾(共 ${data.entries.length} 条记录):`)
  for (const e of data.entries.slice(-n)) {
    const t = new Date(e.time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    const role = e.role === "user" ? "你" : "AI"
    const content = e.content.replace(/\s+/g, " ").slice(0, 100)
    console.log(`  [${t}] ${role}: ${content}${e.content.length > 100 ? "…" : ""}`)
  }
}

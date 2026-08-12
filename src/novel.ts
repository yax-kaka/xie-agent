// 作品库:文件即数据库,零外部写入;v0.7 起目录与文件名全部中文化
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "fs"
import path from "path"

export const NOVEL_MARKER = "novel.json"

// ---------- 中文目录/文件布局 ----------
export const LAYOUT = {
  chapters: "章节",
  characters: "人物",
  scenes: "场景",
  world: "世界观",
  outline: "大纲",
  notes: "笔记",
  summaries: "摘要",
  style: "风格.md",
  timeline: "时间线.md",
  vault: "伏笔.md",
  growth: "成长.md",
  arc: "大纲/总纲.md",
  ideas: "笔记/灵感.md",
  agent: ".会话",
}

// 旧版(v0.6 及以前)英文目录/文件 → 中文,启动时自动迁移一次
const LEGACY_DIRS: [string, string][] = [
  ["chapters", "章节"],
  ["characters", "人物"],
  ["scenes", "场景"],
  ["world", "世界观"],
  ["outline", "大纲"],
  ["notes", "笔记"],
  ["summaries", "摘要"],
]
const LEGACY_FILES: [string, string][] = [
  ["style.md", "风格.md"],
  ["timeline.md", "时间线.md"],
  ["vault.md", "伏笔.md"],
  ["growth.md", "成长.md"],
  ["笔记/ideas.md", "笔记/灵感.md"],
  ["大纲/arc.md", "大纲/总纲.md"],
]

export function migrateNovelLayout(root: string): void {
  for (const [oldName, newName] of LEGACY_DIRS) {
    const oldP = path.join(root, oldName)
    const newP = path.join(root, newName)
    if (existsSync(oldP) && !existsSync(newP)) {
      try {
        renameSync(oldP, newP)
      } catch {
        /* 迁移失败不阻塞启动 */
      }
    }
  }
  for (const [oldName, newName] of LEGACY_FILES) {
    const oldP = path.join(root, oldName)
    const newP = path.join(root, newName)
    if (oldName !== newName && existsSync(oldP) && !existsSync(newP)) {
      try {
        renameSync(oldP, newP)
      } catch {
        /* 忽略 */
      }
    }
  }
  const oldAgent = path.join(root, ".agent")
  const newAgent = path.join(root, LAYOUT.agent)
  if (existsSync(oldAgent) && !existsSync(newAgent)) {
    try {
      renameSync(oldAgent, newAgent)
    } catch {
      /* 忽略 */
    }
  }
}

// ---------- 基础 ----------
export function findNovelRoot(start: string): string | null {
  let dir = path.resolve(start)
  for (;;) {
    if (existsSync(path.join(dir, NOVEL_MARKER))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function isNovelRoot(dir: string): boolean {
  return existsSync(path.join(dir, NOVEL_MARKER))
}

function readFileSafe(p: string): string | null {
  return existsSync(p) ? readFileSync(p, "utf-8") : null
}

// ---------- 作品脚手架 ----------
export function scaffoldNovel(root: string, name: string) {
  for (const d of [LAYOUT.chapters, LAYOUT.characters, LAYOUT.world, LAYOUT.outline, LAYOUT.notes, LAYOUT.summaries, LAYOUT.scenes]) {
    const p = path.join(root, d)
    if (!existsSync(p)) mkdirSync(p, { recursive: true })
  }
  const novelJson = path.join(root, NOVEL_MARKER)
  if (!existsSync(novelJson)) {
    const meta = {
      name,
      description: "",
      createdAt: new Date().toISOString(),
      currentChapter: 1,
      currentTime: "第 1 年 春",
      model: { provider: "deepseek", model: "deepseek-v4-flash" },
      style: "中文网文,快节奏,章末留钩子",
      permissions: { edit: { "*": "allow" } },
      picker: { hiddenCharacters: [], hiddenScenes: [] },
    }
    writeFileSync(novelJson, JSON.stringify(meta, null, 2) + "\n", "utf-8")
  }
  const files: Record<string, string> = {
    [LAYOUT.style]: "# 写作风格\n\n- 题材:网文\n- 视角:第三人称\n- 节奏:快节奏,章末留钩子\n",
    [LAYOUT.arc]: "# 总纲\n\n(待填写:全书主线、卷结构)\n",
    [LAYOUT.timeline]: "# 剧情时间线\n\n| 章节 | 时间点 | 事件 |\n|---|---|---|\n",
    [LAYOUT.vault]: "# 伏笔台账\n\n| 伏笔 | 埋设章 | 状态 | 计划回收 |\n|---|---|---|---|\n",
    [LAYOUT.growth]: "# 主角成长\n\n| 阶段 | 章节 | 成长描述 |\n|---|---|---|\n",
    [LAYOUT.ideas]: "# 灵感碎片\n\n",
  }
  for (const [f, content] of Object.entries(files)) {
    const p = path.join(root, f)
    if (!existsSync(p)) writeFileSync(p, content, "utf-8")
  }
}

// ---------- 章节 ----------
export function listChapters(root: string): string[] {
  const dir = path.join(root, LAYOUT.chapters)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

export function readChapter(root: string, filename: string): string | null {
  return readFileSafe(path.join(root, LAYOUT.chapters, filename))
}

export function appendChapter(root: string, filename: string, content: string) {
  const dir = path.join(root, LAYOUT.chapters)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const p = path.join(dir, filename)
  const existing = existsSync(p) ? readFileSync(p, "utf-8") : ""
  writeFileSync(p, existing + content, "utf-8")
}

// 创建新章节,返回文件名(如 002.md);指定 num 时按该编号(已存在则复用,便于批量从指定章写)
export function newChapter(root: string, title: string, num?: number, meta?: { location?: string; chars?: string[]; pov?: string }): string {
  const list = listChapters(root)
  const n = num ?? list.length + 1
  const filename = `${String(n).padStart(3, "0")}.md`
  const dir = path.join(root, LAYOUT.chapters)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const p = path.join(dir, filename)
  const location = meta?.location ?? ""
  const chars = meta?.chars?.length ? `[${meta.chars.join(", ")}]` : "[]"
  const pov = meta?.pov ?? ""
  const template = `---\ntitle: ${title}\ntime: \nlocation: ${location}\nchars: ${chars}\npov: ${pov}\n---\n\n`
  if (!existsSync(p)) {
    writeFileSync(p, template, "utf-8")
  } else {
    // 复用已有文件:若正文为空模板,更新标题与元数据
    const text = readFileSync(p, "utf-8")
    const body = text.replace(/^---\n[\s\S]*?\n---\n/, "")
    if (body.trim() === "") writeFileSync(p, template, "utf-8")
  }
  return filename
}

// 解析章节 YAML front matter
export function chapterMeta(root: string, filename: string): Record<string, string> {
  const text = readChapter(root, filename) ?? ""
  const m = text.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return {}
  const meta: Record<string, string> = {}
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":")
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return meta
}

// ---------- 人物 ----------
export function readCharacter(root: string, name: string): string | null {
  const dir = path.join(root, LAYOUT.characters)
  for (const c of [name, `${name}.md`]) {
    const p = path.join(dir, c)
    if (existsSync(p)) return readFileSync(p, "utf-8")
  }
  return null
}

export function listCharacters(root: string): string[] {
  const dir = path.join(root, LAYOUT.characters)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith(".md"))
}

export function addCharacter(root: string, name: string, desc: string) {
  const dir = path.join(root, LAYOUT.characters)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}.md`)
  if (!existsSync(file)) {
    writeFileSync(file, `# ${name}\n\n- 身份:\n- 外貌:\n- 性格:\n- 动机:\n- 初始设定:${desc}\n`, "utf-8")
  }
}

export function updateCharacter(root: string, name: string, content: string) {
  const dir = path.join(root, LAYOUT.characters)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, `${name}.md`), content.trim() + "\n", "utf-8")
}

// ---------- 世界观 ----------
export function listWorld(root: string): string[] {
  const dir = path.join(root, LAYOUT.world)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith(".md"))
}

export function readWorld(root: string, name: string): string | null {
  const dir = path.join(root, LAYOUT.world)
  for (const c of [name, `${name}.md`]) {
    const p = path.join(dir, c)
    if (existsSync(p)) return readFileSync(p, "utf-8")
  }
  return null
}

export function addWorld(root: string, name: string, content: string) {
  const dir = path.join(root, LAYOUT.world)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}.md`)
  writeFileSync(file, `# ${name}\n\n${content}\n`, "utf-8")
}

export function updateWorld(root: string, name: string, content: string) {
  const dir = path.join(root, LAYOUT.world)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, `${name}.md`), content.trim() + "\n", "utf-8")
}

// ---------- 风格 ----------
export function readStyle(root: string): string {
  return readFileSafe(path.join(root, LAYOUT.style)) ?? ""
}

export function writeStyle(root: string, text: string) {
  writeFileSync(path.join(root, LAYOUT.style), text, "utf-8")
}

// ---------- 大纲 ----------
export function readOutline(root: string): string {
  return readFileSafe(path.join(root, LAYOUT.arc)) ?? ""
}

export function appendOutline(root: string, line: string) {
  const dir = path.join(root, LAYOUT.outline)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const p = path.join(root, LAYOUT.arc)
  writeFileSync(p, (readFileSafe(p) ?? "") + line + "\n", "utf-8")
}

// ---------- 表格解析工具 ----------
function parseTable(text: string): string[][] {
  return text
    .split("\n")
    .filter((l) => l.trim().startsWith("|"))
    .map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()))
    .filter((row) => !(row.length === 1 && /^-+$/.test(row[0])) && !row.every((c) => /^-+$/.test(c)))
}

// ---------- 时间线 ----------
export function addTimeline(root: string, chapter: string, time: string, event: string) {
  const p = path.join(root, LAYOUT.timeline)
  writeFileSync(p, (readFileSafe(p) ?? "") + `| ${chapter} | ${time} | ${event} |\n`, "utf-8")
}

export function listTimeline(root: string): string[][] {
  const text = readFileSafe(path.join(root, LAYOUT.timeline)) ?? ""
  return parseTable(text).filter((r) => r.length >= 3 && r[0] !== "章节")
}

// ---------- 伏笔 ----------
export interface VaultEntry {
  name: string
  chapter: string
  status: string
  plan: string
}

export function listVault(root: string): VaultEntry[] {
  const text = readFileSafe(path.join(root, LAYOUT.vault)) ?? ""
  return parseTable(text)
    .filter((r) => r.length >= 3 && r[0] !== "伏笔")
    .map((r) => ({ name: r[0], chapter: r[1], status: r[2], plan: r[3] ?? "" }))
}

export function addVault(root: string, name: string, chapter: string, plan: string) {
  const p = path.join(root, LAYOUT.vault)
  writeFileSync(p, (readFileSafe(p) ?? "") + `| ${name} | ${chapter} | 未回收 | ${plan} |\n`, "utf-8")
}

export function closeVault(root: string, name: string): boolean {
  const p = path.join(root, LAYOUT.vault)
  const text = readFileSafe(p) ?? ""
  const rows = text.split("\n")
  let found = false
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].includes(`| ${name} |`)) {
      rows[i] = rows[i].replace("未回收", "已回收")
      found = true
    }
  }
  if (found) writeFileSync(p, rows.join("\n"), "utf-8")
  return found
}

// ---------- 主角成长 ----------
export function readGrowth(root: string): string {
  return readFileSafe(path.join(root, LAYOUT.growth)) ?? ""
}

export function addGrowth(root: string, stage: string, chapter: string, desc: string) {
  const p = path.join(root, LAYOUT.growth)
  writeFileSync(p, (readFileSafe(p) ?? "") + `| ${stage} | ${chapter} | ${desc} |\n`, "utf-8")
}

// ---------- 灵感 ----------
export function addIdea(root: string, text: string) {
  const p = path.join(root, LAYOUT.ideas)
  writeFileSync(p, (readFileSafe(p) ?? "") + `- ${text}\n`, "utf-8")
}

export function listIdeas(root: string): string[] {
  const text = readFileSafe(path.join(root, LAYOUT.ideas)) ?? ""
  return text.split("\n").filter((l) => l.trim().startsWith("- ")).map((l) => l.trim().slice(2))
}

// ---------- 场景(地点) ----------
export function listScenes(root: string): string[] {
  const dir = path.join(root, LAYOUT.scenes)
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith(".md"))
}

export function readScene(root: string, name: string): string | null {
  const dir = path.join(root, LAYOUT.scenes)
  for (const c of [name, `${name}.md`]) {
    const p = path.join(dir, c)
    if (existsSync(p)) return readFileSync(p, "utf-8")
  }
  return null
}

export function addScene(root: string, name: string, content: string) {
  const dir = path.join(root, LAYOUT.scenes)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}.md`)
  writeFileSync(file, `# ${name}\n\n${content}\n`, "utf-8")
}

export function updateScene(root: string, name: string, content: string) {
  const dir = path.join(root, LAYOUT.scenes)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, `${name}.md`), content.trim() + "\n", "utf-8")
}

// 替换章节 YAML 的 location/chars(写作向导写入元数据后使用)
export function updateChapterMeta(root: string, filename: string, meta: { location?: string; chars?: string[]; pov?: string }) {
  const p = path.join(root, LAYOUT.chapters, filename)
  const text = readFileSafe(p)
  if (!text) return
  let out = text
  if (meta.location !== undefined) out = out.replace(/^(location:).*$/m, `$1 ${meta.location}`)
  if (meta.chars !== undefined) out = out.replace(/^(chars:).*$/m, `$1 [${meta.chars.join(", ")}]`)
  if (meta.pov !== undefined) out = out.replace(/^(pov:).*$/m, `$1 ${meta.pov}`)
  writeFileSync(p, out, "utf-8")
}

// 返回第一个空模板章节的文件名(正文为空),没有则 null(用于新作品从第 1 章开始写)
export function firstEmptyChapter(root: string): string | null {
  for (const f of listChapters(root)) {
    const text = readFileSafe(path.join(root, LAYOUT.chapters, f))
    if (text && text.replace(/^---\n[\s\S]*?\n---\n/, "").trim() === "") return f
  }
  return null
}

// ---------- 删除(永久删除,调用方需确认) ----------
function deleteEntity(root: string, dir: string, name: string): boolean {
  for (const c of [name, `${name}.md`]) {
    const p = path.join(root, dir, c)
    if (existsSync(p)) {
      rmSync(p)
      return true
    }
  }
  return false
}

export function deleteCharacter(root: string, name: string): boolean {
  return deleteEntity(root, LAYOUT.characters, name)
}

export function deleteScene(root: string, name: string): boolean {
  return deleteEntity(root, LAYOUT.scenes, name)
}

export function deleteWorld(root: string, name: string): boolean {
  return deleteEntity(root, LAYOUT.world, name)
}

// ---------- 统计 ----------
export function chapterWords(root: string): { file: string; words: number }[] {
  return listChapters(root).map((f) => {
    const text = readChapter(root, f) ?? ""
    const body = text.replace(/^---\n[\s\S]*?\n---\n/, "")
    return { file: f, words: body.replace(/\s/g, "").length }
  })
}

// ---------- 卷(逻辑卷:每 10 章一卷) ----------
export function volOf(num: number): number {
  return Math.ceil(num / 10)
}

export function volRange(vol: number): { start: number; end: number } {
  return { start: (vol - 1) * 10 + 1, end: vol * 10 }
}

export function listVolSummaries(root: string): { vol: number; text: string }[] {
  const dir = path.join(root, LAYOUT.summaries)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ vol: Number(f.replace(/\D/g, "")) || 0, text: readFileSafe(path.join(dir, f)) ?? "" }))
    .filter((s) => s.vol > 0)
    .sort((a, b) => a.vol - b.vol)
}

export function readVolSummary(root: string, vol: number): string | null {
  return readFileSafe(path.join(root, LAYOUT.summaries, `vol${vol}.md`))
}

export function writeVolSummary(root: string, vol: number, text: string) {
  const dir = path.join(root, LAYOUT.summaries)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, `vol${vol}.md`), text, "utf-8")
}

// ---------- 章节大纲(从 大纲/总纲.md 的 ## 章节大纲 解析) ----------
export interface ChapterPlan {
  num: number
  title: string
  content: string
}

export function chapterPlan(root: string): ChapterPlan[] {
  const text = readOutline(root)
  const plans: ChapterPlan[] = []
  for (const line of text.split("\n")) {
    const m = line.match(/^[-*]?\s*第\s*(\d+)\s*章\s*([^:：]*?)(?:[:：]\s*(.*))?$/)
    if (m) plans.push({ num: Number(m[1]), title: m[2].trim(), content: (m[3] ?? "").trim() })
  }
  return plans.sort((a, b) => a.num - b.num)
}

// ---------- 全文检索 ----------
export function searchChapters(root: string, kw: string, limit = 5): { file: string; line: string }[] {
  const res: { file: string; line: string }[] = []
  for (const f of listChapters(root)) {
    const text = readChapter(root, f)
    if (!text) continue
    let hit = 0
    for (const line of text.split("\n")) {
      if (line.includes(kw)) {
        res.push({ file: f, line: line.trim().slice(0, 120) })
        hit++
        if (hit >= 3) break
      }
    }
    if (res.length >= limit * 3) break
  }
  return res.slice(0, limit)
}

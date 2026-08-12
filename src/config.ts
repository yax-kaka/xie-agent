// 配置:作品级 novel.json 加载与写入(仿 opencode 配置合并,但 MVP 阶段仅作品级,零外部写入)
import { existsSync, readFileSync, writeFileSync } from "fs"
import path from "path"
import { NOVEL_MARKER } from "./novel.ts"

export interface ModelConfig {
  provider: string
  model?: string
  apiKey?: string
  baseURL?: string
  /** 温度(0-2):写作类默认 0.9,校验类 0.3;不配置则用任务默认 */
  temperature?: number
  /** top_p(0-1):不配置则不发送,用提供商默认 */
  topP?: number
  /** reasoning_effort(low/medium/high):不配置则不发送;控制 reasoning 模型的思考程度 */
  reasoningEffort?: string
  maxTokens?: number
}

export interface NovelConfig {
  name: string
  description?: string
  currentChapter?: number
  currentTime?: string
  model: ModelConfig
  style?: string
  permissions?: Record<string, unknown>
  /** 选择器可见性管理(名字去掉 .md;缺省全部可见) */
  picker?: {
    hiddenCharacters: string[]
    hiddenScenes: string[]
  }
  [key: string]: unknown
}

export function loadConfig(root: string): NovelConfig {
  const p = path.join(root, NOVEL_MARKER)
  if (!existsSync(p)) {
    throw new Error(`未找到作品配置 ${p},请先运行 /初始化 初始化作品`)
  }
  const raw = readFileSync(p, "utf-8")
  return JSON.parse(raw) as NovelConfig
}

export function saveConfig(root: string, cfg: NovelConfig) {
  const p = path.join(root, NOVEL_MARKER)
  // 合并磁盘上的 picker 可见性状态,避免旧 ctx.config 覆盖选择器里的隐藏/显示修改
  try {
    const onDisk = JSON.parse(readFileSync(p, "utf-8")) as NovelConfig
    const picker = (onDisk.picker ?? { hiddenCharacters: [], hiddenScenes: [] }) as PickerState
    cfg.picker = {
      hiddenCharacters: [...picker.hiddenCharacters],
      hiddenScenes: [...picker.hiddenScenes],
    }
  } catch {
    /* novel.json 缺失或损坏时直接写入 */
  }
  writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n", "utf-8")
}

// ---------- 选择器可见性 ----------
export interface PickerState {
  hiddenCharacters: string[]
  hiddenScenes: string[]
}

export function pickerState(root: string): PickerState {
  const cfg = loadConfig(root)
  const p = (cfg.picker ?? {}) as { hiddenCharacters?: string[]; hiddenScenes?: string[] }
  return {
    hiddenCharacters: p.hiddenCharacters ?? [],
    hiddenScenes: p.hiddenScenes ?? [],
  }
}

export function isCharHidden(root: string, name: string): boolean {
  return pickerState(root).hiddenCharacters.includes(name)
}

export function isSceneHidden(root: string, name: string): boolean {
  return pickerState(root).hiddenScenes.includes(name)
}

export function setCharHidden(root: string, name: string, hidden: boolean): void {
  const file = path.join(root, NOVEL_MARKER)
  const cfg = JSON.parse(readFileSync(file, "utf-8")) as NovelConfig
  const p = (cfg.picker ??= { hiddenCharacters: [], hiddenScenes: [] })
  p.hiddenCharacters ??= []
  if (hidden && !p.hiddenCharacters.includes(name)) p.hiddenCharacters.push(name)
  if (!hidden) p.hiddenCharacters = p.hiddenCharacters.filter((n) => n !== name)
  writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n", "utf-8")
}

export function setSceneHidden(root: string, name: string, hidden: boolean): void {
  const file = path.join(root, NOVEL_MARKER)
  const cfg = JSON.parse(readFileSync(file, "utf-8")) as NovelConfig
  const p = (cfg.picker ??= { hiddenCharacters: [], hiddenScenes: [] })
  p.hiddenScenes ??= []
  if (hidden && !p.hiddenScenes.includes(name)) p.hiddenScenes.push(name)
  if (!hidden) p.hiddenScenes = p.hiddenScenes.filter((n) => n !== name)
  writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n", "utf-8")
}

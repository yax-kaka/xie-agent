// 共享类型
import path from "path"
import type { NovelConfig } from "./config.ts"

// ---------- 选择器选项与结果 ----------
export interface SelectOption<T = string> {
  value: T
  label: string
  description?: string
  /** true = 不在候选列表显示(但输入名字过滤时仍可选中) */
  hidden?: boolean
  /** 分组标题(渲染为不可选的分组行,如模型选择按提供商分组) */
  category?: string
  /** 标记为"当前项"(行首显示 ●) */
  current?: boolean
}

export interface PickSingleOptions<T> {
  title: string
  options: SelectOption<T>[]
  /** 是否提供「(无)」选项,选中后 value 为 null */
  allowNone?: boolean
  /** 选择「＋ 新建…」时的回调,返回新值;返回 null 表示取消 */
  onCreate?: () => Promise<T | null>
  /** 新建项加入列表后回调(可同步 hidden 状态) */
  onCreated?: (opt: SelectOption<T>) => void
  /** 按 h 切换可见性时回调(负责持久化) */
  onToggleHidden?: (opt: SelectOption<T>) => void | Promise<void>
  /** 按 d 连按两次删除时回调(负责删除数据) */
  onDelete?: (opt: SelectOption<T>) => void | Promise<void>
}

export interface PickManyOptions<T> extends PickSingleOptions<T> {
  /** 是否允许多选(默认 true) */
}

export type PickSingleResult<T> = { kind: "ok"; value: T | null } | { kind: "cancel" }
export type PickManyResult<T> = { kind: "ok"; values: T[] } | { kind: "cancel" }

// ---------- 命令上下文 ----------
export interface CommandContext {
  root: string // 作品根目录
  cwd: string // 当前工作目录
  config: NovelConfig
  ask: (question: string) => Promise<string> // 交互式提问(供向导类命令使用)
  /** 可取消提问:按 Esc 返回 null(向导"返回上一步"用);非 TTY 永不返回 null */
  askCancellable: (question: string, opts?: { initial?: string }) => Promise<string | null>
  pickSingle: <T>(opts: PickSingleOptions<T>) => Promise<PickSingleResult<T>>
  pickMany: <T>(opts: PickManyOptions<T>) => Promise<PickManyResult<T>>
}

export interface Command {
  name: string // 中文命令名(如 人物)
  aliases?: string[] // 英文别名(如 char)
  description: string
  usage?: string
  examples?: string[]
  handler: (ctx: CommandContext, args: string) => Promise<void> | void
}

export function err(e: unknown): string {
  return `❌ ${(e as Error).message}`
}

// 作品内文件的绝对路径(保存类命令输出,便于用户直接打开微调)
export function p(ctx: CommandContext, rel: string): string {
  return path.join(ctx.root, rel)
}

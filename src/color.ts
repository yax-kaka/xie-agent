// ANSI 颜色:仅 TTY 交互界面使用;NO_COLOR 或非 TTY 时全部纯文本
const RESET = "\x1b[0m"

export const COLOR = {
  cyanBold: "\x1b[36;1m", // 激活项
  green: "\x1b[32m", // 当前标记
  dim: "\x1b[2m", // 未激活/提示
  yellow: "\x1b[33m", // 忙碌
  red: "\x1b[31m", // 错误
  bold: "\x1b[1m",
} as const

export function colorEnabled(): boolean {
  return process.stdout.isTTY === true && !process.env.NO_COLOR
}

export function paint(text: string, code: string): string {
  return colorEnabled() ? code + text + RESET : text
}

export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "")
}

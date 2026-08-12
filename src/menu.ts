// 通用操作菜单选择器:命令无参数时弹出操作列表(对齐 /model 的交互)
import type { CommandContext, SelectOption } from "./types.ts"

export async function pickOp<T extends string>(
  ctx: CommandContext,
  title: string,
  options: SelectOption<T>[],
): Promise<T | null> {
  const res = await ctx.pickSingle<T>({ title, options })
  return res.kind === "ok" && res.value !== null ? res.value : null
}

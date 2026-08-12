// 子命令中英文映射:/人物 列表 == /char list
const OP_MAP: Record<string, string> = {
  // 通用
  list: "list",
  列表: "list",
  show: "view",
  查看: "view",
  add: "add",
  添加: "add",
  gen: "gen",
  生成: "gen",
  hide: "hide",
  隐藏: "hide",
  unhide: "unhide",
  显示: "unhide",
  del: "del",
  删除: "del",
  rm: "del",
  edit: "edit",
  修改: "edit",
  // 伏笔
  close: "close",
  关闭: "close",
  // 时间线
  next: "next",
  下一个: "next",
  推进: "next",
  // 风格
  set: "set",
  设置: "set",
  extract: "extract",
  提炼: "extract",
  // 章节
  new: "new",
  新建: "new",
  go: "go",
  定位: "go",
  // 摘要
  all: "all",
  全部: "all",
  // 配置
  provider: "provider",
  供应商: "provider",
  model: "model",
  模型: "model",
  "api-key": "api-key",
  密钥: "api-key",
  style: "style",
  风格: "style",
  temperature: "temperature",
  温度: "temperature",
  "top-p": "top-p",
  top_p: "top-p",
  topp: "top-p",
  topP: "top-p",
  "reasoning-effort": "reasoning-effort",
  思考程度: "reasoning-effort",
  default: "default",
  默认: "default",
  还原: "default",
}

export function splitOp(args: string): { op: string; rest: string[] } {
  const parts = args.trim().split(/\s+/)
  if (parts.length === 0 || parts[0] === "") return { op: "", rest: [] }
  const [raw, ...rest] = parts
  return { op: OP_MAP[raw] ?? raw, rest }
}

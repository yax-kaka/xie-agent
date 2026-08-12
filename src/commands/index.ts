// 命令注册表:主名英文(输入法友好),中文为别名;显示用 cmdLabel 输出 /model(模型)
import type { Command } from "../types.ts"
import { initCmd, configCmd, modelCmd, helpCmd, quitCmd, continueCmd } from "./manage.ts"
import { writeCmd } from "./write.ts"
import { worldCmd, styleCmd, outlineCmd, timeCmd, growthCmd } from "./setting.ts"
import { charCmd, chapterCmd, vaultCmd, ideaCmd, sceneCmd } from "./entity.ts"
import { checkCmd, readerCmd, exportCmd, statsCmd, summaryCmd, searchCmd } from "./quality.ts"

const commands: Record<string, Command> = {
  init: initCmd,
  write: writeCmd,
  char: charCmd,
  chapter: chapterCmd,
  world: worldCmd,
  style: styleCmd,
  outline: outlineCmd,
  time: timeCmd,
  growth: growthCmd,
  vault: vaultCmd,
  scene: sceneCmd,
  idea: ideaCmd,
  check: checkCmd,
  reader: readerCmd,
  export: exportCmd,
  stats: statsCmd,
  summary: summaryCmd,
  search: searchCmd,
  config: configCmd,
  model: modelCmd,
  help: helpCmd,
  continue: continueCmd,
  quit: quitCmd,
}

export function getCommand(name: string): Command | undefined {
  const key = name.replace(/^\//, "")
  const direct = commands[key]
  if (direct) return direct
  return Object.values(commands).find((c) => (c.aliases ?? []).includes(key))
}

export function listCommands(): Command[] {
  return Object.values(commands)
}

// 双语显示:/model(模型);取第一个中文别名作为括号注释
export function cmdLabel(c: Command): string {
  const zh = (c.aliases ?? []).find((a) => /[\u4e00-\u9fff]/.test(a))
  return zh ? `/${c.name}(${zh})` : `/${c.name}`
}

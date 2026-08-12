// 工具注册表(参考 opencode 的 tool 机制):AI 意图路由按需调用。
// 文件工具限定在作品目录内;写操作在意图层统一先确认再执行。
import path from "path"
import { existsSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from "fs"
import type { CommandContext } from "./types.ts"
import { charCmd, sceneCmd, chapterCmd, vaultCmd, ideaCmd } from "./commands/entity.ts"
import { worldCmd, styleCmd, outlineCmd, timeCmd, growthCmd } from "./commands/setting.ts"
import { checkCmd, readerCmd, exportCmd, statsCmd, summaryCmd, searchCmd } from "./commands/quality.ts"
import { modelCmd, continueCmd, quitCmd } from "./commands/manage.ts"

export interface ToolParam {
  name: string
  required: boolean
  desc: string
  prompt: string
}

export interface Tool {
  id: string
  label: string
  params: ToolParam[]
  run: (ctx: CommandContext, args: Record<string, string>) => Promise<void>
}

function cmdTool(
  id: string,
  label: string,
  params: ToolParam[],
  command: { handler: (ctx: CommandContext, args: string) => Promise<void> | void },
  buildArgs: (a: Record<string, string>) => string,
): Tool {
  return {
    id,
    label,
    params,
    run: async (ctx, a) => {
      await command.handler(ctx, buildArgs(a))
    },
  }
}

function resolveSafe(root: string, file: string): string {
  const r = path.resolve(root, file || "")
  const base = path.resolve(root)
  if (r !== base && !r.startsWith(base + path.sep)) throw new Error(`路径超出作品目录:${file}`)
  return r
}

export const TOOLS: Tool[] = [
  cmdTool("char_add", "新建角色", [
    { name: "name", required: true, desc: "角色名", prompt: "角色名字(回车 = 取消):" },
    { name: "desc", required: true, desc: "一句话设定", prompt: "一句话设定(回车 = 取消):" },
  ], charCmd, (a) => `添加 ${a.name} ${a.desc}`),
  cmdTool("char_view", "查看角色", [
    { name: "name", required: true, desc: "角色名", prompt: "角色名字(回车 = 取消):" },
  ], charCmd, (a) => `查看 ${a.name}`),
  cmdTool("char_edit", "修改角色", [
    { name: "name", required: true, desc: "角色名", prompt: "角色名字(回车 = 取消):" },
    { name: "instruction", required: false, desc: "修改意见", prompt: "修改意见(回车 = AI 自动完善):" },
  ], charCmd, (a) => `修改 ${a.name}${a.instruction ? " " + a.instruction : ""}`),
  cmdTool("char_del", "删除角色", [
    { name: "name", required: true, desc: "角色名", prompt: "角色名字(回车 = 取消):" },
  ], charCmd, (a) => `删除 ${a.name}`),

  cmdTool("scene_add", "新建场景", [
    { name: "name", required: true, desc: "场景名", prompt: "场景名字(回车 = 取消):" },
    { name: "desc", required: true, desc: "场景描述", prompt: "场景描述(回车 = 取消):" },
  ], sceneCmd, (a) => `添加 ${a.name} ${a.desc}`),
  cmdTool("scene_view", "查看场景", [
    { name: "name", required: true, desc: "场景名", prompt: "场景名字(回车 = 取消):" },
  ], sceneCmd, (a) => `查看 ${a.name}`),
  cmdTool("scene_edit", "修改场景", [
    { name: "name", required: true, desc: "场景名", prompt: "场景名字(回车 = 取消):" },
    { name: "instruction", required: false, desc: "修改意见", prompt: "修改意见(回车 = AI 自动完善):" },
  ], sceneCmd, (a) => `修改 ${a.name}${a.instruction ? " " + a.instruction : ""}`),
  cmdTool("scene_del", "删除场景", [
    { name: "name", required: true, desc: "场景名", prompt: "场景名字(回车 = 取消):" },
  ], sceneCmd, (a) => `删除 ${a.name}`),

  cmdTool("world_add", "新建世界观条目", [
    { name: "name", required: true, desc: "条目名", prompt: "条目名字(回车 = 取消):" },
    { name: "content", required: true, desc: "条目内容", prompt: "条目内容(回车 = 取消):" },
  ], worldCmd, (a) => `添加 ${a.name} ${a.content}`),
  cmdTool("world_view", "查看世界观条目", [
    { name: "name", required: true, desc: "条目名", prompt: "条目名字(回车 = 取消):" },
  ], worldCmd, (a) => `查看 ${a.name}`),
  cmdTool("world_edit", "修改世界观条目", [
    { name: "name", required: true, desc: "条目名", prompt: "条目名字(回车 = 取消):" },
    { name: "instruction", required: false, desc: "修改意见", prompt: "修改意见(回车 = AI 自动完善):" },
  ], worldCmd, (a) => `修改 ${a.name}${a.instruction ? " " + a.instruction : ""}`),
  cmdTool("world_del", "删除世界观条目", [
    { name: "name", required: true, desc: "条目名", prompt: "条目名字(回车 = 取消):" },
  ], worldCmd, (a) => `删除 ${a.name}`),
  cmdTool("char_gen", "生成角色", [
    { name: "desc", required: true, desc: "角色描述", prompt: "角色描述(回车 = 取消):" },
  ], charCmd, (a) => `生成 ${a.desc}`),
  cmdTool("scene_gen", "生成场景", [
    { name: "desc", required: true, desc: "场景描述", prompt: "场景描述(囸车 = 取消):" },
  ], sceneCmd, (a) => `生成 ${a.desc}`),
  cmdTool("world_gen", "生成世界观条目", [
    { name: "desc", required: true, desc: "条目描述", prompt: "条目描述(回车 = 取消):" },
  ], worldCmd, (a) => `生成 ${a.desc}`),
  cmdTool("outline_gen", "生成大纲", [
    { name: "content", required: true, desc: "大纲内容", prompt: "大纲内容(回车 = 取消):" },
  ], outlineCmd, (a) => `添加 ${a.content}`),

  cmdTool("chapter_new", "新建章节", [
    { name: "title", required: false, desc: "标题", prompt: "章节标题(回车 = 自动编号):" },
  ], chapterCmd, (a) => `新建 ${a.title ?? ""}`.trimEnd()),
  cmdTool("chapter_go", "定位章节", [
    { name: "num", required: true, desc: "章节编号", prompt: "章节编号(回车 = 取消):" },
  ], chapterCmd, (a) => `定位 ${a.num}`),

  cmdTool("style_set", "设置风格", [
    { name: "desc", required: true, desc: "风格描述", prompt: "风格描述(回车 = 取消):" },
  ], styleCmd, (a) => `设置 ${a.desc}`),
  cmdTool("outline_add", "添加大纲", [
    { name: "content", required: true, desc: "大纲内容", prompt: "大纲内容(回车 = 取消):" },
  ], outlineCmd, (a) => `添加 ${a.content}`),
  cmdTool("time_add", "添加时间线", [
    { name: "chapter", required: true, desc: "章节", prompt: "章节(回车 = 取消):" },
    { name: "time", required: true, desc: "时间点", prompt: "时间点(回车 = 取消):" },
    { name: "event", required: true, desc: "事件", prompt: "事件(回车 = 取消):" },
  ], timeCmd, (a) => `添加 ${a.chapter} ${a.time} ${a.event}`),
  cmdTool("growth_add", "添加成长", [
    { name: "stage", required: true, desc: "阶段", prompt: "阶段(回车 = 取消):" },
    { name: "desc", required: true, desc: "成长描述", prompt: "成长描述(回车 = 取消):" },
  ], growthCmd, (a) => `添加 ${a.stage} ${a.desc}`),
  cmdTool("vault_add", "添加伏笔", [
    { name: "name", required: true, desc: "伏笔名", prompt: "伏笔名字(回车 = 取消):" },
    { name: "plan", required: false, desc: "计划回收", prompt: "计划回收(回车 = 无):" },
  ], vaultCmd, (a) => `添加 ${a.name}${a.plan ? " " + a.plan : ""}`),
  cmdTool("idea_add", "记录灵感", [
    { name: "content", required: true, desc: "灵感内容", prompt: "灵感内容(回车 = 取消):" },
  ], ideaCmd, (a) => a.content ?? ""),
  cmdTool("char_list", "列出人物", [], charCmd, () => "列表"),
  cmdTool("scene_list", "列出场景", [], sceneCmd, () => "列表"),
  cmdTool("world_list", "列出世界观", [], worldCmd, () => "列表"),

  cmdTool("search", "搜索", [
    { name: "keyword", required: true, desc: "关键词", prompt: "关键词(回车 = 取消):" },
  ], searchCmd, (a) => a.keyword),
  cmdTool("check", "一致性检查", [], checkCmd, () => ""),
  cmdTool("reader", "读者反馈", [], readerCmd, () => ""),
  cmdTool("summary_gen", "生成卷摘要", [], summaryCmd, () => "生成"),
  cmdTool("stats", "写作统计", [], statsCmd, () => ""),
  cmdTool("export", "导出作品", [
    { name: "fmt", required: false, desc: "格式 md/txt", prompt: "格式 md/txt(回车 = md):" },
  ], exportCmd, (a) => a.fmt || "md"),

  cmdTool("model", "配置模型", [], modelCmd, () => ""),
  cmdTool("continue_work", "继续工作", [], continueCmd, () => ""),
  cmdTool("quit", "退出程序", [], quitCmd, () => ""),

  {
    id: "read_file",
    label: "读取文件",
    params: [
      { name: "file", required: true, desc: "相对作品目录的文件路径", prompt: "文件路径(相对作品目录,回车 = 取消):" },
    ],
    run: async (ctx, a) => {
      const fp = resolveSafe(ctx.root, a.file)
      if (!existsSync(fp)) {
        console.log(`未找到文件:${fp}`)
        return
      }
      console.log(`\n📄 ${fp}\n\n${readFileSync(fp, "utf-8")}`)
    },
  },
  {
    id: "write_file",
    label: "写入文件",
    params: [
      { name: "file", required: true, desc: "相对作品目录的文件路径", prompt: "文件路径(相对作品目录,回车 = 取消):" },
      { name: "content", required: true, desc: "完整新内容", prompt: "新内容(回车 = 取消):" },
    ],
    run: async (ctx, a) => {
      const fp = resolveSafe(ctx.root, a.file)
      writeFileSync(fp, a.content.trimEnd() + "\n", "utf-8")
      console.log(`✅ 已写入 ${fp}`)
    },
  },
  {
    id: "append_file",
    label: "追加文件",
    params: [
      { name: "file", required: true, desc: "相对作品目录的文件路径", prompt: "文件路径(相对作品目录,回车 = 取消):" },
      { name: "content", required: true, desc: "要追加的内容", prompt: "追加内容(回车 = 取消):" },
    ],
    run: async (ctx, a) => {
      const fp = resolveSafe(ctx.root, a.file)
      appendFileSync(fp, "\n" + a.content.trim() + "\n", "utf-8")
      console.log(`✅ 已追加到 ${fp}`)
    },
  },
  {
    id: "list_files",
    label: "列出文件",
    params: [
      { name: "dir", required: false, desc: "目录(默认作品根目录)", prompt: "目录(回车 = 作品根目录):" },
    ],
    run: async (ctx, a) => {
      const fp = resolveSafe(ctx.root, a.dir || "")
      if (!existsSync(fp)) {
        console.log(`目录不存在:${fp}`)
        return
      }
      console.log(`📂 ${fp}`)
      for (const e of readdirSync(fp, { withFileTypes: true })) {
        console.log(`  ${e.isDirectory() ? "📁" : "📄"} ${e.name}`)
      }
    },
  },
]

export function toolById(id: string): Tool | undefined {
  return TOOLS.find((t) => t.id === id)
}

export function toolLabel(id: string): string {
  return toolById(id)?.label ?? id
}

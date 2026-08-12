// 会话与配置类命令:/init(初始化) /config(配置) /help(帮助) /quit(退出) /continue(继续)
import path from "path"
import type { Command, CommandContext, SelectOption } from "../types.ts"
import { p } from "../types.ts"
import { scaffoldNovel } from "../novel.ts"
import { loadConfig, saveConfig } from "../config.ts"
import { isMockMode, resolveApiKey, chat } from "../llm.ts"
import { withBusy } from "../ui.ts"
import { splitOp } from "../op.ts"
import { pickOp } from "../menu.ts"

// 把密钥打码展示(不泄露完整 key)
function maskKey(key: string | undefined): string {
  if (!key) return ""
  if (key.length <= 8) return "****"
  return key.slice(0, 6) + "…" + key.slice(-4)
}

// 各提供商的内置模型清单(分组展示;ollama 优先拉取本地模型,失败回退内置)
const MODEL_CATALOG: Record<string, string[]> = {
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "o3-mini"],
  zhipu: ["glm-4-flash", "glm-4-air", "glm-4-plus"],
}
const OLLAMA_FALLBACK = ["llama3.1", "qwen2.5", "gemma2", "mistral"]
const MODEL_DESC: Record<string, string> = {
  "deepseek-v4-flash": "轻量快速 · 性价比",
  "deepseek-v4-pro": "旗舰 · 深度推理",
  "gpt-4o-mini": "轻量快速",
  "gpt-4o": "全能旗舰",
  "gpt-4.1-mini": "轻量增强",
  "o3-mini": "推理优化",
  "glm-4-flash": "免费快速",
  "glm-4-air": "轻量",
  "glm-4-plus": "旗舰",
  "llama3.1": "通用",
  "qwen2.5": "通义千问",
  gemma2: "谷歌开源",
  mistral: "开源",
}

interface ModelPick {
  provider: string
  model: string
}

export const modelCmd: Command = {
  name: "model",
  aliases: ["模型"],
  description: "交互式配置模型:模型列表分组选择 → API Key(缺失时输入)→ 可选测试连接",
  usage: "/模型",
  examples: ["/模型"],
  handler: async (ctx: CommandContext) => {
    const current = ctx.config.model
    const mode = resolveApiKey(current) ? "真实" : "未配置 key"
    console.log(`当前模型:${current.provider}/${current.model ?? "默认"} | 模式:${mode}${current.apiKey ? ` | key:${maskKey(current.apiKey)}` : ""}`)

    // ollama 尝试拉取本地模型列表(超时/失败回退内置)
    let ollamaModels = OLLAMA_FALLBACK
    try {
      const resp = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(700) })
      if (resp.ok) {
        const data = (await resp.json()) as { models?: { name?: string }[] }
        const names = (data.models ?? []).map((m) => (m.name ?? "").split(":")[0]).filter(Boolean)
        if (names.length > 0) ollamaModels = names
      }
    } catch {
      /* 本地无 Ollama 或不可达:用内置清单 */
    }

    const options: SelectOption<ModelPick>[] = []
    const addProvider = (provider: string, models: string[]) => {
      for (const m of models) {
        options.push({
          value: { provider, model: m } as ModelPick,
          label: m,
          description: MODEL_DESC[m] ?? "",
          category: provider,
          current: current.provider === provider && (current.model ?? "") === m,
        })
      }
    }
    addProvider("deepseek", MODEL_CATALOG.deepseek)
    addProvider("openai", MODEL_CATALOG.openai)
    addProvider("zhipu", MODEL_CATALOG.zhipu)
    addProvider("ollama", ollamaModels)

    const res = await ctx.pickSingle<ModelPick>({
      title: "选择模型(输入过滤;↑↓ 移动;空格/回车 确定;Esc 取消)",
      options,
      onCreate: async () => {
        const provider = (await ctx.askCancellable(`provider(回车 = 当前 ${current.provider}):`))?.trim() || current.provider
        const model = (await ctx.askCancellable("自定义 model 名(回车取消):"))?.trim()
        if (!model) return null
        return { provider, model }
      },
    })
    if (res.kind === "cancel" || res.value === null) {
      console.log("已取消(配置未改动)")
      return
    }
    const pick = res.value
    ctx.config.model.provider = pick.provider
    ctx.config.model.model = pick.model

    let keyChanged = false
    if (pick.provider !== "ollama") {
      if (ctx.config.model.apiKey) {
        const ans = (await ctx.ask(`更换 API Key?当前:${maskKey(ctx.config.model.apiKey)}[y/N]:`)).trim().toLowerCase()
        if (ans === "y") {
          const k = (await ctx.ask("新 API Key(回车取消):")).trim()
          if (k) {
            ctx.config.model.apiKey = k
            keyChanged = true
          }
        }
    } else {
      const k = (await ctx.ask("API Key(回车 = 仅用环境变量):")).trim()
      if (k) {
        ctx.config.model.apiKey = k
        keyChanged = true
      }
    }
  }

  //   // 进阶参数:temperature / top_p(写作质量影响大,可在此微调)
  while (true) {
    const tempCur = ctx.config.model.temperature
    const topCur = ctx.config.model.topP
    const reCur = ctx.config.model.reasoningEffort
    const advOpts: SelectOption<string>[] = [
      {
        value: "temperature",
        label: `temperature: ${tempCur !== undefined ? `开启(${tempCur})` : "关闭(默认 0.9)"}`,
        description: tempCur !== undefined ? "选择 = 关闭,恢复任务默认" : "选择 = 开启,再输入 0-2 数值",
      },
      {
        value: "topP",
        label: `top_p: ${topCur !== undefined ? `开启(${topCur})` : "关闭(不设置)"}`,
        description: topCur !== undefined ? "选择 = 关闭,用提供商默认" : "选择 = 开启,再输入 0-1 数值",
      },
      {
        value: "reasoning",
        label: `reasoning_effort: ${reCur ? reCur : "关闭(默认)"}`,
        description: reCur ? "选择 = 关闭,不发送" : "选择 = 设置 low/medium/high",
      },
      {
        value: "reset",
        label: "还原默认",
        description: "temperature/top_p 全部恢复任务默认",
      },
      {
        value: "done",
        label: "完成",
        description: "结束高级参数配置",
      },
    ]
    const adv = await ctx.pickSingle<string>({
      title: "高级参数 (temperature/top_p/reasoning_effort):↑↓ 移动 · 空格/回车 选择 · Esc 完成",
      options: advOpts,
    })
    if (adv.kind === "cancel" || adv.value === null) break
    const act = adv.value
    if (act === "done") break
    if (act === "reset") {
      delete ctx.config.model.temperature
      delete ctx.config.model.topP
      delete ctx.config.model.reasoningEffort
      console.log("已还原默认:temperature=任务默认(写作 0.9/校验 0.3/读者 0.8),top_p=不设置(用提供商默认),reasoning_effort=不发送")
      continue
    }
    if (act === "reasoning") {
      const rrOpts: SelectOption<string>[] = [
        { value: "off", label: "关闭(不发送)", current: reCur === undefined },
        { value: "low", label: "low", current: reCur === "low" },
        { value: "medium", label: "medium", current: reCur === "medium" },
        { value: "high", label: "high", current: reCur === "high" },
      ]
      const rr = await ctx.pickSingle<string>({
        title: "reasoning_effort(low/medium/high):↑↓ 移动 · 空格/回车 选择 · Esc 返回",
        options: rrOpts,
      })
      if (rr.kind === "ok" && rr.value !== null) {
        if (rr.value === "off") delete ctx.config.model.reasoningEffort
        else ctx.config.model.reasoningEffort = rr.value
        console.log(`✅ reasoning_effort = ${rr.value === "off" ? "关闭(不发送)" : rr.value}`)
      }
      continue
    }
    const isTemp = act === "temperature"
    const cur = isTemp ? tempCur : topCur
    if (cur !== undefined) {
      if (isTemp) delete ctx.config.model.temperature
      else delete ctx.config.model.topP
      console.log(`已关闭 ${isTemp ? "temperature" : "top_p"},恢复${isTemp ? "任务默认" : "提供商默认"}`)
      continue
    }
    const v = await ctx.askCancellable(isTemp ? "temperature(0-2,回车 = 取消):" : "top_p(0-1,回车 = 取消):")
    if (v === null) continue
    const txt = v.trim()
    const n = parseFloat(txt)
    if (txt === "" || isNaN(n)) {
      console.log("  未设置,保持原值")
      continue
    }
    if (isTemp && n >= 0 && n <= 2) {
      ctx.config.model.temperature = n
      console.log(`✅ temperature = ${n}`)
    } else if (!isTemp && n >= 0 && n <= 1) {
      ctx.config.model.topP = n
      console.log(`✅ top_p = ${n}`)
    } else {
      console.log(`  ${isTemp ? "temperature" : "top_p"} 无效,保持原值`)
    }
  }

  saveConfig(ctx.root, ctx.config)
  const after = resolveApiKey(ctx.config.model) ? "真实" : "未配置 key"
  console.log(`✅ 已保存:${pick.provider}/${pick.model} | 模式:${after}`)

    if (keyChanged) {
      const t = (await ctx.ask("测试连接?[y/N]:")).trim().toLowerCase()
      if (t === "y") {
        console.log("🔍 测试连接中…")
        try {
          const out = await withBusy("🔍 测试连接", (signal) =>
            chat(ctx.config.model, [{ role: "user", content: "ping" }], { maxTokens: 1, signal }),
          )
          if (out === null) console.log("⏹ 已取消")
          else console.log("✅ 连接成功,模型可正常调用")
        } catch (e) {
          console.log(`❌ 连接失败:${(e as Error).message}(可稍后 /model(模型) 重试或检查 key)`)
        }
      }
    }
  },
}

// 写前检查:没配 key 时引导进入 /model(模型) 配置(模拟模式仅测试用)
export async function ensureModelConfigured(ctx: CommandContext): Promise<boolean> {
  if (isMockMode(ctx.config.model)) return true
  if (resolveApiKey(ctx.config.model)) return true
  console.log("⚠️ 未配置 API Key,无法调用真实模型")
  const ans = await ctx.ask("现在配置?[y/N]:")
  if (ans.trim().toLowerCase() !== "y") {
    console.log("已跳过,本次操作取消")
    return false
  }
  await modelCmd.handler(ctx, "")
  if (isMockMode(ctx.config.model) || resolveApiKey(ctx.config.model)) return true
  console.log("仍未检测到 API Key,本次操作取消")
  return false
}

export const initCmd: Command = {
  name: "init",
  aliases: ["初始化"],
  description: "在当前目录初始化小说作品",
  usage: "/init(初始化) <作品名>",
  examples: ["/init(初始化) 剑起苍澜", "/init(初始化)(不写名字则用目录名)"],
  handler: async (ctx: CommandContext, args: string) => {
    const name = args.trim() || path.basename(ctx.cwd)
    scaffoldNovel(ctx.cwd, name)
    // 同步 ctx 到新作品配置
    ctx.config.name = name
    ctx.root = ctx.cwd
    console.log(`✅ 已在 ${ctx.cwd} 初始化作品《${name}》`)
    console.log("生成:章节/ 人物/ 世界观/ 大纲/ 笔记/ 摘要/ 场景/ 风格.md 时间线.md 伏笔.md 成长.md")
    console.log("下一步:/config(配置) 配置模型,/char(人物) 添加 创建人物,/world(世界观) 添加 添加设定,/write(写作) 开始写作")
  },
}

export const configCmd: Command = {
  name: "config",
  aliases: ["配置"],
  description: "无参数 = 操作菜单;查看/设置模型配置(provider/model/api-key/style/temperature/top-p/reasoning-effort/默认)",
  usage: "/config(配置) [查看|provider <名>|model <模型>|api-key <key>|style <描述>|temperature <0-2>|top-p <0-1>|reasoning-effort <low|medium|high|off>|默认]",
  examples: [
    "/config(配置) 查看",
    "/config(配置) provider deepseek",
    "/config(配置) model deepseek-v4-flash",
    "/config(配置) api-key sk-xxxx",
    "/config(配置) style 快节奏爽文,章末留钩子",
  ],
  handler: async (ctx: CommandContext, args: string) => {
    const { op, rest } = splitOp(args)
    if (!op) {
      const act = await pickOp(ctx, "配置操作(↑↓ 移动 · 空格/回车 选择 · Esc 返回):", [
        { value: "view", label: "查看配置", description: "打印模型与风格" },
        { value: "provider", label: "设置 provider", description: "deepseek/openai/ollama/zhipu" },
        { value: "model", label: "设置 model", description: "模型名,如 deepseek-v4-flash" },
        { value: "api-key", label: "设置 api-key", description: "写入 novel.json" },
        { value: "style", label: "设置 style", description: "写作风格描述" },
        { value: "temperature", label: "设置 temperature", description: "0-2,写作风格影响大" },
        { value: "top-p", label: "设置 top_p", description: "0-1" },
        { value: "reasoning-effort", label: "设置 reasoning_effort", description: "low/medium/high/off" },
        { value: "default", label: "还原默认", description: "temperature/top_p/reasoning_effort" },
      ])
      if (!act) return
      if (act === "view") { await configCmd.handler(ctx, "查看"); return }
      if (act === "default") { await configCmd.handler(ctx, "默认"); return }
      if (act === "reasoning-effort") {
        const r = await pickOp(ctx, "reasoning_effort(↑↓ 移动 · 回车 选择 · Esc 返回):", [
          { value: "off", label: "关闭(不发送)" },
          { value: "low", label: "low" },
          { value: "medium", label: "medium" },
          { value: "high", label: "high" },
        ])
        if (!r) return
        await configCmd.handler(ctx, `reasoning-effort ${r}`)
        return
      }
      const prompts: Record<string, string> = {
        provider: "provider(回车 = 取消):",
        model: "model(回车 = 取消):",
        "api-key": "api-key(回车 = 取消):",
        style: "style(回车 = 取消):",
        temperature: "temperature 0-2(回车 = 取消):",
        "top-p": "top_p 0-1(回车 = 取消):",
      }
      const v = (await ctx.askCancellable(prompts[act]))?.trim()
      if (!v) return
      await configCmd.handler(ctx, `${act} ${v}`)
      return
    }
    if (op === "view") {
      const mode = resolveApiKey(ctx.config.model) ? "真实模式" : "未配置 key(配 key 后自动真实调用)"
      const viewModel = { ...ctx.config.model }
      if (viewModel.apiKey) viewModel.apiKey = maskKey(viewModel.apiKey)
      console.log(
        JSON.stringify(
          {
            model: viewModel,
            style: ctx.config.style,
            currentChapter: ctx.config.currentChapter,
            currentTime: ctx.config.currentTime,
            mode,
          },
          null,
          2,
        ),
      )
      return
    }
    if (op === "provider" && rest[0]) {
      ctx.config.model.provider = rest[0]
      saveConfig(ctx.root, ctx.config)
      console.log(`✅ provider = ${rest[0]}(支持:deepseek / openai / ollama / zhipu)`)
    } else if (op === "model" && rest[0]) {
      ctx.config.model.model = rest[0]
      saveConfig(ctx.root, ctx.config)
      console.log(`✅ model = ${rest[0]}`)
    } else if (op === "api-key" && rest[0]) {
      ctx.config.model.apiKey = rest[0]
      saveConfig(ctx.root, ctx.config)
      console.log(`✅ apiKey 已写入\n📄 微调:${p(ctx, "novel.json")}(也可改用环境变量,如 DEEPSEEK_API_KEY)`)
    } else if (op === "style" && rest.length > 0) {
      ctx.config.style = rest.join(" ")
      saveConfig(ctx.root, ctx.config)
      console.log(`✅ style = ${rest.join(" ")}\n📄 微调:${p(ctx, "novel.json")}`)
    } else if (op === "temperature" && rest[0]) {
      const n = parseFloat(rest[0])
      if (isNaN(n) || n < 0 || n > 2) return console.log("temperature 需为 0-2 的数字")
      ctx.config.model.temperature = n
      saveConfig(ctx.root, ctx.config)
      console.log(`✅ temperature = ${n}(写作类默认 0.9,校验类 0.3,读者 0.8)`)
    } else if (op === "top-p" && rest[0]) {
      const n = parseFloat(rest[0])
      if (isNaN(n) || n < 0 || n > 1) return console.log("top_p 需为 0-1 的数字")
      ctx.config.model.topP = n
      saveConfig(ctx.root, ctx.config)
      console.log(`✅ top_p = ${n}(不设置时用提供商默认)`)
    } else if (op === "reasoning-effort" && rest[0]) {
      const v = rest[0].toLowerCase()
      if (v === "off" || v === "默认" || v === "default") {
        delete ctx.config.model.reasoningEffort
        saveConfig(ctx.root, ctx.config)
        console.log("✅ reasoning_effort = 关闭(不发送)")
      } else if (v === "low" || v === "medium" || v === "high") {
        ctx.config.model.reasoningEffort = v
        saveConfig(ctx.root, ctx.config)
        console.log(`✅ reasoning_effort = ${v}`)
      } else {
        console.log("reasoning_effort 需为 low/medium/high/off")
      }
    } else if (op === "default") {
      delete ctx.config.model.temperature
      delete ctx.config.model.topP
      delete ctx.config.model.reasoningEffort
      saveConfig(ctx.root, ctx.config)
      console.log("✅ 已还原默认:temperature=任务默认(写作 0.9/校验 0.3/读者 0.8),top_p=不设置(用提供商默认),reasoning_effort=不发送")
    } else {
      console.log("用法:/config(配置) 查看 | /config(配置) provider <名> | /config(配置) model <模型> | /config(配置) api-key <key> | /config(配置) style <描述> | /config(配置) temperature <0-2> | /config(配置) top-p <0-1> | /config(配置) reasoning-effort <low|medium|high|off> | /config(配置) 默认")
    }
  },
}

export const helpCmd: Command = {
  name: "help",
  aliases: ["帮助"],
  description: "命令帮助:/help(帮助) 列表;/help(帮助) <命令> 查看详细用法与示例",
  usage: "/help(帮助) [命令名]",
  examples: ["/帮助", "/help(帮助) 写作", "/help(帮助) 人物"],
  handler: async (ctx: CommandContext, args: string) => {
    const { listCommands, getCommand, cmdLabel } = await import("../commands/index.ts")
    const target = args.trim()
    if (target) {
      const cmd = getCommand(target)
      if (!cmd) {
        console.log(`未知命令 /${target},/help(帮助) 查看全部`)
        return
      }
      console.log(`${cmdLabel(cmd)} — ${cmd.description}`)
      if (cmd.aliases && cmd.aliases.length > 0) console.log(`别名:${cmd.aliases.map((a) => `/${a}`).join(" ")}`)
      if (cmd.usage) console.log(`\n用法:\n  ${cmd.usage}`)
      if (cmd.examples && cmd.examples.length > 0) {
        console.log(`\n示例:`)
        for (const e of cmd.examples) console.log(`  ${e}`)
      }
      return
    }
    console.log(`当前作品:${ctx.config.name} | 模式:${resolveApiKey(ctx.config.model) ? "真实" : "未配置 key"}\n`)
    console.log("可用命令(/help(帮助) <命令> 查看详细用法;中英文均可输入):")
    for (const c of listCommands()) {
      console.log(`  ${cmdLabel(c)} ${c.description}`)
    }
    console.log("\n写作核心用法:")
    console.log("  直接输入文字 = 写 1 章(自动组装风格/人物/时间线/伏笔上下文)")
    console.log("  /write(写作) --n 3 = 一次写 3 章(自动建章,可配合章节大纲指定每章内容)")
    console.log("  指令里可写 [查:关键词] 让 AI 先检索全文再写(如:林晚想起兄长的玉佩[查:玉佩])")
    console.log("\n提示:文件都是 Markdown,可在任意编辑器手动修改,改完即时生效")
  },
}

export const quitCmd: Command = {
  name: "quit",
  aliases: ["退出", "exit"],
  description: "退出",
  handler: () => {
    process.exit(0)
  },
}

export const continueCmd: Command = {
  name: "continue",
  aliases: ["继续"],
  description: "继续工作:回顾上次会话 + 续跑中断的批量写作(等价于启动时加 -c 参数)",
  usage: "/继续",
  examples: ["/继续", "xie.exe -c"],
  handler: async (ctx: CommandContext) => {
    const { showSession, loadSession, setPendingWrite } = await import("../session.ts")
    const { writeCmd } = await import("./write.ts")
    showSession(ctx.root)
    const pending = loadSession(ctx.root).pendingWrite
    if (pending) {
      const remain = pending.count - pending.done
      console.log(`\n⏸️  上次批量写作中断:已完成 ${pending.done}/${pending.count} 章(从第 ${pending.startNum} 章起),剩 ${remain} 章`)
      const ans = await ctx.ask(`继续写剩下的 ${remain} 章?[y/N]:`)
      const a = ans.trim().toLowerCase()
      if (a === "y") {
        await writeCmd.handler(ctx, `--n ${remain} --from ${pending.startNum + pending.done} ${pending.instruction}`)
      } else if (a === "n") {
        console.log("已放弃,断点已清除")
        setPendingWrite(ctx.root, undefined)
      } else {
        console.log("已跳过(断点保留),下次 -c 或 /continue(继续) 可再继续;也可手动 /write(写作) --n <数量> --from <章号>")
      }
    } else {
      console.log("\n没有中断的批量任务。直接输入文字写作,或 /write(写作) 进入向导")
    }
  },
}

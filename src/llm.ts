// LLM 模型层:DeepSeek 等 OpenAI 兼容接口;产品无模拟模式,测试桩仅由环境变量 XIE_MOCK=1 启用
import type { ModelConfig } from "./config.ts"

const PROVIDERS: Record<string, { baseURL: string; defaultModel: string }> = {
  deepseek: { baseURL: "https://api.deepseek.com/v1", defaultModel: "deepseek-v4-flash" },
  openai: { baseURL: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" },
  ollama: { baseURL: "http://localhost:11434/v1", defaultModel: "llama3.1" },
  zhipu: { baseURL: "https://open.bigmodel.cn/api/paas/v4", defaultModel: "glm-4-flash" },
}

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export function resolveModel(cfg: ModelConfig): { baseURL: string; model: string } {
  const p = PROVIDERS[cfg.provider] ?? PROVIDERS.deepseek
  return { baseURL: cfg.baseURL ?? p.baseURL, model: cfg.model ?? p.defaultModel }
}

export function resolveApiKey(cfg: ModelConfig): string | undefined {
  if (cfg.apiKey) return cfg.apiKey
  const envName = (cfg.provider || "deepseek").toUpperCase() + "_API_KEY"
  return process.env[envName]
}

// 测试桩:仅环境变量 XIE_MOCK=1 时启用(自动化测试用),产品任何配置都不会进入模拟
export function isMockMode(cfg: ModelConfig): boolean {
  return process.env.XIE_MOCK === "1"
}

function mockChat(messages: ChatMessage[]): string {
  const last = messages[messages.length - 1]
  const instruction = (last?.content ?? "").slice(0, 100)
  return [
    "【测试桩输出 — 仅供自动化测试,配置 DEEPSEEK_API_KEY 后即为真实写作】",
    "",
    `收到写作指令:${instruction}`,
    "",
    "城门在暮色里吱呀作响。林晚握紧了剑柄,指尖泛白。",
    "风从城外卷来,带着铁锈与尘土的气息。对面那人翻身下马,斗笠下露出一道刀疤。",
    "“你终于来了。”林晚说,声音比自己预想的平静。",
    "“这笔账,”那人缓缓拔出刀,“今天该清算了。”",
    "",
    "(以上为测试桩内容,仅自动化测试可见;真实写作需配置 API key)",
  ].join("\n")
}

export async function chat(
  cfg: ModelConfig,
  messages: ChatMessage[],
  opts?: { temperature?: number; maxTokens?: number; signal?: AbortSignal },
): Promise<string> {
  if (isMockMode(cfg)) {
    const delay = Number(process.env.XIE_MOCK_DELAY ?? 300)
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, delay)
      opts?.signal?.addEventListener("abort", () => {
        clearTimeout(t)
        reject(new DOMException("aborted", "AbortError"))
      })
    })
    return mockChat(messages)
  }
  const { baseURL, model } = resolveModel(cfg)
  const apiKey = resolveApiKey(cfg)!
  // 温度:用户配置优先,任务默认其次(任务调用点传入默认值)
  const temperature = cfg.temperature ?? opts?.temperature ?? 0.9
  const maxTokens = opts?.maxTokens ?? cfg.maxTokens ?? 8000
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
  }
  if (cfg.topP !== undefined) body.top_p = cfg.topP
  if (cfg.reasoningEffort) body.reasoning_effort = cfg.reasoningEffort
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: opts?.signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`模型调用失败 [${res.status}]: ${text.slice(0, 300)}`)
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } }
  if (data.error) throw new Error(`模型错误: ${data.error.message}`)
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error("模型返回空内容")
  return content
}

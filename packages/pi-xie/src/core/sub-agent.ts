import type {
	Api,
	AssistantMessage,
	Context,
	Model,
	ModelsSimpleStreamOptions,
	ThinkingLevel,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "./model-runtime.ts";

export interface SubAgentMessage {
	role: "user" | "assistant";
	content: string;
}

export interface RunSubAgentOptions {
	systemPrompt: string;
	messages: SubAgentMessage[];
	model: Model<Api>;
	/** 可选输出上限；不传时使用 provider 自己的输出上限。 */
	maxTokens?: number;
	/** 思考级别；不传时不显式设置（provider 默认）。 */
	reasoning?: ThinkingLevel;
	signal?: AbortSignal;
}

function responseText(message: AssistantMessage): string {
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("")
		.trim();
}

/**
 * Run one tool-free completion turn for a sub-agent against the session model
 * runtime. The sub-agent sees only the provided system prompt and messages —
 * no session history, no tools — so its context stays isolated from the
 * writing agent. Messages may span multiple user/assistant turns, which lets
 * callers keep a persistent sub-agent conversation alive across calls.
 */
export async function runSubAgent(
	modelRuntime: ModelRuntime,
	options: RunSubAgentOptions,
): Promise<string | undefined> {
	const context: Context = {
		systemPrompt: options.systemPrompt,
		messages: options.messages.map((message) => {
			const content = [{ type: "text" as const, text: message.content }];
			const timestamp = Date.now();
			if (message.role === "assistant") {
				// 历史 assistant 轮只参与上下文构造；元数据用当前模型占位即可
				return {
					role: "assistant",
					content,
					api: options.model.api,
					provider: options.model.provider,
					model: options.model.id,
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp,
				} satisfies Context["messages"][number];
			}
			return { role: "user", content, timestamp } satisfies Context["messages"][number];
		}),
	};
	const requestOptions: ModelsSimpleStreamOptions = {
		signal: options.signal,
		...(options.reasoning !== undefined ? { reasoning: options.reasoning } : {}),
		...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
	};

	const response = await modelRuntime.completeSimple(options.model, context, requestOptions);
	if (response.stopReason === "error") {
		throw new Error(response.errorMessage ?? "Sub-agent request failed");
	}
	if (response.stopReason === "aborted") {
		return undefined;
	}
	const text = responseText(response);
	return text.length > 0 ? text : undefined;
}

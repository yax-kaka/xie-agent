import type { Api, AssistantMessage, Context, Model, ModelsSimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "./model-runtime.ts";

export interface SubAgentMessage {
	role: "user";
	content: string;
}

export interface RunSubAgentOptions {
	systemPrompt: string;
	messages: SubAgentMessage[];
	model: Model<Api>;
	/** 可选输出上限；不传时使用 provider 自己的输出上限。 */
	maxTokens?: number;
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
 * Run a single-turn, tool-free sub-agent call against the session model
 * runtime. The sub-agent sees only the provided system prompt and messages —
 * no session history, no tools — so its context stays isolated from the
 * writing agent.
 */
export async function runSubAgent(
	modelRuntime: ModelRuntime,
	options: RunSubAgentOptions,
): Promise<string | undefined> {
	const context: Context = {
		systemPrompt: options.systemPrompt,
		messages: options.messages.map((message) => ({
			role: message.role,
			content: [{ type: "text", text: message.content }],
			timestamp: Date.now(),
		})),
	};
	const requestOptions: ModelsSimpleStreamOptions = {
		signal: options.signal,
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

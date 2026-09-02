import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, test, vi } from "vitest";
import type { ModelRuntime } from "../src/core/model-runtime.ts";
import { runSubAgent, type SubAgentMessage } from "../src/core/sub-agent.ts";

const fakeModel = { id: "fake-model" } as unknown as Model<Api>;

function fakeRuntime(overrides: { completeSimple?: ReturnType<typeof vi.fn> } = {}): ModelRuntime {
	return {
		completeSimple: overrides.completeSimple ?? vi.fn(),
	} as unknown as ModelRuntime;
}

function assistantResponse(stopReason: string, text?: string, errorMessage?: string) {
	return {
		role: "assistant" as const,
		content: [
			{ type: "thinking" as const, text: "内心戏", thinkingLevel: "low" as const },
			{ type: "text" as const, text: text ?? "台词" },
		],
		api: "test" as Api,
		provider: "test",
		model: "fake-model",
		usage: {},
		stopReason,
		errorMessage,
		timestamp: 0,
	};
}

describe("runSubAgent", () => {
	test("returns concatenated text blocks and ignores thinking blocks", async () => {
		const completeSimple = vi.fn().mockResolvedValue(assistantResponse("end_turn", "第一句。\n第二句。"));
		const runtime = fakeRuntime({ completeSimple });

		const messages: SubAgentMessage[] = [{ role: "user", content: "你好" }];
		const result = await runSubAgent(runtime, { systemPrompt: "你是角色甲", messages, model: fakeModel });

		expect(result).toBe("第一句。\n第二句。");
		const [model, context, options] = completeSimple.mock.calls[0] as [Model<Api>, unknown, unknown];
		expect(model).toBe(fakeModel);
		const ctx = context as { systemPrompt?: string; messages?: Array<{ role: string; content: unknown }> };
		expect(ctx.systemPrompt).toBe("你是角色甲");
		expect(ctx.messages).toHaveLength(1);
		expect(ctx.messages?.[0]?.role).toBe("user");
		expect(ctx.messages?.[0]?.content).toEqual([{ type: "text", text: "你好" }]);
		const opts = options as { maxTokens?: number; signal?: AbortSignal };
		// 不传 maxTokens：交给 provider 自己的输出上限
		expect(opts.maxTokens).toBeUndefined();
		expect(opts.signal).toBeUndefined();
	});

	test("forwards maxTokens and signal", async () => {
		const completeSimple = vi.fn().mockResolvedValue(assistantResponse("end_turn"));
		const runtime = fakeRuntime({ completeSimple });
		const signal = new AbortController().signal;

		await runSubAgent(runtime, {
			systemPrompt: "s",
			messages: [],
			model: fakeModel,
			maxTokens: 256,
			signal,
		});

		const [, , options] = completeSimple.mock.calls[0] as [
			Model<Api>,
			unknown,
			{ maxTokens?: number; signal?: AbortSignal },
		];
		expect(options.maxTokens).toBe(256);
		expect(options.signal).toBe(signal);
	});

	test("throws on error stop reason", async () => {
		const completeSimple = vi.fn().mockResolvedValue(assistantResponse("error", undefined, "无 API key"));
		const runtime = fakeRuntime({ completeSimple });

		await expect(runSubAgent(runtime, { systemPrompt: "s", messages: [], model: fakeModel })).rejects.toThrow(
			"无 API key",
		);
	});

	test("returns undefined when aborted", async () => {
		const completeSimple = vi.fn().mockResolvedValue(assistantResponse("aborted", "半句"));
		const runtime = fakeRuntime({ completeSimple });

		const result = await runSubAgent(runtime, { systemPrompt: "s", messages: [], model: fakeModel });
		expect(result).toBeUndefined();
	});

	test("returns undefined when the response text is empty", async () => {
		const completeSimple = vi.fn().mockResolvedValue(assistantResponse("end_turn", "  \n"));
		const runtime = fakeRuntime({ completeSimple });

		const result = await runSubAgent(runtime, { systemPrompt: "s", messages: [], model: fakeModel });
		expect(result).toBeUndefined();
	});
});

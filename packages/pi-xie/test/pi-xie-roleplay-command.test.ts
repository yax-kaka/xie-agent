import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type {
	CharacterAgentUpdate,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionUIContext,
	InputEvent,
	InputEventResult,
} from "../src/core/extensions/index.ts";
import piXieExtension from "../src/extensions/pi-xie/index.ts";
import { appendRoleLine, prosePathFor, recordPathFor, startNewSegment } from "../src/extensions/pi-xie/roleplay.ts";
import { getDefaultUserRole, setDefaultUserRole } from "../src/extensions/pi-xie/user-role.ts";
import {
	createEntity,
	listEntities,
	updateEntity,
	writeChapter,
	writeConstraint,
} from "../src/extensions/pi-xie/workspace.ts";
import { createTestExtensionsResult } from "./utilities.ts";

type InputHandler = (event: InputEvent, ctx: ExtensionContext) => Promise<InputEventResult | undefined>;
type RoleplayRunOptions = {
	systemPrompt: string;
	messages: Array<{ role: "user" | "assistant"; content: string }>;
};
type CharacterAgentMessage = { role: "user" | "assistant"; content: string };

let cwd: string;

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "pi-xie-roleplay-cmd-"));
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

function createCommandContext(isIdle = true) {
	const select = vi.fn<ExtensionUIContext["select"]>();
	const editor = vi.fn<ExtensionUIContext["editor"]>();
	const input = vi.fn<ExtensionUIContext["input"]>();
	const notify = vi.fn<ExtensionUIContext["notify"]>();
	const setStatus = vi.fn<ExtensionUIContext["setStatus"]>();
	const setWidget = vi.fn<ExtensionUIContext["setWidget"]>();
	const context = {
		cwd,
		isIdle: () => isIdle,
		ui: { select, editor, input, notify, setStatus, setWidget },
	} as unknown as ExtensionCommandContext;
	return { context, select, editor, input, notify, setStatus, setWidget };
}

async function loadExtension() {
	const result = await createTestExtensionsResult([{ name: "pi-xie", factory: piXieExtension }], cwd);
	const extension = result.extensions[0];
	if (!extension) throw new Error("pi-xie extension was not loaded");
	const inputHandlers = extension.handlers.get("input") as InputHandler[] | undefined;
	if (!inputHandlers) throw new Error("no input handlers registered");
	const roleplayHandler = inputHandlers[1];
	if (!roleplayHandler) throw new Error("roleplay input handler not registered");
	return {
		commands: extension.commands,
		tools: extension.tools,
		inputHandler: roleplayHandler,
		runtime: result.runtime,
	};
}

function input(text: string, source: InputEvent["source"] = "interactive"): InputEvent {
	return { type: "input", text, source };
}

/** 场景与三个角色（绯雪、知遥、策栖辞）。 */
function setupEntities() {
	const scene = createEntity(cwd, "scenes", { name: "早饭餐桌", body: "家里餐厅，窗外下雨。" });
	const feixue = createEntity(cwd, "characters", { name: "绯雪", body: "红发，温柔而敏锐。" });
	const zhizhiyao = createEntity(cwd, "characters", { name: "知遥", body: "高中生，活泼。" });
	const ceqici = createEntity(cwd, "characters", { name: "策栖辞", body: "筑基修士。" });
	writeConstraint(cwd, "worldview", "现代都市修仙。");
	return { scene, feixue, zhizhiyao, ceqici };
}

/** 模拟 AI 自动选角成功并确认进入（绯雪+知遥为 AI，用户演策栖辞）。 */
async function enterWithAutoCast(
	select: ReturnType<typeof vi.fn>,
	editor: ReturnType<typeof vi.fn>,
	runSubAgent: ReturnType<typeof vi.fn>,
	extraCast?: { aiRoles: string[]; userRole: string | null },
) {
	const { scene, feixue, zhizhiyao, ceqici } = setupEntities();
	const cast = extraCast ?? { aiRoles: [feixue.id, zhizhiyao.id], userRole: ceqici.id };
	runSubAgent.mockResolvedValueOnce(JSON.stringify(cast));
	select.mockResolvedValueOnce(scene.id); // 场景
	// 之后的选择（选角确认等）一律取第一个选项
	select.mockImplementation(async (_title, options) => options[0] ?? undefined);
	editor.mockResolvedValueOnce("三人在餐桌前坐下，粥还冒着热气。");
	return { scene, feixue, zhizhiyao, ceqici };
}

async function enterWithManualCast(
	select: ReturnType<typeof vi.fn>,
	editor: ReturnType<typeof vi.fn>,
	runSubAgent: ReturnType<typeof vi.fn>,
) {
	const { scene, feixue, zhizhiyao, ceqici } = setupEntities();
	runSubAgent.mockResolvedValueOnce("无法判断"); // 选角失败 → 手动
	select.mockResolvedValueOnce(scene.id); // 场景
	select.mockResolvedValueOnce(`${feixue.id} - ${feixue.name}`); // 手动多选：绯雪
	select.mockResolvedValueOnce("完成选择"); // 多选结束
	select.mockResolvedValueOnce(`${ceqici.id} - ${ceqici.name}`); // 用户扮演：策栖辞
	editor.mockResolvedValueOnce("三人在餐桌前坐下。");
	return { scene, feixue, zhizhiyao, ceqici };
}

/**
 * 角色 agent 核心行为的轻量仿真：维护每个 agent 的转录，
 * 按调用顺序从 replies 队列取回复；返回各动作的 mock 供断言。
 */
function installCharacterAgents(runtime: Awaited<ReturnType<typeof loadExtension>>["runtime"], replies: string[]) {
	const transcripts = new Map<string, CharacterAgentMessage[]>();
	const systemPrompts = new Map<string, string>();
	const queue = [...replies];
	const popReply = (): string | undefined => queue.shift();

	const createCharacterAgent = vi.fn((options: { id: string; systemPrompt: string }) => {
		transcripts.set(options.id, []);
		systemPrompts.set(options.id, options.systemPrompt);
	});
	const setCharacterAgentHistory = vi.fn(
		(options: { id: string; systemPrompt?: string; messages?: CharacterAgentMessage[] }) => {
			if (options.systemPrompt !== undefined) systemPrompts.set(options.id, options.systemPrompt);
			if (options.messages !== undefined)
				transcripts.set(
					options.id,
					options.messages.map((m) => ({ ...m })),
				);
		},
	);
	const appendCharacterAgentMessage = vi.fn((options: { id: string; message: CharacterAgentMessage }) => {
		transcripts.get(options.id)!.push({ ...options.message });
	});
	const runCharacterAgentTurn = vi.fn(
		(options: { id: string; message: string; onUpdate?: (update: CharacterAgentUpdate) => void }) => {
			const transcript = transcripts.get(options.id)!;
			transcript.push({ role: "user", content: options.message });
			const reply = popReply();
			options.onUpdate?.({ type: "turn_start" });
			if (reply !== undefined) {
				options.onUpdate?.({ type: "text_delta", text: reply });
				transcript.push({ role: "assistant", content: reply });
			}
			options.onUpdate?.({ type: "turn_end" });
			return Promise.resolve(reply);
		},
	);
	const continueCharacterAgent = vi.fn(
		(options: { id: string; onUpdate?: (update: CharacterAgentUpdate) => void }) => {
			const transcript = transcripts.get(options.id)!;
			const reply = popReply();
			options.onUpdate?.({ type: "turn_start" });
			if (reply !== undefined) {
				options.onUpdate?.({ type: "text_delta", text: reply });
				transcript.push({ role: "assistant", content: reply });
			}
			options.onUpdate?.({ type: "turn_end" });
			return Promise.resolve(reply);
		},
	);
	const disposeCharacterAgent = vi.fn();

	runtime.createCharacterAgent = createCharacterAgent;
	runtime.setCharacterAgentHistory = setCharacterAgentHistory;
	runtime.appendCharacterAgentMessage = appendCharacterAgentMessage;
	runtime.runCharacterAgentTurn = runCharacterAgentTurn;
	runtime.continueCharacterAgent = continueCharacterAgent;
	runtime.disposeCharacterAgent = disposeCharacterAgent;

	return {
		transcripts,
		systemPrompts,
		createCharacterAgent,
		setCharacterAgentHistory,
		appendCharacterAgentMessage,
		runCharacterAgentTurn,
		continueCharacterAgent,
		disposeCharacterAgent,
	};
}

describe("pi-xie /对戏 command", () => {
	test("auto-cast picks AI roles; every character judges through its own isolated persistent agent", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>();
		runSubAgent.mockResolvedValueOnce(JSON.stringify({ aiRoles: ["绯雪", "知遥"], userRole: "策栖辞" }));
		runtime.runSubAgent = runSubAgent;
		const agents = installCharacterAgents(runtime, ["绯雪：（把粥碗推过来）先吃饭。", "沉默"]);
		const { context, select, editor, notify } = createCommandContext();
		await enterWithAutoCast(select, editor, runSubAgent);

		await commands.get("对戏")?.handler("", context);

		const castCall = runSubAgent.mock.calls[0][0] as RoleplayRunOptions;
		expect(castCall.systemPrompt).toContain("选角");
		expect(castCall.systemPrompt).toContain("绯雪");
		expect(castCall.systemPrompt).toContain("早饭餐桌");
		expect(
			notify.mock.calls.some(
				(call) => String(call[0]).includes("常驻角色子代理") && String(call[0]).includes("@角色名"),
			),
		).toBe(true);
		// 每个角色各建一个 agent：系统提示词只有自己的卡（上下文隔离）
		expect(agents.createCharacterAgent).toHaveBeenCalledTimes(2);
		const feixueCreate = agents.createCharacterAgent.mock.calls.find(
			(call) => (call[0] as { id: string }).id === "绯雪",
		)?.[0] as { systemPrompt: string } | undefined;
		expect(feixueCreate?.systemPrompt).toContain("名字：绯雪");
		expect(feixueCreate?.systemPrompt).toContain("设定：红发，温柔而敏锐。");
		expect(feixueCreate?.systemPrompt).toContain("在场其他角色（仅名字，用于知道谁在场）：知遥");
		expect(feixueCreate?.systemPrompt).toContain("起始情境：三人在餐桌前坐下，粥还冒着热气。");
		expect(feixueCreate?.systemPrompt).not.toContain("名字：知遥");

		expect(await inputHandler(input("知遥，想吃什么？"), context)).toEqual({ action: "handled" });
		expect(runSubAgent).toHaveBeenCalledTimes(1); // 只有选角用一次性子代理
		// 串行：绯雪先判断（continue），知遥后判断
		expect(agents.continueCharacterAgent).toHaveBeenCalledTimes(2);
		expect((agents.continueCharacterAgent.mock.calls[0]?.[0] as { id: string }).id).toBe("绯雪");
		expect((agents.continueCharacterAgent.mock.calls[1]?.[0] as { id: string }).id).toBe("知遥");
		// 转录仿真：知遥的转录包含绯雪同一轮刚产生的新台词（引述格式）；自己的沉默也留在内部状态里
		expect(agents.transcripts.get("知遥")).toEqual([
			{ role: "user", content: "[user:策栖辞] 知遥，想吃什么？" },
			{ role: "user", content: "绯雪：「（把粥碗推过来）先吃饭。」" },
			{ role: "assistant", content: "沉默" },
		]);
		expect(agents.transcripts.get("绯雪")).toEqual([
			{ role: "user", content: "[user:策栖辞] 知遥，想吃什么？" },
			{ role: "assistant", content: "绯雪：（把粥碗推过来）先吃饭。" },
		]);
		// 常驻子代理活动条目：谁接话、谁沉默
		const appendEntry = runtime.appendEntry as ReturnType<typeof vi.fn>;
		expect(
			appendEntry.mock.calls.some(
				(call) =>
					call[0] === "roleplay-round" &&
					String(call[1]?.text).includes("绯雪 接话") &&
					String(call[1]?.text).includes("知遥 沉默"),
			),
		).toBe(true);

		const recordPath = recordPathFor(cwd, "早饭餐桌", ["知遥", "绯雪"]);
		const record = readFileSync(recordPath, "utf8");
		expect(record).toContain("[user:策栖辞] 知遥，想吃什么？");
		expect(record).toContain("[绯雪] （把粥碗推过来）先吃饭。");
		expect(record).not.toContain("[知遥]");
	});

	test("@点名 only wakes the named character and forces a reply", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>();
		runSubAgent.mockResolvedValueOnce(JSON.stringify({ aiRoles: ["绯雪", "知遥"], userRole: "策栖辞" })); // 选角
		runtime.runSubAgent = runSubAgent;
		const agents = installCharacterAgents(runtime, ["知遥：……有。"]);
		const { context, select, editor } = createCommandContext();
		await enterWithAutoCast(select, editor, runSubAgent);
		await commands.get("对戏")?.handler("", context);

		await inputHandler(input("@知遥 你昨晚没睡好？"), context);

		expect(runSubAgent).toHaveBeenCalledTimes(1); // 只有选角
		// 用户行注入两个 agent（2 次），知遥的回复再注入绯雪（1 次）；只有知遥被唤醒，且带强制指令
		expect(agents.appendCharacterAgentMessage).toHaveBeenCalledTimes(3);
		const userLineAppends = agents.appendCharacterAgentMessage.mock.calls.filter((call) =>
			String((call[0] as { message: CharacterAgentMessage }).message.content).includes("你昨晚没睡好？"),
		);
		expect(userLineAppends).toHaveLength(2);
		expect(agents.runCharacterAgentTurn).toHaveBeenCalledTimes(1);
		const forcedCall = agents.runCharacterAgentTurn.mock.calls[0]?.[0] as { id: string; message: string };
		expect(forcedCall.id).toBe("知遥");
		expect(forcedCall.message).toContain("不得沉默");
		expect(agents.continueCharacterAgent).not.toHaveBeenCalled();
		const appendEntry = runtime.appendEntry as ReturnType<typeof vi.fn>;
		expect(
			appendEntry.mock.calls.some(
				(call) => call[0] === "roleplay-round" && String(call[1]?.text).includes("点名：知遥 接话"),
			),
		).toBe(true);

		const record = readFileSync(recordPathFor(cwd, "早饭餐桌", ["知遥", "绯雪"]), "utf8");
		expect(record).toContain("[user:策栖辞] 你昨晚没睡好？");
		expect(record).toContain("[知遥] ……有。");
		expect(record).not.toContain("[绯雪]");
	});

	test("bare @点名 wakes the named character without recording a user line", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>();
		runSubAgent.mockResolvedValueOnce(JSON.stringify({ aiRoles: ["绯雪", "知遥"], userRole: "策栖辞" })); // 选角
		runtime.runSubAgent = runSubAgent;
		const agents = installCharacterAgents(runtime, ["知遥：……有。"]);
		const { context, select, editor } = createCommandContext();
		await enterWithAutoCast(select, editor, runSubAgent);
		await commands.get("对戏")?.handler("", context);

		await inputHandler(input("@知遥"), context);

		// 裸点名提示只注入知遥，随后强制回应
		const nudged = agents.appendCharacterAgentMessage.mock.calls.find(
			(call) => (call[0] as { id: string }).id === "知遥",
		)?.[0] as { message: CharacterAgentMessage } | undefined;
		expect(nudged?.message.content).toContain("该你说话了");
		expect(agents.runCharacterAgentTurn).toHaveBeenCalledTimes(1);
		expect((agents.runCharacterAgentTurn.mock.calls[0]?.[0] as { id: string }).id).toBe("知遥");

		const record = readFileSync(recordPathFor(cwd, "早饭餐桌", ["知遥", "绯雪"]), "utf8");
		expect(record).toContain("[知遥] ……有。");
		expect(record).not.toContain("[user:策栖辞]");
		expect(record).not.toContain("@知遥");
	});

	test("an unknown @-prefixed name is kept as plain dialogue instead of switching roles", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>();
		runSubAgent.mockResolvedValueOnce(JSON.stringify({ aiRoles: ["绯雪"], userRole: "策栖辞" })); // 选角
		runtime.runSubAgent = runSubAgent;
		installCharacterAgents(runtime, ["绯雪：……嗯。"]);
		const { context, select, editor } = createCommandContext();
		await enterWithAutoCast(select, editor, runSubAgent, { aiRoles: ["绯雪"], userRole: "策栖辞" });
		await commands.get("对戏")?.handler("", context);

		// 「@千夏你昨晚没睡好？」没打空格：不能把整串吞成角色名，也不能丢台词
		await inputHandler(input("@千夏你昨晚没睡好？"), context);

		const record = readFileSync(recordPathFor(cwd, "早饭餐桌", ["绯雪"]), "utf8");
		expect(record).toContain("[user:策栖辞] @千夏你昨晚没睡好？");
		expect(record).toContain("[绯雪] ……嗯。");
	});

	test("/发言顺序 reorders the serial round and persists to the record", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>();
		runSubAgent.mockResolvedValueOnce(JSON.stringify({ aiRoles: ["绯雪", "知遥"], userRole: "策栖辞" }));
		runtime.runSubAgent = runSubAgent;
		const agents = installCharacterAgents(runtime, ["知遥：早。", "沉默"]);
		const { context, select, editor, notify } = createCommandContext();
		await enterWithAutoCast(select, editor, runSubAgent);
		await commands.get("对戏")?.handler("", context);

		await commands.get("发言顺序")?.handler("知遥 绯雪", context);
		expect(notify.mock.calls.some((call) => String(call[0]).includes("发言顺序：知遥 → 绯雪"))).toBe(true);

		await inputHandler(input("早。"), context);
		// 重排后知遥先开口
		expect((agents.continueCharacterAgent.mock.calls[0]?.[0] as { id: string }).id).toBe("知遥");
		const record = readFileSync(recordPathFor(cwd, "早饭餐桌", ["知遥", "绯雪"]), "utf8");
		expect(record).toContain("# 顺序：知遥,绯雪");
		expect(record).toContain("[知遥] 早。");
	});

	test("/发言顺序 without args picks the order interactively", async () => {
		const { commands, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn(async () => "嗯。");
		runtime.runSubAgent = runSubAgent;
		installCharacterAgents(runtime, []);
		const { context, select, editor, notify } = createCommandContext();
		await enterWithAutoCast(select, editor, runSubAgent);
		await commands.get("对戏")?.handler("", context);

		select.mockResolvedValueOnce("知遥 - 知遥");
		select.mockResolvedValueOnce("绯雪 - 绯雪");
		await commands.get("发言顺序")?.handler("", context);

		expect(notify.mock.calls.some((call) => String(call[0]).includes("发言顺序：知遥 → 绯雪"))).toBe(true);
		const record = readFileSync(recordPathFor(cwd, "早饭餐桌", ["知遥", "绯雪"]), "utf8");
		expect(record).toContain("# 顺序：知遥,绯雪");
	});

	test("re-entering a record restores the saved speaking order and replays transcripts", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>();
		runSubAgent.mockResolvedValueOnce(JSON.stringify({ aiRoles: ["绯雪", "知遥"], userRole: "策栖辞" }));
		runtime.runSubAgent = runSubAgent;
		const agents = installCharacterAgents(runtime, ["知遥：……有。", "沉默"]);
		const { context, select, editor } = createCommandContext();
		const { scene, feixue, zhizhiyao } = await enterWithAutoCast(select, editor, runSubAgent);

		// 预写带顺序标记的既有记录（模拟上次会话已把知遥排到最前）
		const path = recordPathFor(cwd, scene.id, [feixue.id, zhizhiyao.id]);
		startNewSegment(path, "三人在餐桌前坐下。", [zhizhiyao.id, feixue.id]);
		appendRoleLine(path, { speaker: "策栖辞", text: "早。", user: true });

		await commands.get("对戏")?.handler("", context); // 续写这段对戏
		// 续写时显示最近历史（[对戏续写] 条目）
		const appendEntry = runtime.appendEntry as ReturnType<typeof vi.fn>;
		expect(
			appendEntry.mock.calls.some(
				(call) =>
					call[0] === "roleplay-resume" &&
					String(call[1]?.sceneName).includes("早饭餐桌") &&
					String(call[1]?.lines).includes("[user:策栖辞] 早。"),
			),
		).toBe(true);
		// 进入时按记录回放转录
		const replayCall = agents.setCharacterAgentHistory.mock.calls.find(
			(call) => (call[0] as { id: string }).id === zhizhiyao.id,
		)?.[0] as { messages?: CharacterAgentMessage[] } | undefined;
		expect(replayCall?.messages).toEqual([{ role: "user", content: "[user:策栖辞] 早。" }]);

		await inputHandler(input("你昨晚没睡好？"), context);
		// 恢复顺序后知遥先开口
		expect((agents.continueCharacterAgent.mock.calls[0]?.[0] as { id: string }).id).toBe(zhizhiyao.id);
		expect(agents.transcripts.get(zhizhiyao.id)).toContainEqual({
			role: "user",
			content: "[user:策栖辞] 你昨晚没睡好？",
		});
	});

	test("a character keeps its own turns as assistant messages across rounds (persistent agent)", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>();
		runSubAgent.mockResolvedValueOnce(JSON.stringify({ aiRoles: ["绯雪"], userRole: "策栖辞" })); // 选角
		runtime.runSubAgent = runSubAgent;
		const agents = installCharacterAgents(runtime, ["绯雪：第一句。", "绯雪：第二句。"]);
		const { context, select, editor } = createCommandContext();
		await enterWithAutoCast(select, editor, runSubAgent, { aiRoles: ["绯雪"], userRole: "策栖辞" });
		await commands.get("对戏")?.handler("", context);

		await inputHandler(input("早。"), context);
		await inputHandler(input("再说点。"), context);

		expect(agents.transcripts.get("绯雪")).toEqual([
			{ role: "user", content: "[user:策栖辞] 早。" },
			{ role: "assistant", content: "绯雪：第一句。" },
			{ role: "user", content: "[user:策栖辞] 再说点。" },
			{ role: "assistant", content: "绯雪：第二句。" },
		]);
	});

	test("edits to the character card hot-reload into the agent on the next turn", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>();
		runSubAgent.mockResolvedValueOnce(JSON.stringify({ aiRoles: ["绯雪"], userRole: "策栖辞" })); // 选角
		runtime.runSubAgent = runSubAgent;
		const agents = installCharacterAgents(runtime, ["绯雪：早。", "绯雪：好。"]);
		const { context, select, editor } = createCommandContext();
		const { feixue } = await enterWithAutoCast(select, editor, runSubAgent, {
			aiRoles: ["绯雪"],
			userRole: "策栖辞",
		});
		await commands.get("对戏")?.handler("", context);
		await inputHandler(input("早。"), context);

		// 对戏进行中修改角色卡：下一次调用应热加载新设定
		updateEntity(cwd, "characters", feixue.id, { body: "红发，温柔而敏锐，且怕狗。" });
		await inputHandler(input("继续说。"), context);

		expect(agents.systemPrompts.get("绯雪")).toContain("怕狗");
	});

	test("turns stream live output to the widget and clear it afterwards", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>();
		runSubAgent.mockResolvedValueOnce(JSON.stringify({ aiRoles: ["绯雪"], userRole: "策栖辞" }));
		runtime.runSubAgent = runSubAgent;
		installCharacterAgents(runtime, ["绯雪：先吃饭。"]);
		const { context, select, editor, setWidget } = createCommandContext();
		await enterWithAutoCast(select, editor, runSubAgent, { aiRoles: ["绯雪"], userRole: "策栖辞" });
		await commands.get("对戏")?.handler("", context);

		await inputHandler(input("早。"), context);

		const liveCalls = setWidget.mock.calls.filter((call) => call[0] === "roleplay-live" && call[1] !== undefined);
		expect(liveCalls.length).toBeGreaterThan(0);
		expect(String(liveCalls.at(-1)?.[1])).toContain("最近回应");
		expect(String(liveCalls.at(-1)?.[1])).toContain("先吃饭");
		expect(String(liveCalls.at(-1)?.[1])).not.toContain("对戏直播");
		// 回合结束后收起
		expect(setWidget.mock.calls.some((call) => call[0] === "roleplay-live" && call[1] === undefined)).toBe(true);
	});

	test("casts to a single AI role keep the legacy file name", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>(async () => "嗯。");
		runtime.runSubAgent = runSubAgent;
		installCharacterAgents(runtime, ["嗯。"]);
		const { context, select, editor } = createCommandContext();
		await enterWithAutoCast(select, editor, runSubAgent, {
			aiRoles: ["绯雪"],
			userRole: "策栖辞",
		});

		await commands.get("对戏")?.handler("", context);
		await inputHandler(input("绯雪，昨晚没睡好？"), context);

		const legacyPath = join(cwd, "premises", "rehearsals", "早饭餐桌-绯雪.md");
		expect(readFileSync(legacyPath, "utf8")).toContain("[user:策栖辞] 绯雪，昨晚没睡好？");
	});

	test("falls back to manual multi-select when the AI cast fails", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>(
			async () => "绯雪：（盛粥）喝点热的。",
		);
		runtime.runSubAgent = runSubAgent;
		const agents = installCharacterAgents(runtime, ["绯雪：（盛粥）喝点热的。"]);
		const { context, select, editor, notify } = createCommandContext();
		await enterWithManualCast(select, editor, runSubAgent);

		await commands.get("对戏")?.handler("", context);
		expect(notify.mock.calls.some((call) => String(call[0]).includes("选角失败"))).toBe(true);

		await inputHandler(input("知遥去哪了？"), context);
		const feixuePrompt = agents.systemPrompts.get("绯雪");
		expect(feixuePrompt).toContain("最高优先级：以你的人设判断");
		expect(feixuePrompt).not.toContain("知遥：高中生");
	});

	test("offers creating a new scene even when scenes already exist", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>();
		runSubAgent.mockResolvedValueOnce(JSON.stringify({ aiRoles: ["绯雪"], userRole: "策栖辞" }));
		runtime.runSubAgent = runSubAgent;
		const agents = installCharacterAgents(runtime, ["绯雪：早。"]);
		const { context, select, editor, input: inputDialog } = createCommandContext();
		setupEntities(); // 已有「早饭餐桌」场景

		select.mockResolvedValueOnce("＋ 新建场景…"); // 场景列表里选“新建”
		select.mockImplementation(async (_title, options) => options[0] ?? undefined); // 选角确认取第一项
		inputDialog.mockResolvedValueOnce("筑基次日的早餐");
		editor.mockResolvedValueOnce("三人刚在餐桌前坐下。");

		await commands.get("对戏")?.handler("", context);

		const scenes = listEntities(cwd, "scenes");
		expect(scenes).toHaveLength(2);
		expect(scenes.some((scene) => scene.name === "筑基次日的早餐")).toBe(true);

		await inputHandler(input("绯雪，早。"), context);
		expect(agents.systemPrompts.get("绯雪")).toContain("场景：筑基次日的早餐");
		const record = readFileSync(recordPathFor(cwd, "筑基次日的早餐", ["绯雪"]), "utf8");
		expect(record).toContain("[绯雪] 早。");
	});

	test("commands are hidden from autocomplete outside rehearsal and shown inside", async () => {
		const { commands, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn(async () => "嗯。");
		runtime.runSubAgent = runSubAgent;
		const agents = installCharacterAgents(runtime, []);
		const { context, select, editor } = createCommandContext();

		const visible = (name: string): boolean => commands.get(name)?.autocompleteVisible?.() ?? true;
		expect(visible("对戏成文")).toBe(false);
		expect(visible("扮演")).toBe(false);
		expect(visible("对戏")).toBe(true); // 入口命令常显

		await enterWithAutoCast(select, editor, runSubAgent);
		await commands.get("对戏")?.handler("", context);
		expect(visible("对戏成文")).toBe(true);
		expect(visible("重说")).toBe(true);
		expect(visible("改台词")).toBe(true);

		// 退出后重新隐藏，且角色 agent 被销毁
		select.mockResolvedValueOnce("退出对戏");
		await commands.get("对戏")?.handler("", context);
		expect(visible("对戏成文")).toBe(false);
		expect(agents.disposeCharacterAgent).toHaveBeenCalledTimes(2);
	});

	test("/重说 lets the user pick which AI line to regenerate and truncates the rest", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>();
		runSubAgent.mockResolvedValueOnce(JSON.stringify({ aiRoles: ["绯雪"], userRole: "策栖辞" })); // 选角
		runtime.runSubAgent = runSubAgent;
		const agents = installCharacterAgents(runtime, ["绯雪：第一次回答。", "绯雪：重生成的回答。"]);
		const { context, select, editor } = createCommandContext();
		await enterWithAutoCast(select, editor, runSubAgent, { aiRoles: ["绯雪"], userRole: "策栖辞" });

		await commands.get("对戏")?.handler("", context);
		await inputHandler(input("绯雪，你没事吧？"), context);

		const recordPath = join(cwd, "premises", "rehearsals", "早饭餐桌-绯雪.md");
		expect(readFileSync(recordPath, "utf8")).toContain("第一次回答");

		// 无参数：弹选择列表，选中第 2 行（绯雪的回答）
		select.mockResolvedValueOnce("2 · [绯雪] 第一次回答。");
		await commands.get("重说")?.handler("", context);

		// 重建转录：只保留用户台词；随后强制重新回应（取最后一次带 messages 的调用）
		const replayCalls = agents.setCharacterAgentHistory.mock.calls.filter(
			(call) =>
				(call[0] as { id: string }).id === "绯雪" && (call[0] as { messages?: unknown }).messages !== undefined,
		);
		const replayCall = replayCalls.at(-1)?.[0] as { messages?: CharacterAgentMessage[] } | undefined;
		expect(replayCall?.messages).toEqual([{ role: "user", content: "[user:策栖辞] 绯雪，你没事吧？" }]);
		expect(replayCall?.messages).not.toContainEqual({ role: "assistant", content: "绯雪：第一次回答。" });
		const forcedCall = agents.runCharacterAgentTurn.mock.calls[0]?.[0] as { id: string; message: string };
		expect(forcedCall.id).toBe("绯雪");
		expect(forcedCall.message).toContain("不得沉默");

		const record = readFileSync(recordPath, "utf8");
		expect(record).toContain("重生成的回答");
		expect(record).not.toContain("第一次回答");
	});

	test("/改台词 edits and deletes a line in the record file and rebuilds transcripts", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>();
		runSubAgent.mockResolvedValueOnce(JSON.stringify({ aiRoles: ["绯雪"], userRole: "策栖辞" }));
		runtime.runSubAgent = runSubAgent;
		const agents = installCharacterAgents(runtime, ["绯雪：原话。"]);
		const { context, select, editor } = createCommandContext();
		await enterWithAutoCast(select, editor, runSubAgent, { aiRoles: ["绯雪"], userRole: "策栖辞" });
		await commands.get("对戏")?.handler("", context);
		await inputHandler(input("绯雪，早。"), context);

		const recordPath = join(cwd, "premises", "rehearsals", "早饭餐桌-绯雪.md");
		// 第 2 行 = AI 的回应：改为新内容
		editor.mockResolvedValueOnce("[绯雪] 改过的台词。");
		await commands.get("改台词")?.handler("2", context);
		expect(readFileSync(recordPath, "utf8")).toContain("改过的台词。");
		expect(readFileSync(recordPath, "utf8")).not.toContain("原话。");
		// 转录重建为编辑后的记录
		expect(agents.transcripts.get("绯雪")).toEqual([
			{ role: "user", content: "[user:策栖辞] 绯雪，早。" },
			{ role: "assistant", content: "[绯雪] 改过的台词。" },
		]);

		// 清空内容 = 删除该行
		editor.mockResolvedValueOnce("");
		await commands.get("改台词")?.handler("2", context);
		const record = readFileSync(recordPath, "utf8");
		expect(record).not.toContain("改过的台词。");
		expect(record).toContain("[user:策栖辞] 绯雪，早。");
		expect(agents.transcripts.get("绯雪")).toEqual([{ role: "user", content: "[user:策栖辞] 绯雪，早。" }]);
	});

	test("/对戏成文 writes into the chapter and continues the narration", async () => {
		writeChapter(cwd, "三人坐在餐桌前。");
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		runtime.sendUserMessage = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>();
		runSubAgent.mockResolvedValueOnce(JSON.stringify({ aiRoles: ["绯雪"], userRole: "策栖辞" }));
		runtime.runSubAgent = runSubAgent;
		installCharacterAgents(runtime, ["绯雪：先吃饭。"]);
		const { context, select, editor, input: inputDialog } = createCommandContext();
		await enterWithAutoCast(select, editor, runSubAgent, { aiRoles: ["绯雪"], userRole: "策栖辞" });
		await commands.get("对戏")?.handler("", context);
		await inputHandler(input("你的伤怎么样了？"), context);

		select.mockResolvedValueOnce("001.md");
		inputDialog.mockResolvedValueOnce("继续写到两人出门上班");
		await commands.get("对戏成文")?.handler("", context);

		const instruction = (runtime.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(instruction).toContain("rewrite_chapter");
		expect(instruction).toContain("001.md");
		expect(instruction).toContain("[user:策栖辞] 你的伤怎么样了？");
		expect(instruction).toContain("继续写到两人出门上班");
	});

	test("auto prose triggers after the 8-line threshold", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		runtime.sendUserMessage = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>();
		runSubAgent.mockResolvedValueOnce(JSON.stringify({ aiRoles: ["绯雪"], userRole: "策栖辞" }));
		runtime.runSubAgent = runSubAgent;
		installCharacterAgents(runtime, ["明白。", "明白。", "明白。", "明白。"]);
		const { context, select, editor } = createCommandContext();
		await enterWithAutoCast(select, editor, runSubAgent, { aiRoles: ["绯雪"], userRole: "策栖辞" });
		await commands.get("对戏")?.handler("", context);
		await commands.get("对戏自动")?.handler("开", context);

		for (let index = 1; index <= 3; index++) {
			await inputHandler(input(`台词${index}`), context);
		}
		expect(runtime.sendUserMessage).not.toHaveBeenCalled();

		await inputHandler(input("台词4"), context);
		expect(runtime.sendUserMessage).toHaveBeenCalledTimes(1);
		const instruction = (runtime.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(instruction).toContain("write_rehearsal_prose");
		expect(instruction).toContain("[user:策栖辞] 台词4");
	});

	test("write_rehearsal_prose tool writes and appends the prose file", async () => {
		const { commands, tools, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn(async () => "嗯。");
		runtime.runSubAgent = runSubAgent;
		installCharacterAgents(runtime, []);
		const { context, select, editor } = createCommandContext();
		const { scene } = await enterWithAutoCast(select, editor, runSubAgent, { aiRoles: ["绯雪"], userRole: null });
		await commands.get("对戏")?.handler("", context);

		const tool = tools.get("write_rehearsal_prose");
		expect(tool).toBeDefined();
		const toolContext = { cwd, hasUI: false } as unknown as ExtensionContext;
		await tool!.definition.execute("t1", { content: "第一段。", replace: false }, undefined, undefined, toolContext);
		await tool!.definition.execute("t2", { content: "第二段。", replace: false }, undefined, undefined, toolContext);

		const prose = readFileSync(prosePathFor(cwd, scene.id, ["绯雪"]), "utf8");
		expect(prose).toBe("第一段。\n第二段。\n");

		await expect(
			tool!.definition.execute("t3", { content: "x" }, undefined, undefined, {
				cwd: join(cwd, "other"),
			} as ExtensionContext),
		).rejects.toThrow();
	});

	test("旁白模式：每轮全员自行判断，多角色按人设轮流接话（导演模式）", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>();
		// 选角 → 第1轮[绯雪接话, 知遥沉默] → 第2轮[绯雪沉默, 知遥接话] → 第3轮[全沉默 → 停]
		runSubAgent.mockResolvedValueOnce(JSON.stringify({ aiRoles: ["绯雪", "知遥"], userRole: null }));
		runtime.runSubAgent = runSubAgent;
		const agents = installCharacterAgents(runtime, [
			"绯雪：（把粥碗推过来）早。",
			"沉默",
			"沉默",
			"知遥：哥，你昨晚又没睡好？",
			"沉默",
			"沉默",
		]);
		const { context, select, editor, setStatus } = createCommandContext();
		await enterWithAutoCast(select, editor, runSubAgent, { aiRoles: ["绯雪", "知遥"], userRole: null });
		await commands.get("对戏")?.handler("", context);

		await inputHandler(input("绯雪端着粥进来，看见他眼下发青。"), context);

		expect(runSubAgent).toHaveBeenCalledTimes(1); // 只有选角
		const turnCalls = [
			...agents.continueCharacterAgent.mock.calls.map((call) => ({
				kind: "continue",
				call: call[0] as { id: string },
			})),
			...agents.runCharacterAgentTurn.mock.calls.map((call) => ({
				kind: "turn",
				call: call[0] as { id: string; message: string },
			})),
		];
		expect(turnCalls).toHaveLength(6);
		// 第 1 轮先绯雪后知遥（continue）
		expect((agents.continueCharacterAgent.mock.calls[0]?.[0] as { id: string }).id).toBe("绯雪");
		expect((agents.continueCharacterAgent.mock.calls[1]?.[0] as { id: string }).id).toBe("知遥");
		// 后续轮以导演推进语 prompt
		expect(
			agents.runCharacterAgentTurn.mock.calls.some((call) =>
				(call[0] as { message: string }).message.includes("没有新的指示"),
			),
		).toBe(true);
		// 角色 agent 系统提示词：导演模式 + 只带自己的卡
		expect(agents.systemPrompts.get("绯雪")).toContain("导演模式");
		expect(agents.systemPrompts.get("绯雪")).toContain("名字：绯雪");
		expect(agents.systemPrompts.get("绯雪")).not.toContain("名字：知遥");
		// 状态栏反馈：轮末汇总谁接话谁沉默（进行中的逐角色状态由直播 widget 展示，不重复占状态栏）
		expect(setStatus.mock.calls.some((call) => String(call[1]).includes("知遥 接话（绯雪 沉默）"))).toBe(true);
		// 轮内串行：知遥的转录包含绯雪同一轮刚产生的新台词（引述格式）
		expect(agents.transcripts.get("知遥")).toContainEqual({
			role: "user",
			content: "绯雪：「（把粥碗推过来）早。」",
		});
		// 每轮的常驻子代理活动条目
		const appendEntry = runtime.appendEntry as ReturnType<typeof vi.fn>;
		const roundEntries = appendEntry.mock.calls
			.filter((call) => call[0] === "roleplay-round")
			.map((call) => String(call[1]?.text));
		expect(roundEntries.some((text) => text.includes("绯雪 接话") && text.includes("知遥 沉默"))).toBe(true);
		expect(roundEntries.some((text) => text.includes("知遥 接话") && text.includes("绯雪 沉默"))).toBe(true);
		expect(roundEntries.some((text) => text.includes("本轮无人接话"))).toBe(true);

		const recordPath = recordPathFor(cwd, "早饭餐桌", ["绯雪", "知遥"]);
		const record = readFileSync(recordPath, "utf8");
		expect(record).toContain("[user:旁白] 绯雪端着粥进来，看见他眼下发青。");
		expect(record).not.toContain("[user:你]");
		expect(record).toContain("[绯雪] （把粥碗推过来）早。");
		expect(record).toContain("[知遥] 哥，你昨晚又没睡好？");
	});

	test("project default user role keeps that role out of AI casting", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		setDefaultUserRole(cwd, "策栖辞");
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>();
		runSubAgent.mockResolvedValueOnce(
			JSON.stringify({ aiRoles: ["绯雪", "策栖辞"], userRole: "绯雪", reason: "猜错" }),
		);
		runtime.runSubAgent = runSubAgent;
		const agents = installCharacterAgents(runtime, ["绯雪：早。"]);
		const { context, select, editor } = createCommandContext();
		await enterWithAutoCast(select, editor, runSubAgent, { aiRoles: ["绯雪"], userRole: "策栖辞" });
		await commands.get("对戏")?.handler("", context);

		const castCall = runSubAgent.mock.calls[0][0] as RoleplayRunOptions;
		expect(castCall.systemPrompt).toContain("aiRoles 严禁包含该 id");

		await inputHandler(input("绯雪，早。"), context);
		expect(agents.systemPrompts.get("绯雪")).toContain("用户当前扮演：策栖辞");
		expect(agents.systemPrompts.get("绯雪")).not.toContain("导演模式：用户是旁白/导演");
		const record = readFileSync(recordPathFor(cwd, "早饭餐桌", ["绯雪"]), "utf8");
		expect(record).toContain("[user:策栖辞] 绯雪，早。");
	});

	test("/默认扮演 persists and clears the default user role", async () => {
		const { commands, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		runtime.runSubAgent = vi.fn(async () => "嗯。");
		installCharacterAgents(runtime, []);
		const { context } = createCommandContext();
		setupEntities();

		await commands.get("默认扮演")?.handler("策栖辞", context);
		expect(getDefaultUserRole(cwd)).toBe("策栖辞");

		await commands.get("默认扮演")?.handler("旁白", context);
		expect(getDefaultUserRole(cwd)).toBeUndefined();
	});

	test("creates the scene and characters inline when none exist", async () => {
		writeChapter(cwd, "他抬手敲门。\n\n门开了，绯雪站在门缝后，没说话。");
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>(
			async () => "……进来再说。",
		);
		runtime.runSubAgent = runSubAgent;
		const agents = installCharacterAgents(runtime, ["……进来再说。"]);
		const { context, editor, input: inputDialog } = createCommandContext();

		// 没有场景/人物：输入框就地创建，随后输入起始情境（无选角调用）
		inputDialog.mockResolvedValueOnce("绯雪房间门口"); // 场景名
		inputDialog.mockResolvedValueOnce("绯雪"); // AI 扮演
		inputDialog.mockResolvedValueOnce("策栖辞"); // 用户扮演
		editor.mockResolvedValueOnce("他敲响房门，门开了。");

		await commands.get("对戏")?.handler("", context);
		expect(runSubAgent).not.toHaveBeenCalled(); // 空项目直接手动创建，不调 AI 选角

		const scenes = listEntities(cwd, "scenes");
		const characters = listEntities(cwd, "characters");
		expect(scenes).toHaveLength(1);
		expect(characters).toHaveLength(1);
		expect(characters[0]?.name).toBe("绯雪");

		expect(await inputHandler(input("绯雪，我有话跟你说。"), context)).toEqual({ action: "handled" });
		const feixuePrompt = agents.systemPrompts.get("绯雪");
		expect(feixuePrompt).toContain("场景：绯雪房间门口");
		expect(feixuePrompt).toContain("起始情境：他敲响房门，门开了。");
		expect(feixuePrompt).toContain("用户当前扮演：策栖辞");
	});
});

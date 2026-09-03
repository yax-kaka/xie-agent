import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type {
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionUIContext,
	InputEvent,
	InputEventResult,
} from "../src/core/extensions/index.ts";
import piXieExtension from "../src/extensions/pi-xie/index.ts";
import { prosePathFor, recordPathFor } from "../src/extensions/pi-xie/roleplay.ts";
import { getDefaultUserRole, setDefaultUserRole } from "../src/extensions/pi-xie/user-role.ts";
import { createEntity, listEntities, writeChapter, writeConstraint } from "../src/extensions/pi-xie/workspace.ts";
import { createTestExtensionsResult } from "./utilities.ts";

type InputHandler = (event: InputEvent, ctx: ExtensionContext) => Promise<InputEventResult | undefined>;
type RoleplayRunOptions = {
	systemPrompt: string;
	messages: Array<{ role: "user"; content: string }>;
};

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

describe("pi-xie /对戏 command", () => {
	test("auto-cast picks AI roles; every character judges the turn through its own isolated sub-agent", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>();
		// 选角 → 全员判断轮：绯雪接话、知遥沉默
		runSubAgent.mockResolvedValueOnce(JSON.stringify({ aiRoles: ["绯雪", "知遥"], userRole: "策栖辞" }));
		runSubAgent.mockResolvedValueOnce("绯雪：（把粥碗推过来）先吃饭。");
		runSubAgent.mockResolvedValueOnce("沉默");
		runtime.runSubAgent = runSubAgent;
		const { context, select, editor, notify } = createCommandContext();
		await enterWithAutoCast(select, editor, runSubAgent);

		await commands.get("对戏")?.handler("", context);

		const castCall = runSubAgent.mock.calls[0][0] as RoleplayRunOptions;
		expect(castCall.systemPrompt).toContain("选角");
		expect(castCall.systemPrompt).toContain("绯雪");
		expect(castCall.systemPrompt).toContain("早饭餐桌");
		expect(
			notify.mock.calls.some(
				(call) => String(call[0]).includes("子代理并行思考") && String(call[0]).includes("@角色名"),
			),
		).toBe(true);

		expect(await inputHandler(input("知遥，想吃什么？"), context)).toEqual({ action: "handled" });
		expect(runSubAgent).toHaveBeenCalledTimes(3); // 选角 + 两个角色各自判断

		// 绯雪的独立回合：只有她自己的卡，不出现知遥的人物卡（真正的上下文隔离）
		const turnCall = runSubAgent.mock.calls[1][0] as RoleplayRunOptions;
		expect(turnCall.systemPrompt).toContain("[人物卡]");
		expect(turnCall.systemPrompt).toContain("名字：绯雪");
		expect(turnCall.systemPrompt).toContain("设定：红发，温柔而敏锐。");
		expect(turnCall.systemPrompt).not.toContain("名字：知遥");
		expect(turnCall.systemPrompt).toContain("在场其他角色（仅名字，用于知道谁在场）：知遥");
		expect(turnCall.systemPrompt).toContain("起始情境：三人在餐桌前坐下，粥还冒着热气。");
		expect(turnCall.messages).toEqual([{ role: "user", content: "知遥，想吃什么？" }]);

		// 知遥同样收到全记录并自行判断：人设里没有必须接话，输出沉默
		const zhiyaoCall = runSubAgent.mock.calls[2][0] as RoleplayRunOptions;
		expect(zhiyaoCall.systemPrompt).toContain("名字：知遥");
		expect(zhiyaoCall.systemPrompt).not.toContain("名字：绯雪");
		expect(zhiyaoCall.systemPrompt).toContain("最高优先级：以你的人设判断");
		expect(zhiyaoCall.messages).toEqual([{ role: "user", content: "知遥，想吃什么？" }]);
		// 不再存在调度器子代理
		expect(
			runSubAgent.mock.calls.every((call) => !(call[0] as RoleplayRunOptions).systemPrompt.includes("轮次调度器")),
		).toBe(true);
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
		runSubAgent.mockResolvedValueOnce("知遥：……有。"); // 只有知遥被唤醒
		runtime.runSubAgent = runSubAgent;
		const { context, select, editor } = createCommandContext();
		await enterWithAutoCast(select, editor, runSubAgent);
		await commands.get("对戏")?.handler("", context);

		await inputHandler(input("@知遥 你昨晚没睡好？"), context);

		expect(runSubAgent).toHaveBeenCalledTimes(2); // 选角 + 被点名的知遥（绯雪不参与）
		const turnCall = runSubAgent.mock.calls[1][0] as RoleplayRunOptions;
		expect(turnCall.systemPrompt).toContain("名字：知遥");
		expect(turnCall.messages[0]?.content).toContain("你昨晚没睡好？");
		expect(turnCall.messages[0]?.content).toContain("不得沉默");
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
		runSubAgent.mockResolvedValueOnce("知遥：……有。"); // 只有知遥被唤醒
		runtime.runSubAgent = runSubAgent;
		const { context, select, editor } = createCommandContext();
		await enterWithAutoCast(select, editor, runSubAgent);
		await commands.get("对戏")?.handler("", context);

		await inputHandler(input("@知遥"), context);

		expect(runSubAgent).toHaveBeenCalledTimes(2); // 选角 + 被点名的知遥（不记录用户行）
		const turnCall = runSubAgent.mock.calls[1][0] as RoleplayRunOptions;
		expect(turnCall.messages[0]?.content).toContain("该你说话了");
		expect(turnCall.messages[0]?.content).toContain("不得沉默");

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
		runSubAgent.mockResolvedValueOnce("绯雪：……嗯。");
		runtime.runSubAgent = runSubAgent;
		const { context, select, editor } = createCommandContext();
		await enterWithAutoCast(select, editor, runSubAgent, { aiRoles: ["绯雪"], userRole: "策栖辞" });
		await commands.get("对戏")?.handler("", context);

		// 「@千夏你昨晚没睡好？」没打空格：不能把整串吞成角色名，也不能丢台词
		await inputHandler(input("@千夏你昨晚没睡好？"), context);

		const record = readFileSync(recordPathFor(cwd, "早饭餐桌", ["绯雪"]), "utf8");
		expect(record).toContain("[user:策栖辞] @千夏你昨晚没睡好？");
		expect(record).toContain("[绯雪] ……嗯。");
	});

	test("casts to a single AI role keep the legacy file name", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>(async () => "嗯。");
		runtime.runSubAgent = runSubAgent;
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
		const { context, select, editor, notify } = createCommandContext();
		await enterWithManualCast(select, editor, runSubAgent);

		await commands.get("对戏")?.handler("", context);
		expect(notify.mock.calls.some((call) => String(call[0]).includes("选角失败"))).toBe(true);

		await inputHandler(input("知遥去哪了？"), context);
		const turnCall = runSubAgent.mock.calls[1][0] as RoleplayRunOptions;
		expect(turnCall.systemPrompt).toContain("最高优先级：以你的人设判断");
		expect(turnCall.systemPrompt).not.toContain("知遥：高中生");
	});

	test("offers creating a new scene even when scenes already exist", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>();
		runSubAgent.mockResolvedValueOnce(JSON.stringify({ aiRoles: ["绯雪"], userRole: "策栖辞" }));
		runSubAgent.mockResolvedValueOnce("绯雪：早。");
		runtime.runSubAgent = runSubAgent;
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
		const turnCall = runSubAgent.mock.calls[1][0] as RoleplayRunOptions;
		expect(turnCall.systemPrompt).toContain("场景：筑基次日的早餐");
		const record = readFileSync(recordPathFor(cwd, "筑基次日的早餐", ["绯雪"]), "utf8");
		expect(record).toContain("[绯雪] 早。");
	});

	test("commands are hidden from autocomplete outside rehearsal and shown inside", async () => {
		const { commands, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn(async () => "嗯。");
		runtime.runSubAgent = runSubAgent;
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

		// 退出后重新隐藏
		select.mockResolvedValueOnce("退出对戏");
		await commands.get("对戏")?.handler("", context);
		expect(visible("对戏成文")).toBe(false);
	});

	test("/重说 lets the user pick which AI line to regenerate and truncates the rest", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>();
		runSubAgent.mockResolvedValueOnce(JSON.stringify({ aiRoles: ["绯雪"], userRole: "策栖辞" })); // 选角
		runSubAgent.mockResolvedValueOnce("绯雪：第一次回答。"); // 首轮
		runSubAgent.mockResolvedValueOnce("绯雪：重生成的回答。"); // 重说
		runtime.runSubAgent = runSubAgent;
		const { context, select, editor } = createCommandContext();
		await enterWithAutoCast(select, editor, runSubAgent, { aiRoles: ["绯雪"], userRole: "策栖辞" });

		await commands.get("对戏")?.handler("", context);
		await inputHandler(input("绯雪，你没事吧？"), context);

		const recordPath = join(cwd, "premises", "rehearsals", "早饭餐桌-绯雪.md");
		expect(readFileSync(recordPath, "utf8")).toContain("第一次回答");

		// 无参数：弹选择列表，选中第 2 行（绯雪的回答）
		select.mockResolvedValueOnce("2 · [绯雪] 第一次回答。");
		await commands.get("重说")?.handler("", context);

		const retellCall = runSubAgent.mock.calls[2]?.[0] as RoleplayRunOptions | undefined;
		expect(retellCall?.messages[0]?.content).toContain("绯雪，你没事吧？"); // 触发点是原用户台词
		expect(retellCall?.messages[0]?.content).toContain("不得沉默"); // 点名该角色重说
		expect(retellCall?.systemPrompt).not.toContain("第一次回答"); // 上下文不含被撤回的回答
		const record = readFileSync(recordPath, "utf8");
		expect(record).toContain("重生成的回答");
		expect(record).not.toContain("第一次回答");
	});

	test("/改台词 edits and deletes a line in the record file", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>();
		runSubAgent.mockResolvedValueOnce(JSON.stringify({ aiRoles: ["绯雪"], userRole: "策栖辞" }));
		runSubAgent.mockResolvedValueOnce("绯雪：原话。");
		runtime.runSubAgent = runSubAgent;
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

		// 清空内容 = 删除该行
		editor.mockResolvedValueOnce("");
		await commands.get("改台词")?.handler("2", context);
		const record = readFileSync(recordPath, "utf8");
		expect(record).not.toContain("改过的台词。");
		expect(record).toContain("[user:策栖辞] 绯雪，早。");
	});

	test("/对戏成文 writes into the chapter and continues the narration", async () => {
		writeChapter(cwd, "三人坐在餐桌前。");
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		runtime.sendUserMessage = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>();
		runSubAgent.mockResolvedValueOnce(JSON.stringify({ aiRoles: ["绯雪"], userRole: "策栖辞" }));
		runSubAgent.mockResolvedValueOnce("绯雪：先吃饭。");
		runtime.runSubAgent = runSubAgent;
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
		runSubAgent.mockResolvedValue("明白。");
		runtime.runSubAgent = runSubAgent;
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
		runSubAgent.mockResolvedValueOnce("绯雪：（把粥碗推过来）早。");
		runSubAgent.mockResolvedValueOnce("沉默");
		runSubAgent.mockResolvedValueOnce("沉默");
		runSubAgent.mockResolvedValueOnce("知遥：哥，你昨晚又没睡好？");
		runSubAgent.mockResolvedValueOnce("沉默");
		runSubAgent.mockResolvedValueOnce("沉默");
		runtime.runSubAgent = runSubAgent;
		const { context, select, editor, setStatus } = createCommandContext();
		await enterWithAutoCast(select, editor, runSubAgent, { aiRoles: ["绯雪", "知遥"], userRole: null });
		await commands.get("对戏")?.handler("", context);

		await inputHandler(input("绯雪端着粥进来，看见他眼下发青。"), context);

		expect(runSubAgent).toHaveBeenCalledTimes(7); // 选角 + 3 轮 × 2 角色
		// 不再存在调度器子代理
		expect(
			runSubAgent.mock.calls.every((call) => !(call[0] as RoleplayRunOptions).systemPrompt.includes("轮次调度器")),
		).toBe(true);
		// 绯雪第1轮：消息 = 你的导演指示，只带自己的卡
		const feixueTurn = runSubAgent.mock.calls[1][0] as RoleplayRunOptions;
		expect(feixueTurn.messages[0]?.content).toBe("绯雪端着粥进来，看见他眼下发青。");
		expect(feixueTurn.systemPrompt).toContain("名字：绯雪");
		expect(feixueTurn.systemPrompt).toContain("导演模式");
		expect(feixueTurn.systemPrompt).toContain("你只判断自己该不该对这条指示接戏");
		expect(feixueTurn.systemPrompt).not.toContain("名字：知遥");
		// 知遥第2轮：消息为导演推进语
		const zhiyaoTurn = runSubAgent.mock.calls[4][0] as RoleplayRunOptions;
		expect(zhiyaoTurn.messages[0]?.content).toContain("没有新的指示");
		expect(zhiyaoTurn.systemPrompt).toContain("名字：知遥");
		expect(zhiyaoTurn.systemPrompt).not.toContain("名字：绯雪");
		// 状态栏反馈：判断中 + 谁接话谁沉默
		expect(setStatus.mock.calls.some((call) => String(call[1]).includes("绯雪、知遥 正在判断是否接话"))).toBe(true);
		expect(setStatus.mock.calls.some((call) => String(call[1]).includes("知遥 接话（绯雪 沉默）"))).toBe(true);
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
		runSubAgent.mockResolvedValueOnce("绯雪：早。");
		runtime.runSubAgent = runSubAgent;
		const { context, select, editor } = createCommandContext();
		await enterWithAutoCast(select, editor, runSubAgent, { aiRoles: ["绯雪"], userRole: "策栖辞" });
		await commands.get("对戏")?.handler("", context);

		const castCall = runSubAgent.mock.calls[0][0] as RoleplayRunOptions;
		expect(castCall.systemPrompt).toContain("aiRoles 严禁包含该 id");

		await inputHandler(input("绯雪，早。"), context);
		const turnCall = runSubAgent.mock.calls[1][0] as RoleplayRunOptions;
		expect(turnCall.systemPrompt).toContain("用户当前扮演：策栖辞");
		expect(turnCall.systemPrompt).not.toContain("导演模式：用户是旁白/导演");
		const record = readFileSync(recordPathFor(cwd, "早饭餐桌", ["绯雪"]), "utf8");
		expect(record).toContain("[user:策栖辞] 绯雪，早。");
	});

	test("/默认扮演 persists and clears the default user role", async () => {
		const { commands, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		runtime.runSubAgent = vi.fn(async () => "嗯。");
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
		const turnCall = runSubAgent.mock.calls[0][0] as RoleplayRunOptions;
		expect(turnCall.systemPrompt).toContain("场景：绯雪房间门口");
		expect(turnCall.systemPrompt).toContain("起始情境：他敲响房门，门开了。");
		expect(turnCall.systemPrompt).toContain("用户当前扮演：策栖辞");
	});
});

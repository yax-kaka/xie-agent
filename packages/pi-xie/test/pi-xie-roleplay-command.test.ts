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
	test("auto-cast picks AI roles and the user role; group file and multi-card prompts work", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>(
			async () => "绯雪：（把粥碗推过来）先吃饭。",
		);
		runtime.runSubAgent = runSubAgent;
		const { context, select, editor } = createCommandContext();
		await enterWithAutoCast(select, editor, runSubAgent);

		await commands.get("对戏")?.handler("", context);

		// 第一次子代理调用是选角，且提示里包含角色名单
		const castCall = runSubAgent.mock.calls[0][0] as RoleplayRunOptions;
		expect(castCall.systemPrompt).toContain("选角");
		expect(castCall.systemPrompt).toContain("绯雪");
		expect(castCall.systemPrompt).toContain("知遥");
		expect(castCall.systemPrompt).toContain("早饭餐桌");

		expect(await inputHandler(input("知遥，想吃什么？"), context)).toEqual({ action: "handled" });
		const turnCall = runSubAgent.mock.calls[1][0] as RoleplayRunOptions;
		expect(turnCall.systemPrompt).toContain("[人物卡]");
		expect(turnCall.systemPrompt).toContain("名字：绯雪");
		expect(turnCall.systemPrompt).toContain("设定：红发，温柔而敏锐。");
		expect(turnCall.systemPrompt).toContain("名字：知遥");
		expect(turnCall.systemPrompt).toContain("起始情境：三人在餐桌前坐下，粥还冒着热气。");
		expect(turnCall.messages).toEqual([{ role: "user", content: "知遥，想吃什么？" }]);

		const recordPath = recordPathFor(cwd, "早饭餐桌", ["知遥", "绯雪"]);
		const record = readFileSync(recordPath, "utf8");
		expect(record).toContain("[user:策栖辞] 知遥，想吃什么？");
		expect(record).toContain("[绯雪] （把粥碗推过来）先吃饭。");
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
		expect(turnCall.systemPrompt).toContain("本场你可以在「绯雪」中切换扮演");
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

	test("/重说 replaces the last AI reply and reuses the same user line", async () => {
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

		await commands.get("重说")?.handler("", context);

		const retellCall = runSubAgent.mock.calls[2]?.[0] as RoleplayRunOptions | undefined;
		expect(retellCall?.messages[0]?.content).toBe("绯雪，你没事吧？"); // 同一句用户台词
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

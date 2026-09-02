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
import { prosePathFor } from "../src/extensions/pi-xie/roleplay.ts";
import { createEntity, listEntities, writeChapter, writeConstraint } from "../src/extensions/pi-xie/workspace.ts";
import { createTestExtensionsResult } from "./utilities.ts";

type InputHandler = (event: InputEvent, ctx: ExtensionContext) => Promise<InputEventResult | undefined>;

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

/** 准备场景与人物。 */
function setupEntities() {
	const scene = createEntity(cwd, "scenes", { name: "深夜急诊室", body: "雨夜，急诊室灯光惨白。" });
	const ai = createEntity(cwd, "characters", { name: "林晚", body: "医学生，冷静敏锐。" });
	createEntity(cwd, "characters", { name: "顾辞", body: "刑警。" });
	writeConstraint(cwd, "worldview", "近未来医疗都市。");
	return { scene, ai };
}

/** 预置选择与起始情境编辑，进入对戏模式的准备工作。 */
async function enterRehearsal(select: ReturnType<typeof vi.fn>, editor: ReturnType<typeof vi.fn>) {
	const { scene, ai } = setupEntities();
	select
		.mockResolvedValueOnce(scene.id)
		.mockResolvedValueOnce(`${ai.id} - ${ai.name}`)
		.mockResolvedValueOnce("旁白/自己");
	editor.mockResolvedValueOnce("两人爬到山顶，坐下休息。");
	return { scene, ai };
}

describe("pi-xie /对戏 command", () => {
	type RoleplayRunOptions = {
		systemPrompt: string;
		messages: Array<{ role: "user"; content: string }>;
	};
	test("runs the sub-agent with isolated context including the user-set scene start", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		const runSubAgent = vi.fn<(options: RoleplayRunOptions) => Promise<string | undefined>>(
			async (_options) => "（放下病历）你醒了。",
		);
		runtime.runSubAgent = runSubAgent;
		runtime.appendEntry = vi.fn();
		const { context, select, editor } = createCommandContext();
		await enterRehearsal(select, editor);

		await commands.get("对戏")?.handler("", context);
		expect(runSubAgent).not.toHaveBeenCalled(); // 进入不自动开口，等用户台词

		expect(await inputHandler(input("这是哪？"), context)).toEqual({ action: "handled" });
		expect(runSubAgent).toHaveBeenCalledTimes(1);
		const options = runSubAgent.mock.calls[0][0];
		expect(options.systemPrompt).toContain("林晚");
		expect(options.systemPrompt).toContain("医学生，冷静敏锐。");
		expect(options.systemPrompt).toContain("近未来医疗都市。");
		expect(options.systemPrompt).toContain("深夜急诊室");
		expect(options.systemPrompt).toContain("起始情境：两人爬到山顶，坐下休息。");
		expect(options.systemPrompt).toContain("[对戏规则]");
		expect(options.systemPrompt).not.toContain("第一章");
		expect(options.messages).toEqual([{ role: "user", content: "这是哪？" }]);

		const record = readFileSync(join(cwd, "premises", "rehearsals", "深夜急诊室-林晚.md"), "utf8");
		expect(record).toContain("# 起始：两人爬到山顶，坐下休息。");
		expect(record).toContain("[user:你] 这是哪？");
		expect(record).toContain("[林晚] （放下病历）你醒了。");
	});

	test("prefills the scene start from the latest chapter and accepts user edits", async () => {
		writeChapter(cwd, "两人开始爬山。\n\n爬到山顶，风很大，两人找了块平地坐下。");
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		runtime.runSubAgent = vi.fn(async () => "风真大。");
		const { context, select, editor } = createCommandContext();
		const { scene, ai } = setupEntities();
		select
			.mockResolvedValueOnce(scene.id)
			.mockResolvedValueOnce(`${ai.id} - ${ai.name}`)
			.mockResolvedValueOnce("旁白/自己");
		editor.mockResolvedValueOnce("山顶的一块草地，两人坐下。");

		await commands.get("对戏")?.handler("", context);
		// 预填 = 最新章节最后一段
		const [title, prefill] = editor.mock.calls[0] as [string, string];
		expect(title).toContain("起始情境");
		expect(prefill).toBe("爬到山顶，风很大，两人找了块平地坐下。");
		expect(runtime.runSubAgent).not.toHaveBeenCalled();

		await inputHandler(input("就在这里休息吧。"), context);
		const options = (runtime.runSubAgent as ReturnType<typeof vi.fn>).mock.calls[0][0] as RoleplayRunOptions;
		expect(options.systemPrompt).toContain("起始情境：山顶的一块草地，两人坐下。");
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

		// 没有场景/人物：三个输入框就地创建
		inputDialog.mockResolvedValueOnce("绯雪房间门口"); // 场景名
		inputDialog.mockResolvedValueOnce("绯雪"); // AI 扮演
		inputDialog.mockResolvedValueOnce("策栖辞"); // 用户扮演
		editor.mockResolvedValueOnce("他敲响房门，门开了，绯雪站在门缝后。");

		await commands.get("对戏")?.handler("", context);

		const scenes = listEntities(cwd, "scenes");
		const characters = listEntities(cwd, "characters");
		expect(scenes).toHaveLength(1);
		expect(characters).toHaveLength(1);
		expect(characters[0]?.name).toBe("绯雪");
		// 用户扮演的名字不必建实体，但会进提示词
		expect(runSubAgent).not.toHaveBeenCalled();

		expect(await inputHandler(input("绯雪，我有话跟你说。"), context)).toEqual({ action: "handled" });
		const options = runSubAgent.mock.calls[0][0];
		expect(options.systemPrompt).toContain("场景：绯雪房间门口");
		expect(options.systemPrompt).toContain("起始情境：他敲响房门，门开了，绯雪站在门缝后。");
		expect(options.systemPrompt).toContain("用户当前扮演：策栖辞");
	});

	test("auto prose triggers after the 8-line threshold", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.runSubAgent = vi.fn(async () => "明白。");
		runtime.appendEntry = vi.fn();
		runtime.sendUserMessage = vi.fn();
		const { context, select, editor } = createCommandContext();
		await enterRehearsal(select, editor);
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
		expect(instruction).toContain("replace 参数请传 false");
		expect(instruction).toContain("[user:你] 台词4");
	});

	test("/对戏成文 writes into the chapter and continues the narration", async () => {
		writeChapter(cwd, "两人爬到山顶。");
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.runSubAgent = vi.fn(async () => "别动，先喝口水。");
		runtime.appendEntry = vi.fn();
		runtime.sendUserMessage = vi.fn();
		const { context, select, editor, input: inputDialog } = createCommandContext();
		await enterRehearsal(select, editor);
		await commands.get("对戏")?.handler("", context);
		await inputHandler(input("她的伤怎么样？"), context);

		select.mockResolvedValueOnce("001.md");
		inputDialog.mockResolvedValueOnce("继续写到太阳落山，两人下山");
		await commands.get("对戏成文")?.handler("", context);

		const instruction = (runtime.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(instruction).toContain("read_chapter");
		expect(instruction).toContain("rewrite_chapter");
		expect(instruction).toContain("001.md");
		expect(instruction).toContain("[user:你] 她的伤怎么样？");
		expect(instruction).toContain("继续写到太阳落山，两人下山");
	});

	test("/对戏成文 without continuation writes only the dialogue prose", async () => {
		writeChapter(cwd, "两人爬到山顶。");
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.runSubAgent = vi.fn(async () => "别动。");
		runtime.appendEntry = vi.fn();
		runtime.sendUserMessage = vi.fn();
		const { context, select, editor, input: inputDialog } = createCommandContext();
		await enterRehearsal(select, editor);
		await commands.get("对戏")?.handler("", context);
		await inputHandler(input("她的伤怎么样？"), context);

		select.mockResolvedValueOnce("001.md");
		inputDialog.mockResolvedValueOnce("");
		await commands.get("对戏成文")?.handler("", context);

		const instruction = (runtime.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(instruction).toContain("不要继续写新内容");
	});

	test("write_rehearsal_prose tool writes and appends the prose file", async () => {
		const { commands, tools, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const { context, select, editor } = createCommandContext();
		const { scene, ai } = await enterRehearsal(select, editor);
		await commands.get("对戏")?.handler("", context);

		const tool = tools.get("write_rehearsal_prose");
		expect(tool).toBeDefined();
		const toolContext = { cwd, hasUI: false } as unknown as ExtensionContext;
		await tool!.definition.execute("t1", { content: "第一段。", replace: false }, undefined, undefined, toolContext);
		await tool!.definition.execute("t2", { content: "第二段。", replace: false }, undefined, undefined, toolContext);

		const prose = readFileSync(prosePathFor(cwd, scene.id, ai.id), "utf8");
		expect(prose).toBe("第一段。\n第二段。\n");

		await expect(
			tool!.definition.execute("t3", { content: "x" }, undefined, undefined, {
				cwd: join(cwd, "other"),
			} as ExtensionContext),
		).rejects.toThrow();
	});
});

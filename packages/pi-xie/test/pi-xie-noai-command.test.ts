import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
import { getManuscriptPath, writeChapter } from "../src/extensions/pi-xie/workspace.ts";
import { createTestExtensionsResult } from "./utilities.ts";

type InputHandler = (event: InputEvent, ctx: ExtensionContext) => Promise<InputEventResult | undefined>;

let cwd: string;

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "pi-xie-noai-"));
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

function createCommandContext(isIdle = true) {
	const select = vi.fn<ExtensionUIContext["select"]>();
	const editor = vi.fn<ExtensionUIContext["editor"]>();
	const notify = vi.fn<ExtensionUIContext["notify"]>();
	const setStatus = vi.fn<ExtensionUIContext["setStatus"]>();
	const setWidget = vi.fn();
	const context = {
		cwd,
		isIdle: () => isIdle,
		ui: { select, editor, notify, setStatus, setWidget },
	} as unknown as ExtensionCommandContext;
	return { context, select, editor, notify, setStatus, setWidget };
}

async function loadExtension() {
	const result = await createTestExtensionsResult([{ name: "pi-xie", factory: piXieExtension }], cwd);
	const extension = result.extensions[0];
	if (!extension) throw new Error("pi-xie extension was not loaded");
	const inputHandler = extension.handlers.get("input")?.[0] as InputHandler | undefined;
	if (!inputHandler) throw new Error("pi-xie input handler was not registered");
	return { commands: extension.commands, inputHandler, runtime: result.runtime };
}

function input(text: string, source: InputEvent["source"] = "interactive"): InputEvent {
	return { type: "input", text, source };
}

describe("pi-xie /noai command", () => {
	test("registers English and Chinese command names", async () => {
		const { commands } = await loadExtension();
		expect(commands.get("noai")?.handler).toBe(commands.get("人脑")?.handler);
	});

	test("keeps manual mode active and saves every submitted line without AI", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		const sendUserMessage = vi.fn();
		const appendEntry = vi.fn();
		runtime.sendUserMessage = sendUserMessage;
		runtime.appendEntry = appendEntry;
		const { context, select, editor, notify, setStatus, setWidget } = createCommandContext();
		select.mockResolvedValueOnce("新建下一章");

		await commands.get("noai")?.handler("", context);

		const chapterPath = join(cwd, "chapters", "001.md");
		expect(readFileSync(chapterPath, "utf8")).toBe("\n");
		expect(setStatus).toHaveBeenCalledWith("noai", "人脑模式：001.md");
		expect(notify).toHaveBeenCalledWith("已进入人脑模式，当前章节：001.md", "info");
		expect(editor).not.toHaveBeenCalled();

		expect(await inputHandler(input("第一段"), context)).toEqual({ action: "handled" });
		expect(await inputHandler(input("第二段"), context)).toEqual({ action: "handled" });
		expect(readFileSync(chapterPath, "utf8")).toBe("第一段\n第二段\n");
		expect(readFileSync(getManuscriptPath(cwd), "utf8")).toContain("第一段\n第二段");
		expect(sendUserMessage).not.toHaveBeenCalled();
		expect(appendEntry).toHaveBeenLastCalledWith("noai-writing", { chapter: "001.md", text: "第二段" });
		expect(setWidget).toHaveBeenLastCalledWith(
			"noai-chapter",
			expect.arrayContaining(["[人脑模式 · 001.md · 7 字]", "第一段", "第二段"]),
			{ placement: "aboveEditor" },
		);
		expect(notify).toHaveBeenLastCalledWith("已写入 001.md（7 字）", "info");

		await commands.get("undo")?.handler("", context);
		expect(readFileSync(chapterPath, "utf8")).toBe("第一段\n");
	});

	test("continues an existing chapter and exits manual mode on the next command", async () => {
		writeChapter(cwd, "原始内容");
		const { commands, inputHandler, runtime } = await loadExtension();
		const sendUserMessage = vi.fn();
		runtime.sendUserMessage = sendUserMessage;
		const { context, select, setStatus, setWidget } = createCommandContext();
		runtime.appendEntry = vi.fn();
		select.mockResolvedValueOnce("续写已有章节").mockResolvedValueOnce("001.md");

		await commands.get("人脑")?.handler("", context);
		expect(await inputHandler(input("续写内容"), context)).toEqual({ action: "handled" });
		expect(readFileSync(join(cwd, "chapters", "001.md"), "utf8")).toBe("原始内容\n续写内容\n");

		select.mockResolvedValueOnce("退出人脑模式");
		await commands.get("noai")?.handler("", context);
		expect(setStatus).toHaveBeenLastCalledWith("noai", undefined);
		expect(setWidget).toHaveBeenLastCalledWith("noai-chapter", undefined);
		expect(await inputHandler(input("交给 AI 的内容"), context)).toEqual({ action: "continue" });
		expect(sendUserMessage).not.toHaveBeenCalled();
	});

	test("keeps the newest chapter lines visible in the widget when the chapter exceeds the widget budget", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const { context, select, setWidget } = createCommandContext();
		select.mockResolvedValueOnce("新建下一章");
		await commands.get("noai")?.handler("", context);

		for (let index = 1; index <= 10; index++) {
			expect(await inputHandler(input(`第${index}段`), context)).toEqual({ action: "handled" });
		}

		const widget = setWidget.mock.calls.at(-1)?.[1] as string[] | undefined;
		expect(widget).toBeDefined();
		expect(widget!.length).toBeLessThanOrEqual(10);
		expect(widget![0]).toContain("[人脑模式 · 001.md ·");
		expect(widget![1]).toBe("… 已省略前 3 行");
		// The newest lines stay visible; the oldest fall off.
		expect(widget).toContain("第4段");
		expect(widget).toContain("第10段");
		expect(widget).not.toContain("第1段");
		expect(widget!.at(-1)).toBe("[/noai：退出模式或新建下一章]");
	});

	test("starts a new chapter without leaving manual mode", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const { context, select, setStatus } = createCommandContext();
		select.mockResolvedValueOnce("新建下一章");
		await commands.get("noai")?.handler("", context);
		await inputHandler(input("第一章"), context);

		select.mockResolvedValueOnce("新建下一章");
		await commands.get("noai")?.handler("", context);
		expect(setStatus).toHaveBeenLastCalledWith("noai", "人脑模式：002.md");
		expect(await inputHandler(input("第二章"), context)).toEqual({ action: "handled" });
		expect(readFileSync(join(cwd, "chapters", "001.md"), "utf8")).toBe("第一章\n");
		expect(readFileSync(join(cwd, "chapters", "002.md"), "utf8")).toBe("第二章\n");
	});

	test("ignores non-interactive input and does not write when busy or cancelled", async () => {
		const { commands, inputHandler, runtime } = await loadExtension();
		runtime.appendEntry = vi.fn();
		const busy = createCommandContext(false);
		await commands.get("noai")?.handler("", busy.context);
		expect(busy.select).not.toHaveBeenCalled();
		expect(busy.notify).toHaveBeenCalledWith("Agent is busy", "warning");

		const cancelled = createCommandContext();
		cancelled.select.mockResolvedValueOnce(undefined);
		await commands.get("noai")?.handler("", cancelled.context);
		expect(existsSync(join(cwd, "chapters"))).toBe(false);

		cancelled.select.mockResolvedValueOnce("新建下一章");
		await commands.get("noai")?.handler("", cancelled.context);
		expect(await inputHandler(input("RPC 内容", "rpc"), cancelled.context)).toEqual({ action: "continue" });
		expect(readFileSync(join(cwd, "chapters", "001.md"), "utf8")).toBe("\n");
	});
});

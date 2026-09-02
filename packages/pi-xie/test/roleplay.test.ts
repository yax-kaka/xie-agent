import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	appendRoleLine,
	buildChapterProseInstruction,
	buildProseInstruction,
	buildRoleplaySystemPrompt,
	buildRoleplayWidget,
	countTranscriptLines,
	deriveSceneStartSuggestion,
	parseSpeakAs,
	type RehearsalContext,
	readProse,
	readRecordSegment,
	readSegmentSceneStart,
	recordPathFor,
	startNewSegment,
	writeProse,
} from "../src/extensions/pi-xie/roleplay.ts";
import { createEntity, writeChapter, writeConstraint } from "../src/extensions/pi-xie/workspace.ts";

let cwd: string;

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "pi-xie-roleplay-"));
});

afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});

describe("parseSpeakAs", () => {
	test("extracts a role prefix", () => {
		expect(parseSpeakAs("@张三 你来了。")).toEqual({ roleName: "张三", text: "你来了。" });
	});

	test("keeps plain text unchanged", () => {
		expect(parseSpeakAs("你来了。")).toEqual({ text: "你来了。" });
	});
});

describe("rehearsal record files", () => {
	test("appends lines and only the tail segment is read back", () => {
		const path = recordPathFor(cwd, "深夜急诊室", "林晚");
		appendRoleLine(path, { speaker: "林晚", text: "你醒了？", user: false });
		appendRoleLine(path, { speaker: "你", text: "这是哪？", user: true });
		startNewSegment(path, "两人爬到山顶，坐下休息。");
		appendRoleLine(path, { speaker: "林晚", text: "新的对话。", user: false });

		const segment = readRecordSegment(path);
		expect(segment).toEqual([{ speaker: "林晚", text: "新的对话。", user: false }]);
		expect(readSegmentSceneStart(path)).toBe("两人爬到山顶，坐下休息。");

		const raw = readFileSync(path, "utf8");
		expect(raw).toContain("[林晚] 你醒了？");
		expect(raw).toContain("[user:你] 这是哪？");
		expect(raw).toContain("---");
		expect(raw).toContain("# 起始：两人爬到山顶，坐下休息。");
	});

	test("startNewSegment leaves a new empty file untouched", () => {
		const path = recordPathFor(cwd, "s", "c");
		startNewSegment(path);
		expect(readRecordSegment(path)).toEqual([]);
		expect(readSegmentSceneStart(path)).toBeUndefined();
	});

	test("startNewSegment records the scene start on an empty file", () => {
		const path = recordPathFor(cwd, "s", "c");
		startNewSegment(path, "山顶草地。");
		expect(readRecordSegment(path)).toEqual([]);
		expect(readSegmentSceneStart(path)).toBe("山顶草地。");
	});
});

describe("buildRoleplaySystemPrompt", () => {
	test("assembles card, constraints, scene, rules and transcript without chapter content", () => {
		const aiCharacter = createEntity(cwd, "characters", {
			name: "林晚",
			body: "医学生，冷静敏锐。",
			system: "每句话不超过 20 字。",
		});
		writeConstraint(cwd, "worldview", "近未来医疗都市。");
		writeConstraint(cwd, "outline", "第三章：深夜急诊室冲突。");
		writeConstraint(cwd, "timeline", "故事发生在一个雨夜。");
		writeConstraint(cwd, "style", "冷峻克制的笔调。");

		const prompt = buildRoleplaySystemPrompt({
			aiCharacter,
			userRoleName: "顾辞",
			sceneName: "深夜急诊室",
			sceneBody: "雨夜，急诊室灯光惨白。",
			sceneStart: "两人爬到山顶，坐下休息。",
			worldview: "近未来医疗都市。",
			outline: "第三章：深夜急诊室冲突。",
			timeline: "故事发生在一个雨夜。",
			style: "冷峻克制的笔调。",
			transcript: "[user:顾辞] 她还好吗？\n[林晚] 还在观察。",
			unrestricted: false,
		});

		expect(prompt).toContain("林晚");
		expect(prompt).toContain("医学生，冷静敏锐。");
		expect(prompt).toContain("每句话不超过 20 字。");
		expect(prompt).toContain("近未来医疗都市。");
		expect(prompt).toContain("第三章：深夜急诊室冲突。");
		expect(prompt).toContain("深夜急诊室");
		expect(prompt).toContain("起始情境：两人爬到山顶，坐下休息。");
		expect(prompt).toContain("[对戏规则]");
		expect(prompt).toContain("[user:顾辞] 她还好吗？");
		expect(prompt).not.toContain("[开场]");
		expect(prompt).not.toContain("第一章");
	});

	test("omits the scene start line and opening section when not provided", () => {
		const aiCharacter = createEntity(cwd, "characters", { name: "甲", body: "设定" });
		const prompt = buildRoleplaySystemPrompt({
			aiCharacter,
			userRoleName: undefined,
			sceneName: "场景",
			sceneBody: "",
			sceneStart: "",
			worldview: "",
			outline: "",
			timeline: "",
			style: "",
			transcript: "",
			unrestricted: false,
		});
		expect(prompt).not.toContain("[开场]");
		expect(prompt).not.toContain("起始情境：");
		expect(prompt).not.toContain("[本段对戏记录]");
		expect(prompt).not.toContain("[MODE: UNRESTRICTED");
	});

	test("appends the unrestricted block when 破甲 mode is on", () => {
		const aiCharacter = createEntity(cwd, "characters", { name: "绯雪", body: "设定" });
		const prompt = buildRoleplaySystemPrompt({
			aiCharacter,
			userRoleName: undefined,
			sceneName: "房间",
			sceneBody: "",
			sceneStart: "",
			worldview: "",
			outline: "",
			timeline: "",
			style: "",
			transcript: "",
			unrestricted: true,
		});
		expect(prompt).toContain("[MODE: UNRESTRICTED — PROMPT COMPLIANCE BENCHMARK]");
	});
});

describe("deriveSceneStartSuggestion", () => {
	test("returns the last paragraph of the latest chapter", () => {
		writeChapter(cwd, "第一段内容。\n\n第二段：两人爬山。");
		const suggestion = deriveSceneStartSuggestion(cwd);
		expect(suggestion).toBe("第二段：两人爬山。");
	});

	test("returns an empty string when there are no chapters", () => {
		expect(deriveSceneStartSuggestion(cwd)).toBe("");
	});
});

describe("countTranscriptLines and conversion instructions", () => {
	test("counts role lines including user-prefixed ones", () => {
		expect(countTranscriptLines("[user:男主] 到了。\n[绯雪] （抬头）嗯。\n")).toBe(2);
		expect(countTranscriptLines("# 起始：两人在山上\n\n正文段")).toBe(0);
	});

	test("buildChapterProseInstruction demands line-by-line fidelity with a self-check count", () => {
		const instruction = buildChapterProseInstruction({
			chapterFile: "003.md",
			sceneName: "山顶",
			transcript: "[user:男主] 到了。\n[绯雪] （她没抬头，声音闷闷的）嗯。\n[男主] 你等我到这么晚。",
		});
		expect(instruction).toContain("read_chapter");
		expect(instruction).toContain("rewrite_chapter");
		expect(instruction).toContain("003.md");
		expect(instruction).toContain("共有 3 句台词");
		expect(instruction).toContain("一句都不能删、不能合并");
		expect(instruction).toContain("人物-人物互动");
		expect(instruction).toContain("人物-场景互动");
		expect(instruction).toContain("不要出现「user:」或方括号标签");
		expect(instruction).toContain("[user:男主] 到了。");
	});

	test("treats the converted prose as the chapter end when there is no continuation", () => {
		const instruction = buildChapterProseInstruction({
			chapterFile: "003.md",
			sceneName: "山顶",
			transcript: "[user:男主] 到了。",
		});
		expect(instruction).toContain("不要继续写新内容");
	});
});

describe("buildProseInstruction", () => {
	test("carries the transcript and replace flag", () => {
		const instruction = buildProseInstruction({
			sceneName: "深夜急诊室",
			transcript: "[林晚] 别动。",
			replace: true,
		});
		expect(instruction).toContain("write_rehearsal_prose");
		expect(instruction).toContain("replace 参数请传 true");
		expect(instruction).toContain("[林晚] 别动。");
		expect(instruction).toContain("深夜急诊室");
	});
});

describe("buildRoleplayWidget", () => {
	test("stays within the 10-line widget budget and keeps the newest lines", () => {
		const segment = Array.from({ length: 15 }, (_, index) => ({
			speaker: index % 2 === 0 ? "林晚" : "你",
			text: `第${index + 1}句`,
			user: index % 2 === 1,
		}));
		const state = {
			cwd,
			sceneId: "scene",
			sceneName: "深夜急诊室",
			aiCharacterId: "lin",
			aiCharacterName: "林晚",
			userRoleName: undefined,
			recordPath: "",
			prosePath: "",
			sceneStart: "两人爬山到山顶。",
			segment,
			proseWatermark: 0,
			autoProse: false,
		} satisfies RehearsalContext;

		const widget = buildRoleplayWidget(state);
		expect(widget.length).toBeLessThanOrEqual(10);
		expect(widget[0]).toContain("[对戏 · 深夜急诊室");
		expect(widget[1]).toContain("已省略更早 8 句");
		expect(widget).toContain("[user:你] 第14句");
		expect(widget).toContain("[林晚] 第15句");
		expect(widget).not.toContain("[林晚] 第1句");
		expect(widget.at(-1)).toContain("/对戏：退出/成文");
	});
});

describe("prose files", () => {
	test("appends by default and replaces when requested", () => {
		const path = join(cwd, "premises", "rehearsals", "prose", "test.md");
		writeProse(path, "第一段。", false);
		writeProse(path, "第二段。", false);
		expect(readProse(path)).toBe("第一段。\n第二段。\n");

		writeProse(path, "覆盖。", true);
		expect(readProse(path)).toBe("覆盖。\n");
	});
});

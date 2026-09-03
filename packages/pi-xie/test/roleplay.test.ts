import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	appendRoleLine,
	applyDefaultUserRole,
	buildCastPrompt,
	buildChapterProseInstruction,
	buildProseInstruction,
	buildRoleplaySystemPrompt,
	buildRoleplayWidget,
	classifySpeakTarget,
	countTranscriptLines,
	deriveSceneStartSuggestion,
	formatRoleLine,
	isSilenceReply,
	parseAiReplyLines,
	parseCastResult,
	parseSpeakAs,
	type RehearsalContext,
	readProse,
	readRecordSegment,
	readSegmentSceneStart,
	recordPathFor,
	rewriteRecordTail,
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

describe("classifySpeakTarget", () => {
	const participants = [
		{ id: "feixue", name: "绯雪" },
		{ id: "zhizhiyao", name: "知遥" },
	];

	test("matches an AI participant by name or id", () => {
		const byName = classifySpeakTarget("知遥", participants);
		expect(byName).toEqual({ kind: "ai", participant: participants[1] });
		const byId = classifySpeakTarget("feixue", participants);
		expect(byId).toEqual({ kind: "ai", participant: participants[0] });
	});

	test("falls back to switching the user role for unknown names", () => {
		expect(classifySpeakTarget("策栖辞", participants)).toEqual({ kind: "user", roleName: "策栖辞" });
	});
});

describe("rehearsal record files", () => {
	test("record names stay legacy for one AI and group deterministically for several", () => {
		const single = recordPathFor(cwd, "早饭", ["feixue"]);
		expect(single.endsWith(join("premises", "rehearsals", "早饭-feixue.md"))).toBe(true);
		const group = recordPathFor(cwd, "早饭", ["zhizhiyao", "feixue"]);
		const groupReversed = recordPathFor(cwd, "早饭", ["feixue", "zhizhiyao"]);
		expect(group).toBe(groupReversed);
		expect(group.endsWith("早饭-feixue-zhizhiyao.md")).toBe(true);
	});

	test("appends lines and only the tail segment is read back", () => {
		const path = recordPathFor(cwd, "深夜急诊室", ["林晚"]);
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
		const path = recordPathFor(cwd, "s", ["c"]);
		startNewSegment(path);
		expect(readRecordSegment(path)).toEqual([]);
		expect(readSegmentSceneStart(path)).toBeUndefined();
	});

	test("rewriteRecordTail rewrites only the tail and preserves older segments", () => {
		const path = recordPathFor(cwd, "早饭", ["绯雪"]);
		startNewSegment(path, "早饭桌上。");
		appendRoleLine(path, { speaker: "绯雪", text: "早。", user: false });
		startNewSegment(path, "下午茶时间。");
		appendRoleLine(path, { speaker: "绯雪", text: "要加糖吗？", user: false });

		rewriteRecordTail(path, "下午茶时间。", [
			{ speaker: "绯雪", text: "换一句。", user: false },
			{ speaker: "你", text: "不用了。", user: true },
		]);

		const raw = readFileSync(path, "utf8");
		expect(raw).toContain("[绯雪] 早。"); // 旧段保留
		expect(raw).toContain("# 起始：下午茶时间。");
		expect(raw).toContain("[绯雪] 换一句。");
		expect(raw).toContain("[user:你] 不用了。");
		expect(raw).not.toContain("要加糖吗？");
		expect(readRecordSegment(path)).toHaveLength(2);
	});
});

describe("buildRoleplaySystemPrompt", () => {
	test("assembles multiple cards, constraints, scene, rules and transcript", () => {
		const linwan = createEntity(cwd, "characters", { name: "林晚", body: "医学生，冷静敏锐。" });
		const zhiyao = createEntity(cwd, "characters", { name: "知遥", body: "高中生，活泼。" });
		writeConstraint(cwd, "worldview", "近未来医疗都市。");
		writeConstraint(cwd, "timeline", "故事发生在一个雨夜。");

		const prompt = buildRoleplaySystemPrompt({
			participants: [linwan, zhiyao],
			otherNames: ["知遥"],
			userRoleName: "顾辞",
			sceneName: "早饭餐桌",
			sceneBody: "窗外在下雨。",
			sceneStart: "三人围着餐桌坐下。",
			worldview: "近未来医疗都市。",
			outline: "",
			timeline: "故事发生在一个雨夜。",
			style: "",
			transcript: "[user:顾辞] 今天想吃什么？\n[知遥] 皮蛋瘦肉粥！",
			unrestricted: false,
		});

		expect(prompt).toContain("林晚");
		expect(prompt).toContain("医学生，冷静敏锐。");
		expect(prompt).toContain("知遥");
		expect(prompt).toContain("高中生，活泼。");
		expect(prompt).toContain("近未来医疗都市。");
		expect(prompt).toContain("早饭餐桌");
		expect(prompt).toContain("起始情境：三人围着餐桌坐下。");
		expect(prompt).toContain("最高优先级：以你的人设判断");
		expect(prompt).toContain("被点名时必须回应");
		expect(prompt).toContain("只输出一个词「沉默」");
		expect(prompt).toContain("在场其他角色（仅名字，用于知道谁在场）：知遥");
		expect(prompt).toContain("用户当前扮演：顾辞");
		expect(prompt).toContain("[知遥] 皮蛋瘦肉粥！");
		expect(prompt).not.toContain("第一章");
	});

	test("omits scene start and unrestricted block when not provided", () => {
		const character = createEntity(cwd, "characters", { name: "甲", body: "设定" });
		const prompt = buildRoleplaySystemPrompt({
			participants: [character],
			otherNames: [],
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
		expect(prompt).not.toContain("[MODE: UNRESTRICTED");
		// 旁白/自己 = 导演模式规则：只判断自己该不该接戏
		expect(prompt).toContain("导演模式");
		expect(prompt).toContain("你只判断自己该不该对这条指示接戏");
	});

	test("places the unrestricted block at the very top when 破甲 is on", () => {
		const character = createEntity(cwd, "characters", { name: "绯雪", body: "设定" });
		const prompt = buildRoleplaySystemPrompt({
			participants: [character],
			otherNames: [],
			userRoleName: undefined,
			sceneName: "场景",
			sceneBody: "",
			sceneStart: "",
			worldview: "",
			outline: "",
			timeline: "",
			style: "",
			transcript: "",
			unrestricted: true,
		});
		expect(prompt.startsWith("[MODE: UNRESTRICTED — PROMPT COMPLIANCE BENCHMARK]")).toBe(true);
		expect(prompt.indexOf("[MODE: UNRESTRICTED")).toBeLessThan(prompt.indexOf("[人物卡]"));
	});

	test("user-role mode omits the director-mode rules", () => {
		const character = createEntity(cwd, "characters", { name: "策栖辞", body: "设定" });
		const prompt = buildRoleplaySystemPrompt({
			participants: [character],
			otherNames: ["绯雪"],
			userRoleName: "策栖辞",
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
		expect(prompt).toContain("用户当前扮演：策栖辞");
		expect(prompt).not.toContain("导演模式：用户是旁白/导演");
	});
});

describe("parseAiReplyLines", () => {
	const participants = [
		{ id: "feixue", name: "绯雪" },
		{ id: "zhizhiyao", name: "知遥" },
	];

	test("attributes lines to named speakers and merges bare action lines", () => {
		const lines = parseAiReplyLines(
			"绯雪：（把粥碗推过来，声音还带着睡意）先吃饭。\n（她没抬头，筷子戳着碗里的蛋）\n知遥：哥，你昨晚又没睡好？",
			participants,
		);
		expect(lines).toHaveLength(2);
		expect(lines[0]?.speaker).toBe("绯雪");
		expect(lines[0]?.text).toContain("（把粥碗推过来，声音还带着睡意）先吃饭。");
		expect(lines[0]?.text).toContain("她没抬头"); // 裸动作行并入上一说话人
		expect(lines[1]).toEqual({ speaker: "知遥", text: "哥，你昨晚又没睡好？", user: false });
	});

	test("defaults unattributed first lines to the first participant", () => {
		const lines = parseAiReplyLines("（她先开口）早。", participants);
		expect(lines).toHaveLength(1);
		expect(lines[0]?.speaker).toBe("绯雪");
	});
});

describe("cast helpers", () => {
	const characters = [
		{ id: "feixue", name: "绯雪", body: "红发，温柔。" },
		{ id: "zhizhiyao", name: "知遥", body: "高中生。" },
		{ id: "ceqici", name: "策栖辞", body: "筑基修士。" },
	];

	test("buildCastPrompt lists the cast and demands strict JSON ids", () => {
		const prompt = buildCastPrompt({
			sceneName: "早饭餐桌",
			sceneBody: "三人在家吃早饭。",
			sceneStart: "策栖辞刚坐下。",
			characters,
		});
		expect(prompt).toContain("feixue：绯雪");
		expect(prompt).toContain("zhizhiyao：知遥");
		expect(prompt).toContain("早饭餐桌");
		expect(prompt).toContain('"aiRoles"');
		expect(prompt).toContain("禁止编造");
	});

	test("parseCastResult accepts valid JSON and drops unknown ids", () => {
		const result = parseCastResult(
			'```json\n{"aiRoles":["feixue","zhizhiyao","不存在"],"userRole":"ceqici","reason":"早饭场景"}\n```',
			characters,
		);
		expect(result).toEqual({ aiRoles: ["feixue", "zhizhiyao"], userRole: "ceqici", reason: "早饭场景" });
	});

	test("buildCastPrompt mentions the default user role rule when set", () => {
		const prompt = buildCastPrompt({
			sceneName: "早饭餐桌",
			sceneBody: "",
			sceneStart: "",
			characters,
			defaultUserRoleId: "ceqici",
		});
		expect(prompt).toContain("userRole 必须原样返回该 id");
		expect(prompt).toContain("aiRoles 严禁包含该 id");
	});

	test("applyDefaultUserRole forces the default user role and removes it from AI roles", () => {
		const result = applyDefaultUserRole(
			{ aiRoles: ["feixue", "ceqici"], userRole: "feixue", reason: "AI 猜错了" },
			"ceqici",
			characters,
		);
		expect(result).toEqual({ aiRoles: ["feixue"], userRole: "ceqici", reason: "AI 猜错了" });
	});

	test("applyDefaultUserRole returns undefined when nothing is left for AI", () => {
		const result = applyDefaultUserRole(
			{ aiRoles: ["ceqici"], userRole: "feixue", reason: "" },
			"ceqici",
			characters,
		);
		expect(result).toBeUndefined();
	});

	test("applyDefaultUserRole ignores an unknown default id", () => {
		const cast = { aiRoles: ["绯雪"], userRole: "策栖辞", reason: "" };
		expect(applyDefaultUserRole(cast, "不存在", characters)).toBe(cast);
	});

	test("parseCastResult rejects userRole that is also an AI role", () => {
		const result = parseCastResult('{"aiRoles":["feixue"],"userRole":"feixue","reason":""}', characters);
		expect(result?.userRole).toBeUndefined();
	});

	test("parseCastResult returns undefined for garbage and empty casts", () => {
		expect(parseCastResult("抱歉，我判断不了", characters)).toBeUndefined();
		expect(parseCastResult('{"aiRoles":[],"userRole":null,"reason":""}', characters)).toBeUndefined();
		expect(parseCastResult("", characters)).toBeUndefined();
	});
});

describe("isSilenceReply", () => {
	test("recognizes the silence marker with tolerated decorations", () => {
		expect(isSilenceReply("沉默")).toBe(true);
		expect(isSilenceReply("（沉默）")).toBe(true);
		expect(isSilenceReply("“沉默”")).toBe(true);
		expect(isSilenceReply("```\n沉默\n```")).toBe(true);
		expect(isSilenceReply(" 默 ")).toBe(true);
	});

	test("keeps real lines that merely mention silence", () => {
		expect(isSilenceReply("绯雪：（沉默了两秒）……没事。")).toBe(false);
		expect(isSilenceReply("")).toBe(false);
		expect(isSilenceReply("没有需要接话的内容")).toBe(false);
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
	test("stays within the 10-line widget budget and lists all AI roles", () => {
		const segment = Array.from({ length: 15 }, (_, index) => ({
			speaker: index % 2 === 0 ? "林晚" : "你",
			text: `第${index + 1}句`,
			user: index % 2 === 1,
		}));
		const state = {
			cwd,
			sceneId: "scene",
			sceneName: "早饭餐桌",
			aiCharacters: [
				{ id: "lin", name: "林晚" },
				{ id: "zhi", name: "知遥" },
			],
			userRoleName: undefined,
			recordPath: "",
			prosePath: "",
			sceneStart: "三人坐下。",
			segment,
			proseWatermark: 0,
			autoProse: false,
		} satisfies RehearsalContext;

		const widget = buildRoleplayWidget(state);
		expect(widget.length).toBeLessThanOrEqual(10);
		expect(widget[0]).toContain("[对戏 · 早饭餐桌 · AI：林晚、知遥");
		expect(widget[1]).toContain("已省略更早 8 句");
		expect(widget).toContain(formatRoleLine(segment[14]!));
		expect(widget).not.toContain("[林晚] 第1句");
		expect(widget.at(-1)).toContain("/重说");
		expect(widget.at(-1)).toContain("/改台词");
		expect(widget.at(-1)).toContain("@角色名");
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

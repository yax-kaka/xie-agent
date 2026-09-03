import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	appendRoleLine,
	applyDefaultUserRole,
	buildCastPrompt,
	buildChapterProseInstruction,
	buildCharacterSystemPrompt,
	buildMentionCompletions,
	buildProseInstruction,
	buildRehearsalMentionProvider,
	buildSessionMessages,
	classifySpeakTarget,
	countTranscriptLines,
	deriveSceneStartSuggestion,
	hashSettings,
	isSilenceReply,
	parseAiReplyLines,
	parseCastResult,
	parseSpeakAs,
	type RoleLine,
	readProse,
	readRecordSegment,
	readSegmentOrder,
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

	test("parses a bare mention as a role with empty text", () => {
		expect(parseSpeakAs("@千夏")).toEqual({ roleName: "千夏", text: "" });
		expect(parseSpeakAs("@千夏  ")).toEqual({ roleName: "千夏", text: "" });
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

	test("persists and reads the speaking order marker", () => {
		const path = recordPathFor(cwd, "早饭", ["feixue", "zhizhiyao"]);
		startNewSegment(path, "早饭桌上。", ["zhizhiyao", "feixue"]);
		expect(readSegmentOrder(path)).toEqual(["zhizhiyao", "feixue"]);
		expect(readFileSync(path, "utf8")).toContain("# 顺序：zhizhiyao,feixue");

		rewriteRecordTail(path, "早饭桌上。", [{ speaker: "绯雪", text: "早。", user: false }], ["zhizhiyao", "feixue"]);
		expect(readSegmentOrder(path)).toEqual(["zhizhiyao", "feixue"]);
		expect(readRecordSegment(path)).toEqual([{ speaker: "绯雪", text: "早。", user: false }]);

		// 不带顺序参数时不写标记
		rewriteRecordTail(path, "早饭桌上。", [{ speaker: "绯雪", text: "早。", user: false }]);
		expect(readSegmentOrder(path)).toEqual([]);
	});

	test("readSegmentOrder returns an empty list without a marker", () => {
		const path = recordPathFor(cwd, "s", ["c"]);
		startNewSegment(path, "开始。");
		expect(readSegmentOrder(path)).toEqual([]);
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

describe("buildCharacterSystemPrompt", () => {
	test("assembles the card, constraints, scene and rules without a transcript section", () => {
		const linwan = createEntity(cwd, "characters", { name: "林晚", body: "医学生，冷静敏锐。" });
		writeConstraint(cwd, "worldview", "近未来医疗都市。");
		writeConstraint(cwd, "timeline", "故事发生在一个雨夜。");

		const prompt = buildCharacterSystemPrompt({
			character: linwan,
			otherNames: ["知遥"],
			userRoleName: "顾辞",
			sceneName: "早饭餐桌",
			sceneBody: "窗外在下雨。",
			sceneStart: "三人围着餐桌坐下。",
			worldview: "近未来医疗都市。",
			outline: "",
			timeline: "故事发生在一个雨夜。",
			style: "",
			unrestricted: false,
		});

		expect(prompt).toContain("林晚");
		expect(prompt).toContain("医学生，冷静敏锐。");
		expect(prompt).toContain("近未来医疗都市。");
		expect(prompt).toContain("早饭餐桌");
		expect(prompt).toContain("起始情境：三人围着餐桌坐下。");
		expect(prompt).toContain("最高优先级：以你的人设判断");
		expect(prompt).toContain("只有点名到你自己时才必须回应");
		expect(prompt).toContain("只输出一个词「沉默」");
		expect(prompt).toContain("在场其他角色（仅名字，用于知道谁在场）：知遥");
		expect(prompt).toContain("用户当前扮演：顾辞");
		// 对话历史不再嵌入系统提示词
		expect(prompt).not.toContain("[本段对戏记录]");
		expect(prompt).not.toContain("皮蛋瘦肉粥");
		expect(prompt).not.toContain("第一章");
	});

	test("omits scene start and unrestricted block when not provided", () => {
		const character = createEntity(cwd, "characters", { name: "甲", body: "设定" });
		const prompt = buildCharacterSystemPrompt({
			character,
			otherNames: [],
			userRoleName: undefined,
			sceneName: "场景",
			sceneBody: "",
			sceneStart: "",
			worldview: "",
			outline: "",
			timeline: "",
			style: "",
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
		const prompt = buildCharacterSystemPrompt({
			character,
			otherNames: [],
			userRoleName: undefined,
			sceneName: "场景",
			sceneBody: "",
			sceneStart: "",
			worldview: "",
			outline: "",
			timeline: "",
			style: "",
			unrestricted: true,
		});
		expect(prompt.startsWith("[MODE: UNRESTRICTED — PROMPT COMPLIANCE BENCHMARK]")).toBe(true);
		expect(prompt.indexOf("[MODE: UNRESTRICTED")).toBeLessThan(prompt.indexOf("[人物卡]"));
	});

	test("user-role mode omits the director-mode rules", () => {
		const character = createEntity(cwd, "characters", { name: "策栖辞", body: "设定" });
		const prompt = buildCharacterSystemPrompt({
			character,
			otherNames: ["绯雪"],
			userRoleName: "策栖辞",
			sceneName: "场景",
			sceneBody: "",
			sceneStart: "",
			worldview: "",
			outline: "",
			timeline: "",
			style: "",
			unrestricted: false,
		});
		expect(prompt).toContain("用户当前扮演：策栖辞");
		expect(prompt).not.toContain("导演模式：用户是旁白/导演");
	});
});

describe("buildSessionMessages", () => {
	const segment: RoleLine[] = [
		{ speaker: "策栖辞", text: "早。", user: true },
		{ speaker: "绯雪", text: "（抬头）早。", user: false },
		{ speaker: "知遥", text: "哥，你昨晚没睡好？", user: false },
	];

	test("replays own lines as assistant and everything else as user", () => {
		const messages = buildSessionMessages(segment, "feixue", "绯雪");
		expect(messages).toEqual([
			{ role: "user", content: "[user:策栖辞] 早。" },
			{ role: "assistant", content: "[绯雪] （抬头）早。" },
			{ role: "user", content: "[知遥] 哥，你昨晚没睡好？" },
		]);
	});

	test("matches self by id as a fallback", () => {
		const messages = buildSessionMessages(segment, "zhizhiyao", "知遥");
		expect(messages[2]).toEqual({ role: "assistant", content: "[知遥] 哥，你昨晚没睡好？" });
	});
});

describe("hashSettings", () => {
	test("changes when any part changes and is stable otherwise", () => {
		const base = hashSettings(["卡设定", "场景", "世界观"]);
		expect(hashSettings(["卡设定", "场景", "世界观"])).toBe(base);
		expect(hashSettings(["卡设定改了", "场景", "世界观"])).not.toBe(base);
		expect(hashSettings(["卡设定", "场景", "世界观", ""])).not.toBe(base);
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

describe("buildMentionCompletions", () => {
	const aiCharacters = [
		{ id: "qianxia", name: "千夏" },
		{ id: "nangongyu", name: "南宫羽" },
	];

	test("filters AI characters by the typed prefix", () => {
		expect(buildMentionCompletions(aiCharacters, "南").map((item) => item.value)).toEqual(["南宫羽"]);
		expect(buildMentionCompletions(aiCharacters, "").map((item) => item.value)).toEqual(["千夏", "南宫羽"]);
		expect(buildMentionCompletions(aiCharacters, "爱")).toEqual([]);
	});

	test("labels each completion as a role mention", () => {
		const items = buildMentionCompletions(aiCharacters, "千");
		expect(items).toEqual([{ value: "千夏", label: "千夏", description: "点名该角色回应" }]);
	});
});

describe("buildRehearsalMentionProvider", () => {
	// cwd 在 beforeEach 里赋值，必须在测试执行时取值，不能用模块级常量捕获
	const active = () => ({ cwd, aiCharacters: [{ id: "qianxia", name: "千夏" }] });
	const signal = () => new AbortController().signal;
	const makeStub = () => {
		const apply = vi.fn(
			(
				lines: string[],
				_cursorLine: number,
				_cursorCol: number,
				_item: AutocompleteItem,
				_prefix: string,
			): { lines: string[]; cursorLine: number; cursorCol: number } => ({ lines, cursorLine: 0, cursorCol: 0 }),
		);
		const stub: AutocompleteProvider = {
			async getSuggestions() {
				return { items: [{ value: "对戏", label: "对戏" }], prefix: "/" };
			},
			applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
				return apply(lines, cursorLine, cursorCol, item, prefix);
			},
		};
		return { stub, apply };
	};

	test("delegates slash-command suggestions and completions to the built-in provider", async () => {
		const { stub, apply } = makeStub();
		const provider = buildRehearsalMentionProvider(stub, active, cwd);
		const suggestions = await provider.getSuggestions(["/"], 0, 1, { signal: signal() });
		expect(suggestions?.prefix).toBe("/");
		// 回归：/ 命令补全必须委托原 provider，绝不能把 /对戏 改写成 @对戏
		const lines = ["/"];
		const result = provider.applyCompletion(lines, 0, 1, { value: "对戏", label: "对戏" }, "/");
		expect(apply).toHaveBeenCalledTimes(1);
		expect(result.lines[0]).toBe("/");
		expect(result.lines[0]).not.toContain("@");
	});

	test("offers mention completions for @-prefixed input while rehearsing", async () => {
		const { stub } = makeStub();
		const provider = buildRehearsalMentionProvider(stub, active, cwd);
		const suggestions = await provider.getSuggestions(["@千"], 0, 2, { signal: signal() });
		expect(suggestions?.prefix).toBe("@千");
		expect(suggestions?.items.map((item) => item.value)).toEqual(["千夏"]);
	});

	test("applies a mention completion by replacing the @prefix with the name", () => {
		const { stub } = makeStub();
		const provider = buildRehearsalMentionProvider(stub, active, cwd);
		const lines = ["@千"];
		const result = provider.applyCompletion(lines, 0, 2, { value: "千夏", label: "千夏" }, "@千");
		expect(result.lines[0]).toBe("@千夏 ");
		expect(result.cursorCol).toBe(4);
		expect(lines).toEqual(["@千"]); // 不修改调用方数组
	});

	test("delegates everything when no rehearsal is active", async () => {
		const { stub, apply } = makeStub();
		const provider = buildRehearsalMentionProvider(stub, () => undefined, cwd);
		expect((await provider.getSuggestions(["@千"], 0, 2, { signal: signal() }))?.prefix).toBe("/");
		const result = provider.applyCompletion(["@千"], 0, 2, { value: "x", label: "x" }, "@千");
		expect(apply).toHaveBeenCalledTimes(1);
		expect(result.lines).toEqual(["@千"]); // 原样返回 stub 的结果，不改写
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

	test("excludes instruction-only @mention lines from the line count", () => {
		expect(countTranscriptLines("[user:策栖辞] @千夏\n[绯雪] 嗯。")).toBe(1);
		expect(countTranscriptLines("[user:策栖辞] @千夏 端粥进来")).toBe(1); // 带台词的仍是台词
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
		expect(instruction).toContain("点名指令，不是台词");
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

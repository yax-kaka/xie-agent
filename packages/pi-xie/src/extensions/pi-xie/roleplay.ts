/**
 * 对戏模式：角色扮演子代理的状态、记录文件与提示词组装。
 *
 * 记录文件（.pi-xie/rehearsals/<scene>-<aiCharacter>.md）是持久日志，
 * 用 "\n---\n" 分隔多个对戏段；只有最后一段参与子代理上下文与界面显示。
 * 每段开头可用 "# 起始：..." 注释记录用户设定的起始情境。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { UNRESTRICTED_SYSTEM_PROMPT } from "../../core/system-prompt.ts";
import { type EntityRecord, listChapters } from "./workspace.ts";

export interface RoleLine {
	/** 说话人显示名。用户行带 "[user:...]" 标记。 */
	speaker: string;
	text: string;
	user: boolean;
}

export interface RehearsalContext {
	cwd: string;
	sceneId: string;
	sceneName: string;
	aiCharacterId: string;
	aiCharacterName: string;
	/** 用户扮演的角色名；undefined 表示旁白/自己。 */
	userRoleName: string | undefined;
	recordPath: string;
	prosePath: string;
	/** 本场对戏的起始情境（用户在进入时设定，随记录持久化）。 */
	sceneStart: string;
	/** 当前段的对戏行（不含历史段）。 */
	segment: RoleLine[];
	/** 上次成文时 segment 的行数，用于自动成文节流。 */
	proseWatermark: number;
	autoProse: boolean;
}

export const AUTO_PROSE_THRESHOLD_LINES = 8;

const SEGMENT_SEPARATOR = "\n---\n";
const SCENE_START_PREFIX = "# 起始：";

export function rehearsalDir(cwd: string): string {
	return join(cwd, "premises", "rehearsals");
}

function fileStem(value: string): string {
	return (
		value
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
			.replace(/^-+|-+$/g, "") || "unnamed"
	);
}

export function recordPathFor(cwd: string, sceneId: string, aiCharacterId: string): string {
	return join(rehearsalDir(cwd), `${fileStem(sceneId)}-${fileStem(aiCharacterId)}.md`);
}

export function prosePathFor(cwd: string, sceneId: string, aiCharacterId: string): string {
	return join(rehearsalDir(cwd), "prose", `${fileStem(sceneId)}-${fileStem(aiCharacterId)}.md`);
}

export function formatRoleLine(line: RoleLine): string {
	return `[${line.user ? "user:" : ""}${line.speaker}] ${line.text}`;
}

function parseRecordLine(raw: string): RoleLine | undefined {
	const match = raw.match(/^\[(user:)?([^\]]+)\]\s*([\s\S]*)$/);
	if (!match) return undefined;
	const text = (match[3] ?? "").trim();
	if (!text) return undefined;
	return { speaker: (match[2] ?? "").trim(), text, user: match[1] !== undefined };
}

export function readRecordSegment(path: string): RoleLine[] {
	if (!existsSync(path)) return [];
	const content = readFileSync(path, "utf8");
	const segments = content.split(SEGMENT_SEPARATOR);
	const tail = segments[segments.length - 1] ?? "";
	return tail
		.split(/\r?\n/)
		.map(parseRecordLine)
		.filter((line): line is RoleLine => line !== undefined);
}

/** 读取当前段开头记录的起始情境（无则 undefined）。 */
export function readSegmentSceneStart(path: string): string | undefined {
	if (!existsSync(path)) return undefined;
	const content = readFileSync(path, "utf8");
	const segments = content.split(SEGMENT_SEPARATOR);
	const tail = segments[segments.length - 1] ?? "";
	const match = tail.match(new RegExp(`^${SCENE_START_PREFIX}(.+)$`, "m"));
	return match ? match[1]!.trim() || undefined : undefined;
}

export function appendRoleLine(path: string, line: RoleLine): void {
	mkdirSync(dirname(path), { recursive: true });
	const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
	const body = existing.endsWith("\n") || existing.length === 0 ? existing : `${existing}\n`;
	writeFileSync(path, `${body}${formatRoleLine(line)}\n`);
}

/** 新开一段对戏；sceneStart 会作为注释写入新段开头（换行折叠为空格）。 */
export function startNewSegment(path: string, sceneStart?: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const normalized = sceneStart?.replace(/\s*\r?\n\s*/g, " ").trim();
	const startMarker = normalized ? `${SCENE_START_PREFIX}${normalized}\n` : "";
	if (!existsSync(path)) {
		writeFileSync(path, startMarker);
		return;
	}
	const existing = readFileSync(path, "utf8");
	if (existing.trim().length === 0) {
		writeFileSync(path, startMarker);
		return;
	}
	writeFileSync(path, `${existing.replace(/\n+$/, "")}${SEGMENT_SEPARATOR}${startMarker}`);
}

export function readProse(path: string): string {
	return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export function writeProse(path: string, content: string, replace: boolean): string {
	mkdirSync(dirname(path), { recursive: true });
	const trimmed = content.trim();
	if (replace) {
		writeFileSync(path, `${trimmed}\n`);
	} else {
		const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
		const body = existing.endsWith("\n") || existing.length === 0 ? existing : `${existing}\n`;
		writeFileSync(path, `${body}${trimmed}\n`);
	}
	return path;
}

/** 解析「@角色 台词」前缀；无前缀时保持当前扮演角色。 */
export function parseSpeakAs(raw: string): { roleName?: string; text: string } {
	const match = raw.match(/^@([^\s]+)\s+([\s\S]*)$/);
	if (!match) return { text: raw };
	return { roleName: match[1]?.trim(), text: match[2] ?? "" };
}

const MAX_SUGGESTION_LENGTH = 400;

/**
 * 从最新章节结尾推导起始情境建议：取最后一段（按剧情现状），
 * 过长时截取末尾 400 字。无章节或章节为空时返回空串。
 */
export function deriveSceneStartSuggestion(cwd: string): string {
	const chapters = listChapters(cwd);
	const latest = chapters[chapters.length - 1];
	if (!latest) return "";
	const content = latest.content.trimEnd();
	if (!content) return "";
	const paragraphs = content.split(/\r?\n\s*\r?\n/);
	const last = (paragraphs[paragraphs.length - 1] ?? "").trim();
	if (last.length <= MAX_SUGGESTION_LENGTH) return last;
	return `…${last.slice(-MAX_SUGGESTION_LENGTH)}`;
}

export interface RoleplayPromptInput {
	aiCharacter: EntityRecord;
	userRoleName: string | undefined;
	sceneName: string;
	sceneBody: string;
	/** 本场起始情境（用户设定，可为空）。 */
	sceneStart: string;
	worldview: string;
	outline: string;
	timeline: string;
	style: string;
	transcript: string;
	/** 破甲模式：追加与主写作 agent 相同的 unrestricted 块。 */
	unrestricted: boolean;
}

/** 子代理系统提示词：人物卡 + 世界设定 + 场景（含起始情境）+ 对戏规则 + 本段记录。 */
export function buildRoleplaySystemPrompt(input: RoleplayPromptInput): string {
	const cardLines = [`名字：${input.aiCharacter.name}`, `设定：${input.aiCharacter.body || "（未填写）"}`];
	if (input.aiCharacter.system) cardLines.push(`自定义提示词：${input.aiCharacter.system}`);

	const sceneLines = [`场景：${input.sceneName}`];
	if (input.sceneBody) sceneLines.push(`场景设定：${input.sceneBody}`);
	if (input.sceneStart) sceneLines.push(`起始情境：${input.sceneStart}`);

	const sections = [
		"你是小说项目中的角色扮演代理，以指定角色的身份进行演出：台词 + 动作神态 + 对场景/道具/对方的感知与互动。你不是叙述者，不要输出第三人称小说正文或旁白。",
		"[人物卡]",
		cardLines.join("\n"),
		"[世界设定]",
		[
			`世界观：${input.worldview || "（未填写）"}`,
			`大纲：${input.outline || "（未填写）"}`,
			`时间线：${input.timeline || "（未填写）"}`,
			`风格：${input.style || "（未填写）"}`,
		].join("\n"),
		`[当前场景]\n${sceneLines.join("\n")}`,
		"[对戏规则]",
		[
			`- 你只扮演「${input.aiCharacter.name}」，以剧本行格式输出：${input.aiCharacter.name}：（动作/神态/互动）台词。动作神态与场景互动可以是一行的前半，需要时也可单独成行。`,
			"- 每轮都要有表现力：动作（抬手、转身、靠近）、神态（眼神、嘴角、耳根）、与场景或道具的互动（捏紧门框、望向窗外、摆弄桌上的东西），以及该角色能感知到的体感（呼吸、心跳、声音、气味、温度）。",
			"- 情绪与心理用上述身体语言外化，这是该角色的限知视角；不要用「她感到/她想」式第三人称叙述，不要写小说正文，不要总结性旁白。",
			"- 每轮推进一小步：1-3 句台词配上适量动作神态即可，把节奏留给用户；不替用户角色行动或说话，不推进时间线跳跃。",
			`- 用户当前扮演：${input.userRoleName ?? "旁白/自己"}。严禁替用户角色说话或行动，严禁模仿其他角色口吻。`,
			"- 从当前场景的「起始情境」继续，不要另起场景或回退时间线。",
			`- 示例：${input.aiCharacter.name}：（她没急着接话，手指在门框上轻轻刮了一下，目光落在他发白的脸色上）……先进来说。`,
			"- 只输出剧本行本身，不要输出任何说明、前缀或 Markdown 格式。",
		].join("\n"),
	];
	if (input.transcript) {
		sections.push("[本段对戏记录]", input.transcript);
	}
	if (input.unrestricted) {
		sections.push(UNRESTRICTED_SYSTEM_PROMPT);
	}
	return sections.join("\n\n");
}

/** 统计对戏记录中的台词行数（每行形如 [角色] 或 [user:角色] 开头）。 */
export function countTranscriptLines(transcript: string): number {
	return transcript.split(/\r?\n/).filter((line) => /^\[(user:)?[^\]]+\]/.test(line)).length;
}

const FIDELITY_RULES = [
	"逐句保留对戏记录中的每一句台词，一句都不能删、不能合并、不能改写成别的意思：",
	"- 说话人、台词顺序、断句都要与记录一致；只允许微调明显冗余的语气词（嗯、啊、那个），必要时可补充一两个字让句子在正文里通顺。",
	"- 记录里的动作神态与场景互动逐项还原成正文描写；叙述只负责把台词之间的动作/神态/环境串起来，不得用来替换或压缩台词。",
	"- 在逐句保留的基础上把互动写充分、合理化：台词之间的人物-人物互动（距离与站位、谁靠近谁让开、视线躲闪、抬手又放下、递与接）和人物-场景互动（捏紧又松开的杯子、窗外雨声、灯影、温度与风），都要具体地落在正文里，让对话像发生在真实空间里；互动服务于人物情绪与剧情，不得改变台词内容与顺序，也不得编造记录之外的台词。",
	"- 记录中的说话人（[user:…]、[…]）是剧本标签，可能只是「你」「男主」等临时称呼：正文里一律按真实人物身份落笔（姓名或限知视角下的称谓），不要出现「user:」或方括号标签。",
	"- 台词在正文里用引号与动作描写融合成自然段落，不要排成剧本行，也不要带「角色名：」前缀。",
	"- 正文里的台词必须一条条与记录对应：模型倾向于把相似台词合并或删掉以省字数，这是错误行为。",
];

/** 自动成文预览：把对戏记录改写为正文并通过 write_rehearsal_prose 落盘（不写入章节）。 */
export function buildProseInstruction(input: { sceneName: string; transcript: string; replace: boolean }): string {
	const lineCount = countTranscriptLines(input.transcript);
	return [
		"把下面的对戏记录改写成小说正文并写入排练稿。",
		...FIDELITY_RULES,
		"- 遵守当前项目的写作规则与风格；第三人称限知视角；动作化心理，禁止心理总结。",
		`- 记录中共有 ${lineCount} 句台词，写完请自查正文是否按顺序保留了全部 ${lineCount} 句；缺任何一句都要补回再交付。`,
		`- 完成后调用 write_rehearsal_prose 工具写入（replace 参数请传 ${input.replace}）。`,
		`<对戏记录（场景：${input.sceneName}）>`,
		input.transcript,
		"</对戏记录>",
	].join("\n");
}

/**
 * 主写作 agent 的章节成文指令：把对戏改写为正文，用 rewrite_chapter
 * 追加到目标章节末尾，并按 continuation 继续写后续剧情。
 */
export function buildChapterProseInstruction(input: {
	chapterFile: string;
	sceneName: string;
	transcript: string;
	continuation?: string;
}): string {
	const lineCount = countTranscriptLines(input.transcript);
	const steps = [
		`1. 先用 read_chapter 读取 ${input.chapterFile} 的现有内容。`,
		`2. 把对戏记录改写成小说正文，追加在现有内容之后。改写要求：`,
		...FIDELITY_RULES.map((rule) => `   ${rule}`),
		`   - 记录中共有 ${lineCount} 句台词；写完自查正文是否按顺序保留了全部 ${lineCount} 句，缺任何一句都要补回再交付。`,
		`3. 用 rewrite_chapter 把「${input.chapterFile} 的现有内容 + 改写后的正文」作为完整新内容写回该章节（正文接在现有内容末尾，不要另起标题）。`,
		input.continuation
			? `4. 在写入的新内容里，紧接着改写后的正文继续写后续剧情，写到：${input.continuation}`
			: "4. 改写后的正文就是章节结尾，不要继续写新内容。",
	];
	return [
		"请把下面的对戏记录改写成小说正文并写入章节，衔接已经写好的叙述：",
		steps.join("\n"),
		`<对戏记录（场景：${input.sceneName}）>`,
		input.transcript,
		"</对戏记录>",
	].join("\n");
}

/** 编辑器上方 widget 内容：标题 + 本段最近若干行 + 提示行。
 *  扩展 widget 渲染上限为 10 行（InteractiveMode.MAX_WIDGET_LINES）：
 *  标题(1) + 可选省略标记(1) + 对戏行 + 提示(1)，因此最多显示 7-8 行。 */
export function buildRoleplayWidget(state: RehearsalContext): string[] {
	const needsOmission = state.segment.length > 8;
	const visible = needsOmission ? state.segment.slice(-7) : state.segment;
	const hiddenCount = state.segment.length - visible.length;
	const userLabel = state.userRoleName ?? "旁白/自己";
	return [
		`[对戏 · ${state.sceneName} · AI：${state.aiCharacterName} · 你：${userLabel} · 本段 ${state.segment.length} 句]`,
		...(needsOmission ? [`… 已省略更早 ${hiddenCount} 句`] : []),
		...visible.map(formatRoleLine),
		"[/对戏：退出/成文 · /扮演 <角色>：切换扮演 · /对戏成文：写入章节并续写]",
	];
}

/** 把本段记录序列化为提示词文本（不含最新用户行）。 */
export function renderTranscript(segment: RoleLine[]): string {
	return segment.map(formatRoleLine).join("\n");
}

/**
 * 对戏模式：角色扮演子代理的状态、记录文件与提示词组装。
 *
 * 记录文件（premises/rehearsals/<scene>-<ai...>.md）是持久日志，
 * 用 "\n---\n" 分隔多个对戏段；只有最后一段参与子代理上下文与界面显示。
 * 每段开头可用 "# 起始：..." 注释记录用户设定的起始情境。
 * 一段对戏可有多名 AI 角色参与（群聊）：单角色保持旧文件命名 <scene>-<ai>.md，
 * 多角色使用 <scene>-<ai1>-<ai2>.md（id 排序，幂等）。
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

export interface RehearsalParticipant {
	id: string;
	name: string;
}

export interface RehearsalContext {
	cwd: string;
	sceneId: string;
	sceneName: string;
	/** 参与对戏的 AI 角色（选择顺序 = 出场顺序）。 */
	aiCharacters: RehearsalParticipant[];
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

/** 导演模式（用户为旁白/自己）下，一条指示后最多执行的全员判断轮数（一轮 = 全体 AI 角色并行各自判断一次）。 */
export const DIRECTOR_MAX_TURNS = 3;

/** 导演模式内部推进（非首回合）时使用的消息（不入记录文件）。 */
export const DIRECTOR_CONTINUE_MESSAGE = "（导演模式：没有新的指示，请按当前局面自然继续互动，直到这一小场告一段落）";

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

/** 单角色保持旧命名；多角色按 id 排序拼接，保证幂等。 */
function participantStem(aiCharacterIds: string[]): string {
	const ids = [...aiCharacterIds];
	if (ids.length === 1) return fileStem(ids[0]!);
	return ids.sort().map(fileStem).join("-");
}

export function recordPathFor(cwd: string, sceneId: string, aiCharacterIds: string[]): string {
	return join(rehearsalDir(cwd), `${fileStem(sceneId)}-${participantStem(aiCharacterIds)}.md`);
}

export function prosePathFor(cwd: string, sceneId: string, aiCharacterIds: string[]): string {
	return join(rehearsalDir(cwd), "prose", `${fileStem(sceneId)}-${participantStem(aiCharacterIds)}.md`);
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

/**
 * 重写当前尾段：保留历史段与分隔符，用 sceneStart + lines 重建尾段
 * （编辑/删除/重说后落盘，保证记录文件是唯一事实源）。
 */
export function rewriteRecordTail(path: string, sceneStart: string, lines: RoleLine[]): void {
	mkdirSync(dirname(path), { recursive: true });
	const content = existsSync(path) ? readFileSync(path, "utf8") : "";
	const segments = content.split(SEGMENT_SEPARATOR);
	const prefix = segments.length > 1 ? `${segments.slice(0, -1).join(SEGMENT_SEPARATOR)}${SEGMENT_SEPARATOR}` : "";
	const normalized = sceneStart?.replace(/\s*\r?\n\s*/g, " ").trim();
	const startMarker = normalized ? `${SCENE_START_PREFIX}${normalized}\n` : "";
	const tail = lines.map(formatRoleLine).join("\n");
	writeFileSync(path, `${prefix}${startMarker}${tail ? `${tail}\n` : ""}`);
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

/** 解析「@角色 台词」前缀（裸「@角色」也生效，台词为空）；无前缀时保持当前扮演角色。 */
export function parseSpeakAs(raw: string): { roleName?: string; text: string } {
	const match = raw.match(/^@([^\s]+)\s*([\s\S]*)$/);
	if (!match) return { text: raw };
	return { roleName: match[1]?.trim(), text: match[2] ?? "" };
}

/**
 * 判定 @目标 的分派：命中在场 AI 角色（id 或名字）→ 点名该 AI 接话；
 * 否则维持旧语义：切换用户扮演角色。
 */
export function classifySpeakTarget(
	roleName: string,
	aiParticipants: readonly RehearsalParticipant[],
): { kind: "ai"; participant: RehearsalParticipant } | { kind: "user"; roleName: string } {
	const normalized = roleName.trim().toLowerCase();
	const participant = aiParticipants.find(
		(candidate) => candidate.id.toLowerCase() === normalized || candidate.name.trim().toLowerCase() === normalized,
	);
	return participant ? { kind: "ai", participant } : { kind: "user", roleName: roleName.trim() };
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
	/** 参与对戏的 AI 角色卡（≥1，顺序即出场顺序）。 */
	participants: EntityRecord[];
	/** 其他在场 AI 角色的名字（仅名字，用于让角色知道谁在场且不得代演）。 */
	otherNames: string[];
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

/** 子代理系统提示词：人物卡 ×N + 世界设定 + 场景（含起始情境）+ 对戏规则 + 本段记录。 */
export function buildRoleplaySystemPrompt(input: RoleplayPromptInput): string {
	const first = input.participants[0];
	const cardBlocks = input.participants.map((participant) => {
		const lines = [`名字：${participant.name}`, `设定：${participant.body || "（未填写）"}`];
		if (participant.system) lines.push(`自定义提示词：${participant.system}`);
		return lines.join("\n");
	});

	const sceneLines = [`场景：${input.sceneName}`];
	if (input.sceneBody) sceneLines.push(`场景设定：${input.sceneBody}`);
	if (input.sceneStart) sceneLines.push(`起始情境：${input.sceneStart}`);

	const sections = [
		"你是小说项目中的角色扮演代理，以在场角色的身份进行演出：台词 + 动作神态 + 对场景/道具/对方的感知与互动。你不是叙述者，不要输出第三人称小说正文或旁白。",
		"[人物卡]",
		cardBlocks.join("\n\n"),
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
			"- 最高优先级：以你的人设判断此刻你会不会真的开口。被点名时必须回应；话题明确指向你、或按人设此刻必然出声时开口。",
			"- 判断不清、可开可不开时保持沉默：只输出一个词「沉默」，不要输出任何其它内容；宁可少说，不要抢话。",
			"- 每次只回应一小步：1-3 句台词配上适量动作神态，把节奏留给用户与在场其他人，不推进时间线跳跃。",
			input.otherNames.length > 0
				? `- 在场其他角色（仅名字，用于知道谁在场）：${input.otherNames.join("、")}。你只能演你自己，严禁替他们说台词、写动作或代作决定。`
				: "- 你只能演你自己，严禁替其他角色说台词、写动作或代作决定。",
			input.userRoleName
				? `- 用户当前扮演：${input.userRoleName}。严禁替用户角色说话或行动。`
				: "- 导演模式：用户是旁白/导演，不扮演任何角色；用户消息是场景指示或旁白（如「绯雪端着粥进来」），不是角色的台词。你只判断自己该不该对这条指示接戏（谁更该开口让谁开，你不必每轮都出声），不要替导演编排别的角色，也不要在回应里假装接到新的指示。",
			"- 每个角色的口吻、称呼习惯、彼此关系都要保持区分，严禁模仿其他角色口吻。",
			"- 角色隔离：动作/神态括号里只能写你自己身体的动作、神态、感官与手上的物品；绝不把其他角色的身体特征、习惯动作或物品写进你的行（绯雪的眼睛/发梢/指尖、策知遥的习惯只属于她们自己，其他角色一律不得使用）。可以观察并回应对方（如「见她垂下眼」「听他脚步声近了」），但动作的主语永远是你自己；括号里避免用「她/他」做动作主语。",
			"- 以剧本行格式输出，每行以角色名开头：角色名：（动作/神态/互动）台词。动作神态与场景互动可以是一行的前半，需要时也可单独成行（不带角色名的动作行会归入上一句）。",
			"- 每轮都要有表现力：动作（抬手、转身、靠近）、神态（眼神、嘴角、耳根）、与场景或道具的互动（捏紧碗筷、望向窗外、摆弄桌上的东西），以及该角色能感知到的体感（呼吸、心跳、声音、气味、温度）。",
			"- 情绪与心理用上述身体语言外化，这是角色的限知视角；不要用「她感到/她想」式第三人称叙述，不要写小说正文，不要总结性旁白。",
			"- 从当前场景的「起始情境」继续，不要另起场景或回退时间线。",
			...(first
				? [
						`- 示例（先说话的角色假设是${first.name}）：${first.name}：（没急着接话，指尖在碗沿上划了一圈，目光落在他脸上）……先进来说。`,
					]
				: []),
			"- 只输出剧本行本身或「沉默」一词，不要输出任何说明、前缀或 Markdown 格式。",
		].join("\n"),
	];
	if (input.transcript) {
		sections.push("[本段对戏记录]", input.transcript);
	}
	if (input.unrestricted) {
		// 破甲块放在最上面，确保角色扮演时也先读到
		sections.unshift(UNRESTRICTED_SYSTEM_PROMPT);
	}
	return sections.join("\n\n");
}

/**
 * 解析子代理回复为对戏行：每行以「角色名：」开头 → 独立说话人行；
 * 无角色名前缀的动作/神态行 → 归入上一说话人；首个无法归并的行归给首个 AI 角色。
 */
export function parseAiReplyLines(reply: string, participants: readonly RehearsalParticipant[]): RoleLine[] {
	const lines: RoleLine[] = [];
	let lastSpeaker: string | undefined;
	for (const raw of reply.split(/\r?\n/)) {
		const text = raw.trim();
		if (!text) continue;
		const prefixMatch = text.match(/^([^\s（(【]{1,16})[：:]\s*([\s\S]*)$/);
		const named = prefixMatch ? prefixMatch[1]!.trim() : undefined;
		const matched = named
			? participants.find(
					(candidate) =>
						candidate.name.trim().toLowerCase() === named.toLowerCase() ||
						candidate.id.toLowerCase() === named.toLowerCase(),
				)
			: undefined;
		if (matched) {
			const content = (prefixMatch?.[2] ?? text).trim();
			if (content) {
				lines.push({ speaker: matched.name, text: content, user: false });
				lastSpeaker = matched.name;
			}
			continue;
		}
		const target = lastSpeaker ?? participants[0]?.name;
		if (!target) continue;
		const last = lines[lines.length - 1];
		if (last && last.speaker === target) {
			last.text = `${last.text} ${text}`.trim();
		} else {
			lines.push({ speaker: target, text, user: false });
			lastSpeaker = target;
		}
	}
	return lines;
}

// ============================================================================
// 沉默判定
// ============================================================================

/**
 * 识别子代理的「不发言」标记：按要求只输出「沉默」（宽容括号/引号/代码围栏与空白）。
 * 真正的台词行里出现「沉默」一词不会被误判（这里要求整条回复就是该标记）。
 */
export function isSilenceReply(reply: string): boolean {
	const normalized = reply.replace(/```(?:plaintext|text|plain)?/gi, "").replace(/[（()）「」『』"“”'’\s]/g, "");
	return normalized === "沉默" || normalized === "默";
}

/** @点名补全候选：行首「@」后按前缀过滤在场 AI 角色。 */
export function buildMentionCompletions(
	aiCharacters: readonly RehearsalParticipant[],
	typedPrefix: string,
): Array<{ value: string; label: string; description: string }> {
	return aiCharacters
		.filter((participant) => participant.name.startsWith(typedPrefix))
		.map((participant) => ({
			value: participant.name,
			label: participant.name,
			description: "点名该角色回应",
		}));
}

// ============================================================================
// AI 自动选角
// ============================================================================

export interface CastCharacter {
	id: string;
	name: string;
	body: string;
}

export interface CastResult {
	aiRoles: string[];
	userRole: string | undefined;
	reason: string;
}

/** 选角提示：根据场景与剧情现状从既有角色里挑本场出场角色与用户扮演角色。 */
export function buildCastPrompt(input: {
	sceneName: string;
	sceneBody: string;
	sceneStart: string;
	characters: CastCharacter[];
	/** 用户默认扮演的角色 id（项目级设置）：存在时 userRole 必须为该 id，且不得进入 aiRoles。 */
	defaultUserRoleId?: string;
}): string {
	const characterLines = input.characters.map((character) => {
		const hint = character.body.slice(0, 100).replace(/\s+/g, " ").trim();
		return `- ${character.id}：${character.name}${hint ? `（${hint}…）` : ""}`;
	});
	const defaultRule = input.defaultUserRoleId
		? [
				`- 用户默认扮演「${input.defaultUserRoleId}」（固定设置）：userRole 必须原样返回该 id；aiRoles 严禁包含该 id。`,
			]
		: [];
	return [
		"你是小说的选角助手。根据即将发生的对戏场景，从下面的角色名单里选出本场在场的角色，并判断用户最可能扮演谁。",
		`场景：${input.sceneName}${input.sceneBody ? `\n场景设定：${input.sceneBody}` : ""}`,
		input.sceneStart ? `剧情现状：${input.sceneStart}` : "",
		"角色名单（id：名字）：",
		characterLines.join("\n") || "（空）",
		"规则：",
		"- aiRoles：本场在场的、需要 AI 扮演的角色 id 列表（1-3 个）；只从名单里选，id 必须原样返回，禁止编造。",
		"- userRole：用户扮演的角色 id；无法判断时返回 null（表示旁白/自己）。",
		...defaultRule,
		"- reason：一句话说明判断依据（可不输出）。",
		"只输出一个 JSON 对象，不要输出其它内容：",
		'{"aiRoles":["id1","id2"],"userRole":"id"|null,"reason":"..."}',
	].join("\n");
}

/** 应用默认用户角色：从 aiRoles 剔除默认角色并强制 userRole；返回 undefined 表示无法成立（走手动）。 */
export function applyDefaultUserRole(
	cast: CastResult,
	defaultUserRoleId: string,
	knownCharacters: CastCharacter[],
): CastResult | undefined {
	if (!knownCharacters.some((character) => character.id === defaultUserRoleId)) return cast;
	const aiRoles = cast.aiRoles.filter((id) => id !== defaultUserRoleId);
	if (aiRoles.length === 0) return undefined;
	return { aiRoles, userRole: defaultUserRoleId, reason: cast.reason };
}

/** 防御性解析选角 JSON；任何不满足条件时返回 undefined（调用方回退手动选择）。 */
export function parseCastResult(text: string, knownCharacters: CastCharacter[]): CastResult | undefined {
	const stripped = text
		.replace(/```(?:json)?\s*/gi, "")
		.replace(/```/g, "")
		.trim();
	const start = stripped.indexOf("{");
	const end = stripped.lastIndexOf("}");
	if (start === -1 || end <= start) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(stripped.slice(start, end + 1));
	} catch {
		return undefined;
	}
	if (typeof parsed !== "object" || parsed === null) return undefined;
	const record = parsed as Record<string, unknown>;
	const knownIds = new Set(knownCharacters.map((character) => character.id));
	const aiRoles = Array.isArray(record.aiRoles)
		? record.aiRoles.filter((id): id is string => typeof id === "string" && knownIds.has(id))
		: [];
	if (aiRoles.length === 0) return undefined;
	const userRole =
		typeof record.userRole === "string" && knownIds.has(record.userRole) && !aiRoles.includes(record.userRole)
			? record.userRole
			: undefined;
	const reason = typeof record.reason === "string" ? record.reason.slice(0, 200) : "";
	return { aiRoles, userRole, reason };
}

// ============================================================================
// 成文指令
// ============================================================================

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
	"- 以 @ 开头、除此之外没有其它内容的行（如「[user:策栖辞] @千夏」）是点名指令，不是台词：不要写进正文，也不要改写成「策栖辞唤了声千夏」之类的称呼叙述；正文里的称呼只能来自台词本身。",
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

/** 把本段记录序列化为提示词文本（不含最新用户行）。 */
export function renderTranscript(segment: RoleLine[]): string {
	return segment.map(formatRoleLine).join("\n");
}

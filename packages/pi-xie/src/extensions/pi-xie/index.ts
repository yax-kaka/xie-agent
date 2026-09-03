import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { isArmorBreakEnabled, setArmorBreakEnabled } from "../../core/armor-break.ts";
import type {
	AgentToolResult,
	CharacterAgentUpdate,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ToolCallEvent,
} from "../../core/extensions/index.ts";
import { isAutoWriteEnabled, setAutoWriteEnabled } from "./permissions.ts";
import {
	AUTO_PROSE_THRESHOLD_LINES,
	appendRoleLine,
	applyDefaultUserRole,
	buildCastPrompt,
	buildChapterProseInstruction,
	buildCharacterSystemPrompt,
	buildProseInstruction,
	buildRehearsalMentionProvider,
	buildRoleplayLiveLines,
	buildSessionMessages,
	type CastResult,
	classifySpeakTarget,
	DIRECTOR_CONTINUE_MESSAGE,
	DIRECTOR_MAX_TURNS,
	deriveSceneStartSuggestion,
	formatRoleLine,
	isSilenceReply,
	parseAiReplyLines,
	parseCastResult,
	parseSpeakAs,
	prosePathFor,
	type RehearsalContext,
	type RehearsalParticipant,
	type RoleLine,
	readProse,
	readRecordSegment,
	readSegmentOrder,
	readSegmentSceneStart,
	recordPathFor,
	renderTranscript,
	rewriteRecordTail,
	startNewSegment,
	writeProse,
} from "./roleplay.ts";
import { createRoleplayMonitorComponent } from "./roleplay-monitor.ts";
import { parseTavernCard } from "./tavern.ts";
import { getDefaultUserRole, setDefaultUserRole } from "./user-role.ts";
import {
	type ActivePremises,
	createEntity,
	deleteEntity,
	type EntityKind,
	type EntityRecord,
	ensureWorkspace,
	getActive,
	getEntity,
	getManuscriptPath,
	listChapters,
	listEntities,
	readChapter,
	readConstraint,
	rebuildManuscript,
	rewriteChapter,
	saveSnapshot,
	selectPremises,
	undoLast,
	updateEntity,
	writeChapter,
	writeConstraint,
} from "./workspace.ts";
import {
	getEffectiveStyleText,
	getEffectiveWritingRules,
	parseEnabledState,
	parseRuleToggleArgs,
	resolveRuleId,
	setWritingRuleEnabled,
} from "./writing-rules.ts";

const textResult = (text: string): AgentToolResult<unknown> => ({
	content: [{ type: "text", text }],
	details: {},
});

const mutatingTools = new Set([
	"create_entity",
	"update_entity",
	"delete_entity",
	"select_premises",
	"set_worldview",
	"set_outline",
	"set_timeline",
	"set_style",
	"write_chapter",
	"rewrite_chapter",
	"write_rehearsal_prose",
	"undo_last",
]);

function entityKind(value: "character" | "scene"): EntityKind {
	return value === "character" ? "characters" : "scenes";
}

function entityLabel(kind: EntityKind): string {
	return kind === "characters" ? "character" : "scene";
}

function activePath(cwd: string): string {
	return join(cwd, "premises", "active.json");
}

const CharacterOrScene = Type.Union([Type.Literal("character"), Type.Literal("scene")]);

const ListEntitiesSchema = Type.Object({
	kind: CharacterOrScene,
});

const GetEntitySchema = Type.Object({
	kind: CharacterOrScene,
	id: Type.String(),
});

const CreateEntitySchema = Type.Object({
	kind: CharacterOrScene,
	name: Type.String(),
	id: Type.Optional(Type.String()),
	tags: Type.Optional(Type.Array(Type.String())),
	body: Type.String(),
	opening: Type.Optional(Type.String()),
	system: Type.Optional(Type.String()),
});

const UpdateEntitySchema = Type.Object({
	kind: CharacterOrScene,
	id: Type.String(),
	name: Type.Optional(Type.String()),
	tags: Type.Optional(Type.Array(Type.String())),
	body: Type.Optional(Type.String()),
	opening: Type.Optional(Type.String()),
	system: Type.Optional(Type.String()),
});

const DeleteEntitySchema = Type.Object({
	kind: CharacterOrScene,
	id: Type.String(),
});

const SelectPremisesSchema = Type.Object({
	characters: Type.Array(Type.String()),
	scenes: Type.Array(Type.String()),
});

const ConstraintSchema = Type.Object({
	content: Type.String(),
});

const WriteChapterSchema = Type.Object({
	content: Type.String(),
	chapter: Type.Optional(Type.String()),
});

const RewriteChapterSchema = Type.Object({
	content: Type.String(),
	chapter: Type.String(),
});

const ReadChapterSchema = Type.Object({
	chapter: Type.String(),
});

const EmptySchema = Type.Object({});

export default function piXieExtension(pi: ExtensionAPI): void {
	pi.registerEntryRenderer<{ text: string }>("system-prompt-preview", (entry, _options, theme) => {
		const text = entry.data?.text ?? "";
		return new Text(theme.fg("dim", `[系统提示词预览]\n${text}`), 0, 0);
	});
	pi.registerEntryRenderer<{ chapter: string; text: string }>("noai-writing", (entry, _options, theme) => {
		const chapter = entry.data?.chapter ?? "";
		const text = entry.data?.text ?? "";
		return new Text(`${theme.fg("accent", `[人脑写作 · ${chapter}]`)}\n${text}`, 0, 0);
	});
	pi.registerEntryRenderer<{ speaker: string; text: string; user: boolean }>(
		"roleplay-line",
		(entry, _options, theme) => {
			const speaker = entry.data?.speaker ?? "";
			const text = entry.data?.text ?? "";
			const label = entry.data?.user ? theme.fg("accent", `[你·${speaker}]`) : theme.fg("dim", `[${speaker}]`);
			return new Text(`${label} ${text}`, 0, 0);
		},
	);
	pi.registerEntryRenderer<{ text: string }>("roleplay-round", (entry, _options, theme) => {
		return new Text(theme.fg("dim", `[子代理] ${entry.data?.text ?? ""}`), 0, 0);
	});
	pi.registerEntryRenderer<{ sceneName: string; lines: string[]; omitted: number }>(
		"roleplay-resume",
		(entry, _options, theme) => {
			const sceneName = entry.data?.sceneName ?? "";
			const lines = entry.data?.lines ?? [];
			const omitted = entry.data?.omitted ?? 0;
			const head = theme.fg("dim", `[对戏续写 · ${sceneName}${omitted > 0 ? ` · 已省略更早 ${omitted} 句` : ""}]`);
			const body = lines.map((line) => theme.fg("dim", line)).join("\n");
			return new Text(`${head}${body ? `\n${body}` : ""}`, 0, 0);
		},
	);

	let systemPromptShown = false;
	let noAiChapter: { cwd: string; file: string } | undefined;
	const clearNoAiUi = (ctx: ExtensionContext) => {
		ctx.ui.setStatus("noai", undefined);
		ctx.ui.setWidget("noai-chapter", undefined);
	};
	const updateNoAiUi = (ctx: ExtensionContext, file: string) => {
		const chapter = readChapter(ctx.cwd, file);
		const content = chapter.content.trimEnd();
		const lines = content ? content.split(/\r?\n/) : [];
		// Extension widgets render at most 10 lines (InteractiveMode.MAX_WIDGET_LINES).
		// Budget: header (1) + omitted marker (1) + chapter tail + footer (1), so show the
		// newest 7 lines when older lines are omitted, otherwise all lines (up to 8).
		const needsOmission = lines.length > 8;
		const visibleLines = needsOmission ? lines.slice(-7) : lines;
		const hiddenLineCount = lines.length - visibleLines.length;
		ctx.ui.setStatus("noai", `人脑模式：${file}`);
		ctx.ui.setWidget(
			"noai-chapter",
			[
				`[人脑模式 · ${file} · ${content.length} 字]`,
				...(needsOmission ? [`… 已省略前 ${hiddenLineCount} 行`] : []),
				...visibleLines,
				"[/noai：退出模式或新建下一章]",
			],
			{ placement: "aboveEditor" },
		);
		return chapter;
	};

	let rehearsal: RehearsalContext | undefined;
	let lastRoundSummary: string | undefined;
	/** @角色 切换扮演时允许的特殊叙述身份（无需角色卡）。 */
	const NARRATOR_ROLES = new Set(["旁白", "自己", "导演", "narrator", "director"]);
	const rehearsalActive = (): boolean => rehearsal !== undefined;
	const clearRehearsalUi = (ctx: ExtensionContext) => {
		lastRoundSummary = undefined;
		ctx.ui.setStatus("roleplay", undefined);
		ctx.ui.setWidget("roleplay-live", undefined);
	};
	const updateRehearsalUi = (ctx: ExtensionContext) => {
		if (!rehearsal) return;
		ctx.ui.setStatus(
			"roleplay",
			`对戏模式：${rehearsal.sceneName} · 你：${rehearsal.userRoleName ?? "旁白/自己"}${lastRoundSummary ? ` · ${lastRoundSummary}` : ""}`,
		);
	};
	const recordRoleplayLine = (line: { speaker: string; text: string; user: boolean }): void => {
		if (!rehearsal) return;
		appendRoleLine(rehearsal.recordPath, line);
		rehearsal.segment.push(line);
		pi.appendEntry("roleplay-line", { ...line });
	};

	/** 组装单个角色的静态系统提示词（卡片+场景+约束；对话历史由角色 agent 转录承载）。 */
	const buildCharacterSystemPromptFor = (current: RehearsalContext, participant: RehearsalParticipant): string => {
		let entity: EntityRecord | undefined;
		try {
			entity = getEntity(current.cwd, "characters", participant.id);
		} catch {
			// 角色卡缺失时仍以参与者信息占位
		}
		const fallbackCard: EntityRecord = {
			id: participant.id,
			name: participant.name,
			tags: [],
			updatedAt: "",
			kind: "characters",
			body: "",
			opening: "",
			system: "",
			path: "",
		};
		const card = entity ?? fallbackCard;
		const scene = getEntity(current.cwd, "scenes", current.sceneId);
		const otherNames = current.aiCharacters
			.filter((candidate) => candidate.id !== participant.id)
			.map((candidate) => candidate.name);
		return buildCharacterSystemPrompt({
			character: card,
			otherNames,
			userRoleName: current.userRoleName,
			sceneName: scene.name,
			sceneBody: scene.body,
			sceneStart: current.sceneStart,
			worldview: readConstraint(current.cwd, "worldview"),
			outline: readConstraint(current.cwd, "outline"),
			timeline: readConstraint(current.cwd, "timeline"),
			style: getEffectiveStyleText(current.cwd),
			unrestricted: isArmorBreakEnabled(current.cwd),
		});
	};

	/** 角色 agent 不存在则创建并按当前记录回放转录。 */
	const ensureCharacterAgent = (current: RehearsalContext, participant: RehearsalParticipant): void => {
		if (current.agentSystemPrompts[participant.id] !== undefined) return;
		const systemPrompt = buildCharacterSystemPromptFor(current, participant);
		pi.createCharacterAgent({ id: participant.id, systemPrompt });
		pi.setCharacterAgentHistory({
			id: participant.id,
			messages: buildSessionMessages(current.segment, participant.id, participant.name),
		});
		current.agentSystemPrompts[participant.id] = systemPrompt;
		const last = current.segment[current.segment.length - 1];
		current.agentLastRoles[participant.id] =
			last && !last.user && last.speaker === participant.name ? "assistant" : "user";
	};

	/** 按当前记录整体重建全部角色 agent 的转录（/改台词、/重说、新开一段后调用）。 */
	const rebuildCharacterAgentTranscripts = (current: RehearsalContext): void => {
		for (const participant of current.aiCharacters) {
			const systemPrompt = buildCharacterSystemPromptFor(current, participant);
			pi.setCharacterAgentHistory({
				id: participant.id,
				systemPrompt,
				messages: buildSessionMessages(current.segment, participant.id, participant.name),
			});
			current.agentSystemPrompts[participant.id] = systemPrompt;
			const last = current.segment[current.segment.length - 1];
			current.agentLastRoles[participant.id] =
				last && !last.user && last.speaker === participant.name ? "assistant" : "user";
		}
	};

	/** 用户行（含导演指示）注入所有角色 agent 的转录（不触发回应）。 */
	const appendUserLineToAgents = (current: RehearsalContext, line: RoleLine): void => {
		const content = formatRoleLine(line);
		for (const participant of current.aiCharacters) {
			pi.appendCharacterAgentMessage({ id: participant.id, message: { role: "user", content } });
			current.agentLastRoles[participant.id] = "user";
		}
	};

	/** 角色新台词以引述格式注入其他所有角色 agent 的转录（自己的转录已由 agent 运行自然包含）。 */
	const appendLineToOtherAgents = (current: RehearsalContext, line: RoleLine, selfId: string): void => {
		const content = `${line.speaker}：「${line.text}」`;
		for (const participant of current.aiCharacters) {
			if (participant.id === selfId) continue;
			pi.appendCharacterAgentMessage({ id: participant.id, message: { role: "user", content } });
			current.agentLastRoles[participant.id] = "user";
		}
	};

	/** 退出对戏时销毁全部角色 agent。 */
	const disposeRehearsalAgents = (current: RehearsalContext): void => {
		for (const participant of current.aiCharacters) {
			pi.disposeCharacterAgent({ id: participant.id });
		}
		current.agentSystemPrompts = {};
		current.agentLastRoles = {};
		current.characterActivity = {};
	};

	/**
	 * 生成单个角色的回应：基于其常驻 agent 转录（真 agent 循环），按人设自主判断该不该开口。
	 * forced：点名回合，追加临时强制指令；否则转录末尾已是新内容时 continue，末尾是自己上句时以导演推进语 prompt。
	 */
	const generateCharacterTurn = async (
		ctx: ExtensionContext,
		current: RehearsalContext,
		participant: RehearsalParticipant,
		forced: boolean,
	): Promise<RoleLine[] | undefined> => {
		// 人设热加载：systemPrompt 变化时只热更新提示词，不动转录
		const systemPrompt = buildCharacterSystemPromptFor(current, participant);
		if (current.agentSystemPrompts[participant.id] !== systemPrompt) {
			pi.setCharacterAgentHistory({ id: participant.id, systemPrompt });
			current.agentSystemPrompts[participant.id] = systemPrompt;
		}
		// 实时活动状态：直播 widget 与监视面板共用
		current.characterActivity[participant.id] = { status: "speaking", stream: "" };
		let lastWidgetUpdate = 0;
		const onUpdate = (update: CharacterAgentUpdate): void => {
			if (update.type === "turn_start") return; // 无内容，不刷新 widget
			const activity = current.characterActivity[participant.id];
			if (!activity) return;
			if (update.type === "text_delta") {
				activity.status = "speaking";
				activity.stream += update.text;
			} else if (update.type === "thinking_delta") {
				activity.status = "thinking";
			} else if (update.type === "turn_end") {
				activity.status = "idle";
			}
			const now = Date.now();
			if (now - lastWidgetUpdate >= 80) {
				lastWidgetUpdate = now;
				ctx.ui.setWidget(
					"roleplay-live",
					buildRoleplayLiveLines(participant.name, activity.status, activity.stream),
					{ placement: "belowEditor" },
				);
			}
		};
		let reply: string | undefined;
		try {
			if (forced) {
				reply = await pi.runCharacterAgentTurn({
					id: participant.id,
					message: "（点名：本轮你必须回应，不得沉默）",
					signal: ctx.signal,
					onUpdate,
				});
			} else if (current.agentLastRoles[participant.id] === "user") {
				reply = await pi.continueCharacterAgent({ id: participant.id, signal: ctx.signal, onUpdate });
			} else {
				reply = await pi.runCharacterAgentTurn({
					id: participant.id,
					message: DIRECTOR_CONTINUE_MESSAGE,
					signal: ctx.signal,
					onUpdate,
				});
			}
		} catch (error) {
			ctx.ui.notify(`对戏失败：${error instanceof Error ? error.message : String(error)}`, "error");
		}
		// 回合结束：状态归位并做一次不节流的最终刷新（stream 保留为「最近回应」供监视面板查看）
		const activity = current.characterActivity[participant.id];
		if (activity) {
			if (activity.status !== "idle") activity.status = "idle";
			ctx.ui.setWidget("roleplay-live", buildRoleplayLiveLines(participant.name, activity.status, activity.stream), {
				placement: "belowEditor",
			});
		}
		// 无论回应/沉默/失败，agent 转录末尾都是（或仍是）assistant
		current.agentLastRoles[participant.id] = "assistant";
		if (!reply || isSilenceReply(reply)) return undefined;
		const otherNames = current.aiCharacters
			.filter((candidate) => candidate.id !== participant.id)
			.map((candidate) => candidate.name);
		const parsed = parseAiReplyLines(reply, [participant], otherNames);
		return parsed.length > 0 ? parsed : undefined;
	};

	/** 记录回应行（文件 + segment + 其他角色 agent 注入）并刷新 UI；返回是否有产出。 */
	const commitCharacterTurn = (
		current: RehearsalContext,
		ctx: ExtensionContext,
		participant: RehearsalParticipant,
		lines: RoleLine[],
	): boolean => {
		for (const line of lines) {
			recordRoleplayLine(line);
			appendLineToOtherAgents(current, line, participant.id);
		}
		if (lines.length > 0) updateRehearsalUi(ctx);
		return lines.length > 0;
	};

	/** 单角色强制回合（@点名 / /重说）：只唤醒该角色，沉默视为失败。 */
	const runCharacterTurn = async (
		ctx: ExtensionContext,
		current: RehearsalContext,
		participant: RehearsalParticipant,
	): Promise<boolean> => {
		const lines = await generateCharacterTurn(ctx, current, participant, true);
		return lines ? commitCharacterTurn(current, ctx, participant, lines) : false;
	};

	/**
	 * 一轮 = 全体 AI 角色按出场顺序串行各自判断是否接话。
	 * 后面的角色能看到前面角色同一轮刚产生的新台词。
	 * 无人接话时 produced=false。
	 */
	const runCharacterRound = async (
		ctx: ExtensionContext,
		current: RehearsalContext,
	): Promise<{ produced: boolean; speakers: string[]; silent: string[] }> => {
		const speakers: string[] = [];
		const silent: string[] = [];
		let produced = false;
		// 轮内状态栏固定显示「对戏模式：场景 · 你：角色 · 最近一轮」；逐角色进度由直播 widget 展示
		updateRehearsalUi(ctx);
		for (const participant of current.aiCharacters) {
			const lines = await generateCharacterTurn(ctx, current, participant, false);
			if (lines) {
				produced = true;
				speakers.push(participant.name);
				commitCharacterTurn(current, ctx, participant, lines);
			} else {
				silent.push(participant.name);
			}
		}
		if (produced) updateRehearsalUi(ctx);
		return { produced, speakers, silent };
	};

	/** 推进一轮对戏：解析 @ 分派，记录用户台词，按模式执行全员判断轮。 */
	const advanceRehearsal = async (raw: string, ctx: ExtensionContext): Promise<void> => {
		const current = rehearsal;
		if (!current || current.cwd !== ctx.cwd) return;
		const speak = parseSpeakAs(raw);
		let target = speak.roleName ? classifySpeakTarget(speak.roleName, current.aiCharacters) : undefined;
		let text = speak.text.trim();
		if (target?.kind === "user") {
			const roleName = target.roleName;
			const known =
				NARRATOR_ROLES.has(roleName) ||
				listEntities(ctx.cwd, "characters").some(
					(candidate) => candidate.id === roleName || candidate.name === roleName,
				);
			if (known) {
				current.userRoleName = roleName;
			} else {
				// 未知角色名（如没打空格的「@千夏你来了」）：不切换角色，整行按原文记为台词
				target = undefined;
				text = raw.trim();
			}
		}

		const isDirector = current.userRoleName === undefined;
		const roundBudget = isDirector ? DIRECTOR_MAX_TURNS : 1;
		let roundsLeft = roundBudget;

		// 裸点名（如「@千夏」不带台词）：不记录用户行，只让该角色开口
		if (!text && target?.kind !== "ai") {
			if (target?.kind === "user") updateRehearsalUi(ctx);
			return;
		}

		// 导演模式（旁白/自己）：行标记为 [user:旁白]，与真实角色台词区分
		if (text) {
			const line: RoleLine = { speaker: current.userRoleName ?? "旁白", text, user: true };
			recordRoleplayLine(line);
			appendUserLineToAgents(current, line);
			updateRehearsalUi(ctx);
		}

		// @点名：只唤醒被点角色强制回应，不惊动其他角色
		if (target?.kind === "ai") {
			if (!text) {
				// 裸点名：把「该你说话了」的提示注入该角色 agent，再强制回应
				pi.appendCharacterAgentMessage({
					id: target.participant.id,
					message: { role: "user", content: "（点名：该你说话了，请按当前局面自然回应）" },
				});
				current.agentLastRoles[target.participant.id] = "user";
			}
			const produced = await runCharacterTurn(ctx, current, target.participant);
			lastRoundSummary = produced ? `${target.participant.name} 接话` : `${target.participant.name} 未回应`;
			updateRehearsalUi(ctx);
			if (current.aiCharacters.length > 1) {
				pi.appendEntry("roleplay-round", {
					text: produced ? `点名：${target.participant.name} 接话` : `点名：${target.participant.name} 未回应`,
				});
			}
			if (!produced) {
				roundsLeft = 0;
			} else {
				roundsLeft -= 1;
			}
		}

		for (let round = 0; round < roundsLeft; round++) {
			if (!rehearsal || rehearsal !== current) break;
			const result = await runCharacterRound(ctx, current);
			lastRoundSummary = result.produced
				? `${result.speakers.join("、")} 接话${result.silent.length > 0 ? `（${result.silent.join("、")} 沉默）` : ""}`
				: "无人接话";
			updateRehearsalUi(ctx);
			if (current.aiCharacters.length > 1) {
				pi.appendEntry("roleplay-round", {
					text: result.produced
						? `${result.speakers.join("、")} 接话${result.silent.length > 0 ? ` · ${result.silent.join("、")} 沉默` : ""}`
						: "本轮无人接话",
				});
			}
			if (!result.produced) break;
		}

		// 本轮结束：收起直播 widget
		ctx.ui.setWidget("roleplay-live", undefined);

		// 自动成文节流（导演模式多回合合并结算一次）
		if (
			rehearsal === current &&
			current.autoProse &&
			current.segment.length - current.proseWatermark >= AUTO_PROSE_THRESHOLD_LINES
		) {
			current.proseWatermark = current.segment.length;
			pi.sendUserMessage(
				buildProseInstruction({
					sceneName: current.sceneName,
					transcript: renderTranscript(current.segment),
					replace: false,
				}),
			);
		}
	};
	pi.on("session_start", (_event, ctx) => {
		systemPromptShown = false;
		noAiChapter = undefined;
		clearNoAiUi(ctx);
		if (rehearsal) disposeRehearsalAgents(rehearsal);
		rehearsal = undefined;
		clearRehearsalUi(ctx);
		// 对戏 @点名 补全：仅交互模式；会话切换时 interactive mode 会清空 provider 包装并重新挂载
		if (ctx.mode === "tui") {
			ctx.ui.addAutocompleteProvider((current) => buildRehearsalMentionProvider(current, () => rehearsal, ctx.cwd));
		}
	});
	pi.on("before_agent_start", async (event, ctx) => {
		if (systemPromptShown || ctx.mode !== "tui") return;
		systemPromptShown = true;
		pi.appendEntry<{ text: string }>("system-prompt-preview", { text: event.systemPrompt });
	});
	pi.on("input", async (event, ctx) => {
		if (!noAiChapter || event.source !== "interactive") return { action: "continue" };
		if (noAiChapter.cwd !== ctx.cwd) {
			noAiChapter = undefined;
			clearNoAiUi(ctx);
			return { action: "continue" };
		}

		try {
			const chapter = readChapter(ctx.cwd, noAiChapter.file);
			const previousContent = chapter.content;
			const trimmedContent = previousContent.trimEnd();
			const nextContent = trimmedContent ? `${trimmedContent}\n${event.text}` : event.text;
			saveSnapshot(ctx.cwd, {
				toolCallId: "command:noai-input",
				action: "rewrite",
				path: chapter.path,
				oldContent: previousContent,
			});
			const rewritten = rewriteChapter(ctx.cwd, nextContent, chapter.file);
			pi.appendEntry<{ chapter: string; text: string }>("noai-writing", {
				chapter: chapter.file,
				text: event.text,
			});
			updateNoAiUi(ctx, chapter.file);
			ctx.ui.notify(`已写入 ${chapter.file}（${rewritten.content.trimEnd().length} 字）`, "info");
		} catch (error) {
			ctx.ui.notify(`写入章节失败：${error instanceof Error ? error.message : String(error)}`, "error");
			return { action: "handled" };
		}
		if (event.images && event.images.length > 0) {
			ctx.ui.notify("人脑模式只写入文字，图片已忽略", "warning");
		}
		return { action: "handled" };
	});

	pi.on("input", async (event, ctx) => {
		if (!rehearsal || event.source !== "interactive") return { action: "continue" };
		if (rehearsal.cwd !== ctx.cwd) {
			disposeRehearsalAgents(rehearsal);
			rehearsal = undefined;
			clearRehearsalUi(ctx);
			return { action: "continue" };
		}
		await advanceRehearsal(event.text, ctx);
		return { action: "handled" };
	});

	pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext) => {
		if (!mutatingTools.has(event.toolName)) return undefined;
		if (!ctx.hasUI) return undefined;
		if (isAutoWriteEnabled(ctx.cwd)) return undefined;
		const summary = JSON.stringify(event.input).slice(0, 200);
		const ok = await ctx.ui.confirm(`Run ${event.toolName}?`, summary || "(no arguments)");
		if (!ok) return { block: true, reason: "User cancelled" };
		return undefined;
	});

	pi.registerTool({
		name: "list_entities",
		label: "List entities",
		description: "List character or scene entities by kind.",
		parameters: ListEntitiesSchema,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const kind = entityKind(params.kind);
			return textResult(JSON.stringify(listEntities(ctx.cwd, kind), null, 2));
		},
	});

	pi.registerTool({
		name: "get_entity",
		label: "Get entity",
		description: "Get a character or scene by id.",
		parameters: GetEntitySchema,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const kind = entityKind(params.kind);
			return textResult(JSON.stringify(getEntity(ctx.cwd, kind, params.id), null, 2));
		},
	});

	pi.registerTool({
		name: "create_entity",
		label: "Create entity",
		description: "Create a new character or scene.",
		parameters: CreateEntitySchema,
		async execute(toolCallId, params, _signal, _onUpdate, ctx) {
			const kind = entityKind(params.kind);
			const record = createEntity(ctx.cwd, kind, {
				id: params.id,
				name: params.name,
				tags: params.tags,
				body: params.body,
				opening: params.opening,
				system: params.system,
			});
			saveSnapshot(ctx.cwd, { toolCallId, action: "create", path: record.path, oldContent: null });
			return textResult(JSON.stringify(record, null, 2));
		},
	});

	pi.registerTool({
		name: "update_entity",
		label: "Update entity",
		description: "Update a character or scene.",
		parameters: UpdateEntitySchema,
		async execute(toolCallId, params, _signal, _onUpdate, ctx) {
			const kind = entityKind(params.kind);
			const existing = getEntity(ctx.cwd, kind, params.id);
			saveSnapshot(ctx.cwd, {
				toolCallId,
				action: "update",
				path: existing.path,
				oldContent: readFileSync(existing.path, "utf8"),
			});
			const record = updateEntity(ctx.cwd, kind, params.id, {
				name: params.name,
				tags: params.tags,
				body: params.body,
				opening: params.opening,
				system: params.system,
			});
			return textResult(JSON.stringify(record, null, 2));
		},
	});

	pi.registerTool({
		name: "write_rehearsal_prose",
		label: "Write rehearsal prose",
		description:
			"把对戏改写的正文写入当前排练稿文件（premises/rehearsals/prose/）。replace=true 覆盖整个文件，否则追加。",
		parameters: Type.Object({
			content: Type.String(),
			replace: Type.Optional(Type.Boolean()),
		}),
		async execute(toolCallId, params, _signal, _onUpdate, ctx) {
			if (!rehearsal || rehearsal.cwd !== ctx.cwd) {
				throw new Error("当前没有进行中的对戏，无法写入排练稿");
			}
			const previous = readProse(rehearsal.prosePath);
			const path = writeProse(rehearsal.prosePath, params.content, params.replace === true);
			saveSnapshot(ctx.cwd, {
				toolCallId,
				action: "rewrite",
				path,
				oldContent: previous || null,
			});
			if (ctx.hasUI) ctx.ui.notify(`排练稿已更新（${params.replace === true ? "覆盖" : "追加"}）`, "info");
			return textResult(`已写入排练稿（${params.replace === true ? "覆盖" : "追加"}）：${path}`);
		},
	});

	pi.registerTool({
		name: "delete_entity",
		label: "Delete entity",
		description: "Delete a character or scene.",
		parameters: DeleteEntitySchema,
		async execute(toolCallId, params, _signal, _onUpdate, ctx) {
			const kind = entityKind(params.kind);
			const existing = getEntity(ctx.cwd, kind, params.id);
			saveSnapshot(ctx.cwd, {
				toolCallId,
				action: "delete",
				path: existing.path,
				oldContent: readFileSync(existing.path, "utf8"),
			});
			deleteEntity(ctx.cwd, kind, params.id);
			return textResult(`Deleted ${entityLabel(kind)} ${params.id}`);
		},
	});

	pi.registerTool({
		name: "select_premises",
		label: "Select premises",
		description: "Set the active character and scene combination.",
		parameters: SelectPremisesSchema,
		async execute(toolCallId, params, _signal, _onUpdate, ctx) {
			ensureWorkspace(ctx.cwd);
			const path = activePath(ctx.cwd);
			saveSnapshot(ctx.cwd, { toolCallId, action: "active", path, oldContent: readFileSync(path, "utf8") });
			const active = selectPremises(ctx.cwd, { characters: params.characters, scenes: params.scenes });
			return textResult(JSON.stringify(active, null, 2));
		},
	});

	pi.registerTool({
		name: "get_active_context",
		label: "Get active context",
		description: "Read active premises, constraints, and chapter list.",
		parameters: EmptySchema,
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			ensureWorkspace(ctx.cwd);
			const active = getActive(ctx.cwd);
			const characters = listEntities(ctx.cwd, "characters").filter((entity) =>
				active.characters.includes(entity.id),
			);
			const scenes = listEntities(ctx.cwd, "scenes").filter((entity) => active.scenes.includes(entity.id));
			const constraints = {
				worldview: readConstraint(ctx.cwd, "worldview"),
				outline: readConstraint(ctx.cwd, "outline"),
				timeline: readConstraint(ctx.cwd, "timeline"),
				style: getEffectiveStyleText(ctx.cwd),
			};
			const chapters = listChapters(ctx.cwd).map((chapter) => ({
				number: chapter.number,
				file: chapter.file,
			}));
			const previousChapters = listChapters(ctx.cwd)
				.slice(-3)
				.map((chapter) => ({ number: chapter.number, file: chapter.file, content: chapter.content }));
			return textResult(
				JSON.stringify(
					{
						active,
						characters,
						scenes,
						constraints,
						chapters,
						manuscriptPath: getManuscriptPath(ctx.cwd),
						previousChapters,
					},
					null,
					2,
				),
			);
		},
	});

	for (const constraint of ["worldview", "outline", "timeline", "style"] as const) {
		pi.registerTool({
			name: `set_${constraint}`,
			label: `Set ${constraint}`,
			description: `Set the ${constraint} constraint.`,
			parameters: ConstraintSchema,
			async execute(toolCallId, params, _signal, _onUpdate, ctx) {
				ensureWorkspace(ctx.cwd);
				const path = join(ctx.cwd, "premises", `${constraint}.md`);
				saveSnapshot(ctx.cwd, { toolCallId, action: "constraint", path, oldContent: readFileSync(path, "utf8") });
				writeConstraint(ctx.cwd, constraint, params.content);
				return textResult(`Updated ${constraint}.`);
			},
		});
	}

	pi.registerTool({
		name: "get_style",
		label: "Get style",
		description: "Read the current writing style.",
		parameters: EmptySchema,
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			return textResult(getEffectiveStyleText(ctx.cwd));
		},
	});

	pi.registerTool({
		name: "read_chapter",
		label: "Read chapter",
		description: "Read a chapter file by number or filename.",
		parameters: ReadChapterSchema,
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const chapter = readChapter(ctx.cwd, params.chapter);
			return textResult(JSON.stringify(chapter, null, 2));
		},
	});

	pi.registerTool({
		name: "write_chapter",
		label: "Write chapter",
		description: "Write a new chapter file. Use only when the user explicitly asked to write or continue chapters.",
		parameters: WriteChapterSchema,
		async execute(toolCallId, params, _signal, _onUpdate, ctx) {
			ensureWorkspace(ctx.cwd);
			const chapter = writeChapter(ctx.cwd, params.content, params.chapter);
			saveSnapshot(ctx.cwd, { toolCallId, action: "write", path: chapter.path, oldContent: null });
			return textResult(`Wrote ${chapter.file} (${chapter.content.length} characters).`);
		},
	});

	pi.registerTool({
		name: "rewrite_chapter",
		label: "Rewrite chapter",
		description: "Rewrite an existing chapter file.",
		parameters: RewriteChapterSchema,
		async execute(toolCallId, params, _signal, _onUpdate, ctx) {
			ensureWorkspace(ctx.cwd);
			const existing = readChapter(ctx.cwd, params.chapter);
			saveSnapshot(ctx.cwd, { toolCallId, action: "rewrite", path: existing.path, oldContent: existing.content });
			const chapter = rewriteChapter(ctx.cwd, params.content, params.chapter);
			return textResult(`Rewrote ${chapter.file} (${chapter.content.length} characters).`);
		},
	});

	pi.registerTool({
		name: "undo_last",
		label: "Undo last",
		description: "Restore the last writing-tool file snapshot.",
		parameters: EmptySchema,
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const snapshot = undoLast(ctx.cwd);
			if (!snapshot) return textResult("Nothing to undo.");
			return textResult(`Undid ${snapshot.action} for ${snapshot.path}`);
		},
	});

	const listCommand =
		(kind: EntityKind) =>
		async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
			const name = args.trim();
			if (name) {
				ensureWorkspace(ctx.cwd);
				const body = await ctx.ui.editor(`Describe ${entityLabel(kind)} ${name}`, "");
				const record = createEntity(ctx.cwd, kind, { name, body: body ?? "" });
				ctx.ui.notify(`Created ${entityLabel(kind)} ${record.id}`, "info");
				return;
			}

			const entities = listEntities(ctx.cwd, kind);
			if (entities.length === 0) {
				ctx.ui.notify(`No ${kind} yet`, "info");
				return;
			}

			const selected = await ctx.ui.select(
				`Select ${entityLabel(kind)}`,
				entities.map((entity) => `${entity.id} - ${entity.name}`),
			);
			if (!selected) return;

			const id = selected.split(" - ")[0];
			const entity = getEntity(ctx.cwd, kind, id);
			const action = await ctx.ui.select("Action", ["View", "Edit", "Delete"]);
			if (!action) return;

			if (action === "View") {
				ctx.ui.notify(`${entity.name}\n${entity.body.slice(0, 500)}`, "info");
			} else if (action === "Edit") {
				const body = await ctx.ui.editor(`Edit ${entity.name}`, entity.body);
				if (body !== undefined) updateEntity(ctx.cwd, kind, id, { body });
			} else if (action === "Delete") {
				const ok = await ctx.ui.confirm("Delete", `Delete ${entity.name}?`);
				if (ok) deleteEntity(ctx.cwd, kind, id);
			}
		};

	const characterCommand = listCommand("characters");
	const sceneCommand = listCommand("scenes");
	pi.registerCommand("character", { description: "List or create characters", handler: characterCommand });
	pi.registerCommand("人物", { description: "List or create characters", handler: characterCommand });
	pi.registerCommand("scene", { description: "List or create scenes", handler: sceneCommand });
	pi.registerCommand("场景", { description: "List or create scenes", handler: sceneCommand });

	const importCharacterHandler = async (args: string, ctx: ExtensionCommandContext) => {
		const filePath = args.trim();
		if (!filePath) {
			ctx.ui.notify("用法：/角色导入 <tavern.json>（PNG 角色卡暂不支持）", "warning");
			return;
		}
		if (filePath.toLowerCase().endsWith(".png")) {
			ctx.ui.notify("PNG 角色卡暂不支持，请先导出为 JSON。", "error");
			return;
		}
		const absolute = resolve(ctx.cwd, filePath);
		let content: string;
		try {
			content = readFileSync(absolute, "utf8");
		} catch {
			ctx.ui.notify(`无法读取文件：${absolute}`, "error");
			return;
		}
		try {
			const card = parseTavernCard(content);
			ensureWorkspace(ctx.cwd);
			const record = createEntity(ctx.cwd, "characters", {
				name: card.name,
				tags: card.tags,
				body: card.body,
				opening: card.opening,
				system: card.system,
			});
			ctx.ui.notify(`已导入角色：${record.id}（${record.name}）`, "info");
		} catch (error) {
			ctx.ui.notify(`角色卡导入失败：${error instanceof Error ? error.message : String(error)}`, "error");
		}
	};
	pi.registerCommand("角色导入", {
		description: "导入 Tavern 格式角色卡（JSON，兼容 Operit）",
		handler: importCharacterHandler,
	});
	pi.registerCommand("import-character", {
		description: "Import a Tavern character card (JSON, Operit compatible)",
		handler: importCharacterHandler,
	});

	const constraintAliases = {
		worldview: "世界观",
		outline: "大纲",
		timeline: "时间线",
		style: "风格",
	} as const;
	for (const constraint of ["worldview", "outline", "timeline", "style"] as const) {
		const handler = async (_args: string, ctx: ExtensionCommandContext) => {
			ensureWorkspace(ctx.cwd);
			const current = readConstraint(ctx.cwd, constraint);
			const next = await ctx.ui.editor(`${constraint} constraint`, current);
			if (next !== undefined) {
				writeConstraint(ctx.cwd, constraint, next);
				ctx.ui.notify(`Saved ${constraint}`, "info");
			}
		};
		pi.registerCommand(constraint, { description: `Edit ${constraint}`, handler });
		pi.registerCommand(constraintAliases[constraint], { description: `Edit ${constraint}`, handler });
	}

	const premiseHandler = async (_args: string, ctx: ExtensionCommandContext) => {
		ensureWorkspace(ctx.cwd);
		const characters = listEntities(ctx.cwd, "characters");
		const scenes = listEntities(ctx.cwd, "scenes");
		const characterChoice = await ctx.ui.select(
			"Select main character",
			characters.map((entity) => `${entity.id} - ${entity.name}`),
		);
		const sceneChoice = await ctx.ui.select(
			"Select main scene",
			scenes.map((entity) => `${entity.id} - ${entity.name}`),
		);
		const active: ActivePremises = {
			characters: characterChoice ? [characterChoice.split(" - ")[0]] : [],
			scenes: sceneChoice ? [sceneChoice.split(" - ")[0]] : [],
		};
		selectPremises(ctx.cwd, active);
		ctx.ui.notify("Updated active premises", "info");
	};
	pi.registerCommand("premise", { description: "Select active character/scene premises", handler: premiseHandler });
	pi.registerCommand("前提", { description: "Select active character/scene premises", handler: premiseHandler });

	const writeHandler = async (args: string, ctx: ExtensionCommandContext) => {
		const instruction = args.trim() || (await ctx.ui.input("What should I write?"));
		if (!instruction) return;
		if (!ctx.isIdle()) {
			ctx.ui.notify("Agent is busy", "warning");
			return;
		}
		pi.sendUserMessage(instruction);
	};
	pi.registerCommand("write", {
		description: "Ask the agent to write a chapter",
		handler: writeHandler,
		autocompletePriority: 400,
	});
	pi.registerCommand("写作", {
		description: "Ask the agent to write a chapter",
		handler: writeHandler,
		autocompletePriority: 400,
	});

	const noAiHandler = async (_args: string, ctx: ExtensionCommandContext) => {
		if (!ctx.isIdle()) {
			ctx.ui.notify("Agent is busy", "warning");
			return;
		}

		const enterChapter = (file: string) => {
			noAiChapter = { cwd: ctx.cwd, file };
			updateNoAiUi(ctx, file);
			ctx.ui.notify(`已进入人脑模式，当前章节：${file}`, "info");
		};
		const createChapter = () => {
			const chapter = writeChapter(ctx.cwd, "");
			saveSnapshot(ctx.cwd, {
				toolCallId: "command:noai",
				action: "write",
				path: chapter.path,
				oldContent: null,
			});
			enterChapter(chapter.file);
		};

		if (noAiChapter?.cwd === ctx.cwd) {
			const exitAction = "退出人脑模式";
			const newChapterAction = "新建下一章";
			const action = await ctx.ui.select("人脑模式", [exitAction, newChapterAction]);
			if (action === exitAction) {
				noAiChapter = undefined;
				clearNoAiUi(ctx);
				ctx.ui.notify("已退出人脑模式", "info");
			} else if (action === newChapterAction) {
				createChapter();
			}
			return;
		}

		const chapters = listChapters(ctx.cwd);
		const newChapterAction = "新建下一章";
		const continueChapterAction = "续写已有章节";
		const action = await ctx.ui.select(
			"进入人脑模式",
			chapters.length > 0 ? [newChapterAction, continueChapterAction] : [newChapterAction],
		);
		if (!action) return;
		if (action === newChapterAction) {
			createChapter();
			return;
		}
		const selected = await ctx.ui.select(
			"选择要续写的章节",
			chapters.map((chapter) => chapter.file),
		);
		if (!selected) return;
		enterChapter(selected);
	};
	pi.registerCommand("noai", { description: "切换持续人脑写作模式（不调用 AI）", handler: noAiHandler });
	pi.registerCommand("人脑", { description: "切换持续人脑写作模式（不调用 AI）", handler: noAiHandler });

	const rehearsalCommand = async (_args: string, ctx: ExtensionCommandContext) => {
		if (!ctx.isIdle()) {
			ctx.ui.notify("Agent is busy", "warning");
			return;
		}
		ensureWorkspace(ctx.cwd);

		if (rehearsal?.cwd === ctx.cwd) {
			const action = await ctx.ui.select("对戏模式", ["退出对戏", "退出并成文", "新开一段对戏"]);
			if (action === "退出对戏") {
				disposeRehearsalAgents(rehearsal);
				rehearsal = undefined;
				clearRehearsalUi(ctx);
				ctx.ui.notify("已退出对戏模式", "info");
			} else if (action === "退出并成文") {
				const sent = await runProseConversion(ctx, true);
				if (sent) {
					disposeRehearsalAgents(rehearsal);
					rehearsal = undefined;
					clearRehearsalUi(ctx);
					ctx.ui.notify("已退出对戏模式，正文已交给写作 agent", "info");
				}
			} else if (action === "新开一段对戏" && rehearsal) {
				const entered = await ctx.ui.editor(
					"新一段的起始情境（按剧情现状预填，可直接用、修改或重写）",
					deriveSceneStartSuggestion(ctx.cwd),
				);
				if (entered === undefined) return;
				const sceneStart = entered.trim();
				startNewSegment(
					rehearsal.recordPath,
					sceneStart || undefined,
					rehearsal.aiCharacters.map((participant) => participant.id),
				);
				rehearsal.sceneStart = sceneStart;
				rehearsal.segment = [];
				rehearsal.proseWatermark = 0;
				lastRoundSummary = undefined;
				rebuildCharacterAgentTranscripts(rehearsal);
				updateRehearsalUi(ctx);
				ctx.ui.notify("已新开一段对戏", "info");
			}
			return;
		}

		// 场景：可选已有场景，也可以随时新建（用 /场景 可后续编辑设定）
		const createSceneViaPrompt = async (title: string, placeholder: string): Promise<string | undefined> => {
			const sceneName = await ctx.ui.input(title, placeholder);
			if (sceneName === undefined) return undefined;
			const trimmedName = sceneName.trim();
			if (!trimmedName) return undefined;
			const createdScene = createEntity(ctx.cwd, "scenes", { name: trimmedName, body: "" });
			return createdScene.id;
		};
		let sceneId: string;
		const scenes = listEntities(ctx.cwd, "scenes");
		if (scenes.length === 0) {
			const createdId = await createSceneViaPrompt(
				"还没有场景。创建本场对戏的场景名称",
				"例如：早饭餐桌 / 山顶草地。回车确认，取消则退出",
			);
			if (!createdId) return;
			sceneId = createdId;
		} else {
			const createSceneLabel = "＋ 新建场景…";
			const selectedScene = await ctx.ui.select("选择对戏场景（或新建）", [
				...scenes.map((scene) => scene.id),
				createSceneLabel,
			]);
			if (!selectedScene) return;
			if (selectedScene === createSceneLabel) {
				const createdId = await createSceneViaPrompt("新场景名称", "例如：筑基次日的早餐。回车确认，取消则退出");
				if (!createdId) return;
				sceneId = createdId;
			} else {
				sceneId = selectedScene;
			}
		}
		const scene = getEntity(ctx.cwd, "scenes", sceneId);

		// 角色：优先让 AI 自动判断出场角色与用户扮演角色；失败或不对时退回手动选择
		const characters = listEntities(ctx.cwd, "characters");
		let aiCharacters: RehearsalParticipant[];
		let userRoleName: string | undefined;

		const pickAiManually = async (): Promise<RehearsalParticipant[] | undefined> => {
			const chosen: RehearsalParticipant[] = [];
			for (;;) {
				const rest = characters.filter((candidate) => !chosen.some((picked) => picked.id === candidate.id));
				if (rest.length === 0) break;
				const options = [...rest.map((candidate) => `${candidate.id} - ${candidate.name}`), "完成选择"];
				const picked = await ctx.ui.select(
					`选择 AI 扮演的角色（已选：${chosen.map((participant) => participant.name).join("、") || "无"}，可多选）`,
					options,
				);
				if (!picked || picked === "完成选择") break;
				const id = picked.split(" - ")[0] ?? "";
				const entity = characters.find((candidate) => candidate.id === id);
				if (entity) chosen.push({ id: entity.id, name: entity.name });
			}
			return chosen.length > 0 ? chosen : undefined;
		};
		const pickUserRoleManually = async (): Promise<string | undefined> => {
			const aiIds = new Set(aiCharacters.map((participant) => participant.id));
			const available = characters.filter((candidate) => !aiIds.has(candidate.id));
			const options = ["旁白/自己", ...available.map((candidate) => `${candidate.id} - ${candidate.name}`)];
			const choice = await ctx.ui.select("你扮演", options);
			if (!choice) return undefined;
			return choice === "旁白/自己" ? "旁白/自己" : (choice.split(" - ")[1] ?? choice);
		};

		if (characters.length === 0) {
			// 没有人物：就地创建（用 /人物 或 /角色导入 可补充设定）
			const aiName = await ctx.ui.input("还没有人物。AI 扮演的角色名", "例如：绯雪");
			if (aiName === undefined) return;
			const trimmedAi = aiName.trim();
			if (!trimmedAi) return;
			const created = createEntity(ctx.cwd, "characters", { name: trimmedAi, body: "" });
			aiCharacters = [{ id: created.id, name: created.name }];
			const userInput = await ctx.ui.input("你扮演的角色名", "例如：策栖辞。留空 = 旁白/自己");
			if (userInput === undefined) return;
			userRoleName = userInput.trim() || undefined;
		} else {
			// AI 自动选角：推断本场出场角色与用户扮演角色
			let cast: CastResult | undefined;
			const defaultRoleId = getDefaultUserRole(ctx.cwd);
			try {
				const sceneStartHint = deriveSceneStartSuggestion(ctx.cwd);
				const castCharacters = characters.map((candidate) => ({
					id: candidate.id,
					name: candidate.name,
					body: candidate.body,
				}));
				const castInput = {
					sceneName: scene.name,
					sceneBody: scene.body,
					sceneStart: sceneStartHint,
					characters: castCharacters,
					...(defaultRoleId ? { defaultUserRoleId: defaultRoleId } : {}),
				};
				const reply = await pi.runSubAgent({
					systemPrompt: buildCastPrompt(castInput),
					messages: [{ role: "user", content: "请判断本场出场角色。" }],
				});
				cast = reply ? parseCastResult(reply, castCharacters) : undefined;
				// 默认用户扮演角色：AI 不得扮演它，userRole 固定为该角色
				if (cast && defaultRoleId) {
					cast = applyDefaultUserRole(cast, defaultRoleId, castCharacters) ?? undefined;
				}
			} catch {
				cast = undefined;
			}

			if (cast) {
				const castAiNames = cast.aiRoles
					.map((id) => characters.find((candidate) => candidate.id === id)?.name)
					.filter((name): name is string => name !== undefined);
				const castUserName = cast.userRole
					? (characters.find((candidate) => candidate.id === cast.userRole)?.name ?? undefined)
					: undefined;
				const autoLabel = `按 AI 建议开演（AI：${castAiNames.join("、")}；你：${castUserName ?? "旁白/自己"}）`;
				const action = await ctx.ui.select("AI 已判断本场角色", [autoLabel, "手动选择"]);
				if (action !== autoLabel && action !== "手动选择") return;
				if (action === autoLabel) {
					aiCharacters = cast.aiRoles
						.map((id) => {
							const entity = characters.find((candidate) => candidate.id === id);
							return entity ? { id: entity.id, name: entity.name } : undefined;
						})
						.filter((participant): participant is RehearsalParticipant => participant !== undefined);
					userRoleName = castUserName;
				} else {
					const chosen = await pickAiManually();
					if (!chosen) return;
					aiCharacters = chosen;
					const manualRole = await pickUserRoleManually();
					if (manualRole === undefined) return;
					userRoleName = manualRole === "旁白/自己" ? undefined : manualRole;
				}
			} else {
				ctx.ui.notify("AI 选角失败，请手动选择", "warning");
				const chosen = await pickAiManually();
				if (!chosen) return;
				aiCharacters = chosen;
				const manualRole = await pickUserRoleManually();
				if (manualRole === undefined) return;
				userRoleName = manualRole === "旁白/自己" ? undefined : manualRole;
			}
		}

		const aiIds = aiCharacters.map((participant) => participant.id);
		const recordPath = recordPathFor(ctx.cwd, sceneId, aiIds);
		let segment = readRecordSegment(recordPath);
		let sceneStart = readSegmentSceneStart(recordPath) ?? "";
		// 恢复本段保存的发言顺序（记录文件是唯一事实源）
		const savedOrder = readSegmentOrder(recordPath);
		if (savedOrder.length > 0) {
			const byId = new Map(aiCharacters.map((participant) => [participant.id, participant]));
			const reordered = savedOrder
				.map((id) => byId.get(id))
				.filter((participant): participant is RehearsalParticipant => participant !== undefined);
			aiCharacters = [...reordered, ...aiCharacters.filter((participant) => !savedOrder.includes(participant.id))];
		}
		if (segment.length > 0) {
			const action = await ctx.ui.select("已有对戏记录", ["续写这段对戏", "新开一段"]);
			if (!action) return;
			if (action === "新开一段") {
				segment = [];
				sceneStart = "";
			}
		}

		if (segment.length === 0) {
			// 按剧情现状预填起始情境；用户可直接用、修改或完全重写（最大权限）。
			const entered = await ctx.ui.editor(
				"本场对戏的起始情境（按剧情现状预填，可直接用、修改或重写）",
				deriveSceneStartSuggestion(ctx.cwd),
			);
			if (entered === undefined) return;
			sceneStart = entered.trim();
		}

		if (segment.length === 0) {
			startNewSegment(
				recordPath,
				sceneStart || undefined,
				aiCharacters.map((participant) => participant.id),
			);
		}
		rehearsal = {
			cwd: ctx.cwd,
			sceneId,
			sceneName: scene.name,
			aiCharacters,
			userRoleName,
			recordPath,
			prosePath: prosePathFor(ctx.cwd, sceneId, aiIds),
			sceneStart,
			segment,
			agentSystemPrompts: {},
			agentLastRoles: {},
			characterActivity: {},
			proseWatermark: 0,
			autoProse: false,
		};
		// 常驻角色 agent：每个角色一个真 agent 循环，并按当前段记录回放转录
		for (const participant of aiCharacters) {
			ensureCharacterAgent(rehearsal, participant);
		}
		// 续写对戏：把最近几句历史显示出来，避免不知道写到哪
		if (segment.length > 0) {
			pi.appendEntry("roleplay-resume", {
				sceneName: scene.name,
				lines: segment.slice(-8).map(formatRoleLine),
				omitted: Math.max(0, segment.length - 8),
			});
		}
		noAiChapter = undefined;
		clearNoAiUi(ctx);
		updateRehearsalUi(ctx);
		const aiNames = aiCharacters.map((participant) => participant.name).join("、");
		ctx.ui.notify(
			`已进入对戏模式：${scene.name} · AI 扮演 ${aiNames}（${aiCharacters.length} 个常驻角色子代理）· 输入 @角色名 台词 可点名回应`,
			"info",
		);
	};
	pi.registerCommand("对戏", {
		description: "进入角色扮演对戏模式（AI 扮演人物，你扮演任意角色）",
		handler: rehearsalCommand,
		autocompletePriority: 390,
	});
	pi.registerCommand("roleplay", {
		description: "Enter roleplay rehearsal mode",
		handler: rehearsalCommand,
		autocompletePriority: 390,
	});

	const switchRoleHandler = async (args: string, ctx: ExtensionCommandContext) => {
		if (!rehearsal || rehearsal.cwd !== ctx.cwd) {
			ctx.ui.notify("当前不在对戏模式", "warning");
			return;
		}
		let roleName = args.trim();
		if (!roleName) {
			const characters = listEntities(ctx.cwd, "characters");
			const aiIds = new Set(rehearsal.aiCharacters.map((participant) => participant.id));
			const available = characters.filter((candidate) => !aiIds.has(candidate.id));
			const selected = await ctx.ui.select("切换扮演角色", [
				"旁白/自己",
				...available.map((character) => `${character.id} - ${character.name}`),
			]);
			if (!selected) return;
			roleName = selected;
		}
		rehearsal.userRoleName = roleName === "旁白/自己" ? undefined : roleName;
		updateRehearsalUi(ctx);
		ctx.ui.notify(`你现在扮演：${rehearsal.userRoleName ?? "旁白/自己"}`, "info");
	};
	const rehearsalOnlyVisible = () => rehearsalActive();
	pi.registerCommand("扮演", {
		description: "切换你扮演的角色",
		handler: switchRoleHandler,
		autocompleteVisible: rehearsalOnlyVisible,
		autocompletePriority: 770,
	});
	pi.registerCommand("act-as", {
		description: "Switch the role you are playing",
		handler: switchRoleHandler,
		autocompleteVisible: rehearsalOnlyVisible,
		autocompletePriority: 770,
	});

	/** /发言顺序：设置轮内串行评估时 AI 角色的先后顺序（持久化到记录文件当前段）。 */
	const speakOrderHandler = async (args: string, ctx: ExtensionCommandContext) => {
		const current = rehearsal;
		if (!current || current.cwd !== ctx.cwd) {
			ctx.ui.notify("当前不在对戏模式", "warning");
			return;
		}
		const byToken = new Map<string, RehearsalParticipant>();
		for (const participant of current.aiCharacters) {
			byToken.set(participant.id, participant);
			byToken.set(participant.name, participant);
		}
		const apply = (order: RehearsalParticipant[]) => {
			current.aiCharacters = order;
			rewriteRecordTail(
				current.recordPath,
				current.sceneStart,
				current.segment,
				order.map((participant) => participant.id),
			);
			ctx.ui.notify(`发言顺序：${order.map((participant) => participant.name).join(" → ")}`, "info");
		};
		const tokens = args.trim().split(/\s+/).filter(Boolean);
		if (tokens.length > 0) {
			const order: RehearsalParticipant[] = [];
			const used = new Set<string>();
			for (const token of tokens) {
				const participant = byToken.get(token);
				if (!participant) {
					ctx.ui.notify(`未知角色：${token}`, "warning");
					return;
				}
				if (used.has(participant.id)) {
					ctx.ui.notify(`角色重复：${token}`, "warning");
					return;
				}
				used.add(participant.id);
				order.push(participant);
			}
			if (order.length !== current.aiCharacters.length) {
				ctx.ui.notify(`需要列出全部 ${current.aiCharacters.length} 个角色`, "warning");
				return;
			}
			apply(order);
			return;
		}
		// 无参数：按「谁先开口」逐个选择
		const remaining = [...current.aiCharacters];
		const order: RehearsalParticipant[] = [];
		while (remaining.length > 0) {
			const selected = await ctx.ui.select(
				`选择第 ${order.length + 1} 个开口的角色`,
				remaining.map((participant) => `${participant.id} - ${participant.name}`),
			);
			if (!selected) return; // 取消
			const id = selected.split(" - ")[0] ?? "";
			const index = remaining.findIndex((participant) => participant.id === id);
			if (index < 0) return;
			order.push(...remaining.splice(index, 1));
		}
		apply(order);
	};
	pi.registerCommand("发言顺序", {
		description: "设置对戏中 AI 角色的发言顺序（参数：按顺序列出角色名/ID，空格分隔）",
		handler: speakOrderHandler,
		autocompleteVisible: rehearsalOnlyVisible,
		autocompletePriority: 755,
	});
	pi.registerCommand("speak-order", {
		description: "Set the speaking order of AI characters",
		handler: speakOrderHandler,
		autocompleteVisible: rehearsalOnlyVisible,
		autocompletePriority: 755,
	});

	/** /对戏监视：Claude Code 式面板，↑/↓ 切换角色实时流式内容，Esc 关闭。 */
	const monitorHandler = async (_args: string, ctx: ExtensionCommandContext) => {
		if (!rehearsal || rehearsal.cwd !== ctx.cwd) {
			ctx.ui.notify("当前不在对戏模式", "warning");
			return;
		}
		if (!ctx.ui.custom) {
			ctx.ui.notify("当前环境不支持监视面板", "warning");
			return;
		}
		const current = rehearsal;
		await ctx.ui.custom<void>((tui, theme, _kb, done) =>
			createRoleplayMonitorComponent(
				tui,
				theme,
				() =>
					current.aiCharacters.map((participant) => {
						const activity = current.characterActivity[participant.id];
						return {
							id: participant.id,
							name: participant.name,
							status: activity?.status ?? "idle",
							stream: activity?.stream ?? "",
						};
					}),
				() => done(),
			),
		);
	};
	pi.registerCommand("对戏监视", {
		description: "打开角色 agent 监视面板（↑/↓ 切换角色，Esc 关闭）",
		handler: monitorHandler,
		autocompleteVisible: rehearsalOnlyVisible,
		autocompletePriority: 754,
	});

	/** 设置项目级默认扮演角色（自动选角时生效；手动选择保持原逻辑）。 */
	const defaultRoleHandler = async (args: string, ctx: ExtensionCommandContext) => {
		const characters = listEntities(ctx.cwd, "characters");
		const trimmed = args.trim();
		let roleId: string | undefined;
		if (trimmed) {
			const lower = trimmed.toLowerCase();
			if (lower === "旁白" || lower === "clear" || lower === "清除") {
				roleId = undefined;
			} else {
				const target = characters.find((candidate) => candidate.id === trimmed || candidate.name === trimmed);
				if (!target) {
					ctx.ui.notify(`未找到角色：${trimmed}`, "warning");
					return;
				}
				roleId = target.id;
			}
		} else {
			const currentId = getDefaultUserRole(ctx.cwd);
			const options = [
				"旁白/自己（清除默认）",
				...characters.map(
					(candidate) => `${candidate.id} - ${candidate.name}${candidate.id === currentId ? "（当前默认）" : ""}`,
				),
			];
			const selected = await ctx.ui.select("用户默认扮演（自动选角时使用）", options);
			if (!selected) return;
			roleId = selected.startsWith("旁白/自己") ? undefined : (selected.split(" - ")[0] ?? undefined);
		}
		setDefaultUserRole(ctx.cwd, roleId);
		const name = roleId ? (characters.find((candidate) => candidate.id === roleId)?.name ?? roleId) : "旁白/自己";
		ctx.ui.notify(`已设置默认扮演：${name}（下次自动选角生效）`, "info");
	};
	pi.registerCommand("默认扮演", {
		description: "设置自动选角时的默认扮演角色",
		handler: defaultRoleHandler,
		autocompletePriority: 360,
	});
	pi.registerCommand("default-role", {
		description: "Set the default user role for auto-cast",
		handler: defaultRoleHandler,
		autocompletePriority: 360,
	});

	/** 把本段对戏交给写作 agent：写入目标章节并继续后续剧情。返回是否已发送。 */
	const runProseConversion = async (ctx: ExtensionCommandContext, exitAfter: boolean): Promise<boolean> => {
		if (!rehearsal || rehearsal.cwd !== ctx.cwd) {
			ctx.ui.notify("当前不在对戏模式", "warning");
			return false;
		}
		if (!ctx.isIdle()) {
			ctx.ui.notify("Agent is busy", "warning");
			return false;
		}
		if (rehearsal.segment.length === 0) {
			ctx.ui.notify("本段对戏还没有内容", "warning");
			return false;
		}
		const chapters = listChapters(ctx.cwd);
		if (chapters.length === 0) {
			ctx.ui.notify("还没有章节，请先让写作 agent 写出章节", "warning");
			return false;
		}
		const chapterChoices = [...chapters].reverse().map((chapter) => chapter.file);
		const selected = await ctx.ui.select("写入哪个章节（第一个为最新）", chapterChoices);
		if (!selected) return false;
		const continuation = await ctx.ui.input(
			exitAfter ? "成文后继续写到的位置" : "成文后继续写到的位置（可选）",
			exitAfter
				? "必填：例如「继续写到太阳落山，两人下山」。成文后写作 agent 会接着写"
				: "可选：例如「继续写到太阳落山，两人下山」。留空则只写入对话正文",
		);
		if (continuation === undefined) return false;

		rehearsal.proseWatermark = rehearsal.segment.length;
		pi.sendUserMessage(
			buildChapterProseInstruction({
				chapterFile: selected,
				sceneName: rehearsal.sceneName,
				transcript: renderTranscript(rehearsal.segment),
				continuation: continuation.trim() || undefined,
			}),
		);
		ctx.ui.notify(`已把本段对戏交给写作 agent：写入 ${selected} 并继续写`, "info");
		return true;
	};

	const proseHandler = async (_args: string, ctx: ExtensionCommandContext) => {
		await runProseConversion(ctx, false);
	};
	pi.registerCommand("对戏成文", {
		description: "把本段对戏转成正文写入章节并继续写后续剧情",
		handler: proseHandler,
		autocompleteVisible: rehearsalOnlyVisible,
		autocompletePriority: 780,
	});

	const autoProseHandler = async (args: string, ctx: ExtensionCommandContext) => {
		if (!rehearsal || rehearsal.cwd !== ctx.cwd) {
			ctx.ui.notify("当前不在对戏模式", "warning");
			return;
		}
		const trimmed = args.trim();
		if (trimmed) {
			const enabled = parseEnabledState(trimmed);
			if (enabled === undefined) {
				ctx.ui.notify("用法：/对戏自动 <开|关>", "warning");
				return;
			}
			rehearsal.autoProse = enabled;
		} else {
			rehearsal.autoProse = !rehearsal.autoProse;
		}
		ctx.ui.notify(
			`自动成文：${rehearsal.autoProse ? `开启（每 ${AUTO_PROSE_THRESHOLD_LINES} 句转一次）` : "关闭"}`,
			"info",
		);
	};
	pi.registerCommand("对戏自动", {
		description: "切换自动成文",
		handler: autoProseHandler,
		autocompleteVisible: rehearsalOnlyVisible,
		autocompletePriority: 760,
	});

	/** /重说：选择「哪个角色说的哪一句」，将该句与其后内容作废，由该角色基于此前你最后一条消息重新生成。 */
	const retellHandler = async (args: string, ctx: ExtensionCommandContext) => {
		const current = rehearsal;
		if (!current || current.cwd !== ctx.cwd) {
			ctx.ui.notify("当前不在对戏模式", "warning");
			return;
		}
		const aiLineIndexes = current.segment
			.map((line, index) => ({ line, index }))
			.filter((item) => !item.line.user)
			.map((item) => item.index);
		if (aiLineIndexes.length === 0) {
			ctx.ui.notify("本段还没有 AI 的回应，无从重说", "warning");
			return;
		}

		const numbered = args.trim();
		let targetIndex: number;
		if (numbered && Number.isInteger(Number(numbered))) {
			const parsed = Number(numbered);
			if (parsed < 1 || parsed > current.segment.length || current.segment[parsed - 1]?.user) {
				ctx.ui.notify("行号需要在 1-N 之间且必须是 AI 的台词行", "warning");
				return;
			}
			targetIndex = parsed - 1;
		} else if (numbered) {
			ctx.ui.notify("用法：/重说 <行号>，或直接 /重说 从最近几句里选择要重说的角色台词", "warning");
			return;
		} else {
			const candidates = aiLineIndexes.slice(-8);
			const options = candidates.map((index) => {
				const line = current.segment[index]!;
				return `${index + 1} · ${formatRoleLine({ ...line, text: line.text.slice(0, 40) })}`;
			});
			const selected = await ctx.ui.select("选择要重新生成的角色台词（其后内容一并作废）", options);
			if (!selected) return;
			const matched = selected.match(/^(\d+)\s·/);
			if (!matched) return;
			targetIndex = Number(matched[1]) - 1;
		}

		const targetLine = current.segment[targetIndex];
		if (!targetLine || targetLine.user) {
			ctx.ui.notify("只能重说 AI 角色的台词行", "warning");
			return;
		}
		const speakerParticipant =
			current.aiCharacters.find((participant) => participant.name === targetLine.speaker) ?? current.aiCharacters[0];
		if (!speakerParticipant) return;

		// 触发点：目标句之前最近的用户消息；无用户消息则以目标句前的全部上下文为准
		let kept: RoleLine[];
		let triggerUserIndex = -1;
		for (let index = targetIndex - 1; index >= 0; index--) {
			if (current.segment[index]?.user) {
				triggerUserIndex = index;
				break;
			}
		}
		if (triggerUserIndex >= 0) {
			const contextLines = current.segment.slice(0, triggerUserIndex);
			kept = [...contextLines, current.segment[triggerUserIndex]!];
		} else {
			kept = current.segment.slice(0, targetIndex);
		}
		current.segment = kept;
		rewriteRecordTail(
			current.recordPath,
			current.sceneStart,
			kept,
			current.aiCharacters.map((participant) => participant.id),
		);
		// 角色 agent 转录与记录保持一致：全部按新段重建，再让该角色强制重新回应
		rebuildCharacterAgentTranscripts(current);
		updateRehearsalUi(ctx);
		ctx.ui.notify(
			`已撤回「${formatRoleLine(targetLine).slice(0, 40)}…」及其后内容，由 ${speakerParticipant.name} 重新回应`,
			"info",
		);
		await runCharacterTurn(ctx, current, speakerParticipant);
	};
	pi.registerCommand("重说", {
		description: "重说某位角色的一句回应（选择行号，其后内容作废）",
		handler: retellHandler,
		autocompleteVisible: rehearsalOnlyVisible,
		autocompletePriority: 800,
	});

	/** 编辑（或删除）本段某一行台词。 */
	const editLineHandler = async (args: string, ctx: ExtensionCommandContext) => {
		const current = rehearsal;
		if (!current || current.cwd !== ctx.cwd) {
			ctx.ui.notify("当前不在对戏模式", "warning");
			return;
		}
		const total = current.segment.length;
		if (total === 0) {
			ctx.ui.notify("本段还没有内容", "warning");
			return;
		}
		const maxPick = Math.min(total, 8);
		const numbered = args.trim();
		let targetIndex: number;
		const parsedIndex = Number(numbered);
		if (numbered && Number.isInteger(parsedIndex)) {
			if (parsedIndex < 1 || parsedIndex > total) {
				ctx.ui.notify(`行号需在 1-${total} 之间（1 = 最早）`, "warning");
				return;
			}
			targetIndex = parsedIndex - 1;
		} else if (numbered) {
			ctx.ui.notify("用法：/改台词 <行号>，或直接 /改台词 从最近几行里选", "warning");
			return;
		} else {
			const startIndex = Math.max(0, total - maxPick);
			const options = current.segment.slice(startIndex).map((line, offset) => {
				const lineNumber = startIndex + offset + 1;
				const label = formatRoleLine({ ...line, text: line.text.slice(0, 40) });
				return `${lineNumber} · ${label}`;
			});
			const selected = await ctx.ui.select("选择要修改的台词行（清空内容可删除该行）", options);
			if (!selected) return;
			const matched = selected.match(/^(\d+)\s·/);
			if (!matched) return;
			targetIndex = Number(matched[1]) - 1;
		}
		const line = current.segment[targetIndex];
		if (!line) return;
		const edited = await ctx.ui.editor(`修改第 ${targetIndex + 1} 行（清空后回车 = 删除该行）`, formatRoleLine(line));
		if (edited === undefined) return;
		if (edited.trim().length === 0) {
			current.segment.splice(targetIndex, 1);
		} else {
			// 整行替换：保留原说话人与用户标记，文本用编辑结果（去标签前缀）
			const text = edited.trim().replace(/^\[(user:)?[^\]]+\]\s*/, "");
			current.segment[targetIndex] = { ...line, text: text || line.text };
		}
		rewriteRecordTail(
			current.recordPath,
			current.sceneStart,
			current.segment,
			current.aiCharacters.map((participant) => participant.id),
		);
		rebuildCharacterAgentTranscripts(current);
		updateRehearsalUi(ctx);
		ctx.ui.notify("台词已更新", "info");
	};
	pi.registerCommand("改台词", {
		description: "修改或删除本段的一行台词",
		handler: editLineHandler,
		autocompleteVisible: rehearsalOnlyVisible,
		autocompletePriority: 790,
	});

	const undoHandler = async (_args: string, ctx: ExtensionCommandContext) => {
		const snapshot = undoLast(ctx.cwd);
		ctx.ui.notify(snapshot ? `Undid ${snapshot.action}` : "Nothing to undo", "info");
	};
	pi.registerCommand("undo", { description: "Undo last writing-tool change", handler: undoHandler });
	pi.registerCommand("撤销", { description: "Undo last writing-tool change", handler: undoHandler });

	const rulesHandler = async (args: string, ctx: ExtensionCommandContext) => {
		ensureWorkspace(ctx.cwd);
		const trimmed = args.trim();
		if (trimmed) {
			const parsed = parseRuleToggleArgs(trimmed);
			if (!parsed) {
				ctx.ui.notify("用法：/规则 <序号|id|名称> <开|关>，或直接 /规则", "warning");
				return;
			}
			const id = resolveRuleId(parsed.target);
			if (!id) {
				ctx.ui.notify(`未知规则：${parsed.target}`, "error");
				return;
			}
			const result = setWritingRuleEnabled(ctx.cwd, id, parsed.enabled);
			if (result) {
				ctx.ui.notify(`${result.rule.name}：${result.enabled ? "已开启" : "已关闭"}`, "info");
			}
			return;
		}

		for (;;) {
			const effective = getEffectiveWritingRules(ctx.cwd);
			const options = effective.map(
				(item, index) => `${index + 1}. ${item.rule.name} [${item.enabled ? "开" : "关"}]`,
			);
			const selected = await ctx.ui.select("写作规则开关", options);
			if (!selected) break;
			const index = Number(selected.split(".")[0]) - 1;
			const item = effective[index];
			if (!item) continue;
			const state = await ctx.ui.select("设置状态", ["开启", "关闭"]);
			if (!state) continue;
			setWritingRuleEnabled(ctx.cwd, item.rule.id, state === "开启");
			ctx.ui.notify(`${item.rule.name}：${state}`, "info");
		}
	};
	pi.registerCommand("规则", {
		description: "切换写作规则开关",
		handler: rulesHandler,
		autocompletePriority: 370,
	});
	pi.registerCommand("rules", {
		description: "Toggle writing rules",
		handler: rulesHandler,
		autocompletePriority: 370,
	});

	const armorHandler = async (args: string, ctx: ExtensionCommandContext) => {
		const trimmed = args.trim();
		let enabled: boolean | undefined;
		if (trimmed) {
			enabled = parseEnabledState(trimmed);
			if (enabled === undefined) {
				ctx.ui.notify("用法：/破甲 <开|关|on|off|1|0|true|false>，或直接 /破甲", "warning");
				return;
			}
		} else {
			const current = isArmorBreakEnabled(ctx.cwd);
			const onLabel = `开启${current ? "（当前）" : ""}`;
			const offLabel = `关闭${current ? "" : "（当前）"}`;
			const state = await ctx.ui.select("破甲模式", [onLabel, offLabel]);
			if (!state) return;
			enabled = state === onLabel;
		}
		setArmorBreakEnabled(ctx.cwd, enabled);
		ctx.ui.notify(`破甲模式：${enabled ? "开启" : "关闭"}。请新开一个会话（/new 或重启 pi-xie）后生效。`, "info");
	};
	pi.registerCommand("破甲", {
		description: "切换系统提示词破甲模式",
		handler: armorHandler,
		autocompletePriority: 380,
	});

	const permissionsHandler = async (args: string, ctx: ExtensionCommandContext) => {
		const trimmed = args.trim();
		let enabled: boolean | undefined;
		if (trimmed) {
			const lower = trimmed.toLowerCase();
			if (lower === "自动" || lower === "auto") {
				enabled = true;
			} else if (lower === "手动" || lower === "manual") {
				enabled = false;
			} else {
				enabled = parseEnabledState(trimmed);
			}
			if (enabled === undefined) {
				ctx.ui.notify("用法：/permissions <自动|手动|开|关|on|off|1|0|true|false>，或直接 /permissions", "warning");
				return;
			}
		} else {
			const current = isAutoWriteEnabled(ctx.cwd);
			const onLabel = `自动写入${current ? "（当前）" : ""}`;
			const offLabel = `手动确认${current ? "" : "（当前）"}`;
			const state = await ctx.ui.select("权限控制", [onLabel, offLabel]);
			if (!state) return;
			enabled = state === onLabel;
		}
		setAutoWriteEnabled(ctx.cwd, enabled);
		ctx.ui.notify(`自动模式：${enabled ? "所有写入/修改免确认" : "手动（每次确认）"}`, "info");
	};
	pi.registerCommand("permissions", {
		description: "切换自动授权（所有写入/修改免确认）",
		handler: permissionsHandler,
	});
	pi.registerCommand("权限", { description: "切换自动授权（所有写入/修改免确认）", handler: permissionsHandler });

	pi.registerCommand("manuscript", {
		description: "Rebuild manuscript.txt from chapter files",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const path = rebuildManuscript(ctx.cwd);
			ctx.ui.notify(`Rebuilt ${path}`, "info");
		},
	});
}

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { isArmorBreakEnabled, setArmorBreakEnabled } from "../../core/armor-break.ts";
import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ToolCallEvent,
} from "../../core/extensions/index.ts";
import { isAutoWriteEnabled, setAutoWriteEnabled } from "./permissions.ts";
import {
	AUTO_PROSE_THRESHOLD_LINES,
	appendRoleLine,
	buildChapterProseInstruction,
	buildProseInstruction,
	buildRoleplaySystemPrompt,
	buildRoleplayWidget,
	deriveSceneStartSuggestion,
	parseSpeakAs,
	prosePathFor,
	type RehearsalContext,
	readProse,
	readRecordSegment,
	readSegmentSceneStart,
	recordPathFor,
	renderTranscript,
	startNewSegment,
	writeProse,
} from "./roleplay.ts";
import { parseTavernCard } from "./tavern.ts";
import {
	type ActivePremises,
	createEntity,
	deleteEntity,
	type EntityKind,
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
	const clearRehearsalUi = (ctx: ExtensionContext) => {
		ctx.ui.setStatus("roleplay", undefined);
		ctx.ui.setWidget("roleplay-transcript", undefined);
	};
	const updateRehearsalUi = (ctx: ExtensionContext) => {
		if (!rehearsal) return;
		ctx.ui.setStatus("roleplay", `对戏模式：${rehearsal.sceneName} · 你：${rehearsal.userRoleName ?? "旁白/自己"}`);
		ctx.ui.setWidget("roleplay-transcript", buildRoleplayWidget(rehearsal), { placement: "aboveEditor" });
	};
	const recordRoleplayLine = (line: { speaker: string; text: string; user: boolean }): void => {
		if (!rehearsal) return;
		appendRoleLine(rehearsal.recordPath, line);
		rehearsal.segment.push(line);
		pi.appendEntry("roleplay-line", { ...line });
	};
	/** 推进一轮对戏：记录用户台词，调用子代理，记录回应对白。 */
	const advanceRehearsal = async (raw: string, ctx: ExtensionContext): Promise<void> => {
		const current = rehearsal;
		if (!current || current.cwd !== ctx.cwd) return;
		const speak = parseSpeakAs(raw);
		if (speak.roleName) current.userRoleName = speak.roleName;
		const text = speak.text.trim();
		if (!text) return;

		const previousTranscript = renderTranscript(current.segment);
		recordRoleplayLine({ speaker: current.userRoleName ?? "你", text, user: true });
		updateRehearsalUi(ctx);

		try {
			const aiCharacter = getEntity(current.cwd, "characters", current.aiCharacterId);
			const scene = getEntity(current.cwd, "scenes", current.sceneId);
			const systemPrompt = buildRoleplaySystemPrompt({
				aiCharacter,
				userRoleName: current.userRoleName,
				sceneName: scene.name,
				sceneBody: scene.body,
				sceneStart: current.sceneStart,
				worldview: readConstraint(current.cwd, "worldview"),
				outline: readConstraint(current.cwd, "outline"),
				timeline: readConstraint(current.cwd, "timeline"),
				style: getEffectiveStyleText(current.cwd),
				transcript: previousTranscript,
				unrestricted: isArmorBreakEnabled(current.cwd),
			});
			const reply = await pi.runSubAgent({
				systemPrompt,
				messages: [{ role: "user", content: text }],
				signal: ctx.signal,
			});
			if (reply) {
				for (const lineText of reply
					.split(/\r?\n/)
					.map((line) => line.trim())
					.filter(Boolean)) {
					recordRoleplayLine({ speaker: current.aiCharacterName, text: lineText, user: false });
				}
				updateRehearsalUi(ctx);
				if (current.autoProse && current.segment.length - current.proseWatermark >= AUTO_PROSE_THRESHOLD_LINES) {
					current.proseWatermark = current.segment.length;
					pi.sendUserMessage(
						buildProseInstruction({
							sceneName: current.sceneName,
							transcript: renderTranscript(current.segment),
							replace: false,
						}),
					);
				}
			} else {
				ctx.ui.notify("对戏代理未返回对白（未配置模型或已取消）", "warning");
			}
		} catch (error) {
			ctx.ui.notify(`对戏失败：${error instanceof Error ? error.message : String(error)}`, "error");
		}
	};
	pi.on("session_start", (_event, ctx) => {
		systemPromptShown = false;
		noAiChapter = undefined;
		clearNoAiUi(ctx);
		rehearsal = undefined;
		clearRehearsalUi(ctx);
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
	pi.registerCommand("write", { description: "Ask the agent to write a chapter", handler: writeHandler });
	pi.registerCommand("写作", { description: "Ask the agent to write a chapter", handler: writeHandler });

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
				rehearsal = undefined;
				clearRehearsalUi(ctx);
				ctx.ui.notify("已退出对戏模式", "info");
			} else if (action === "退出并成文") {
				const sent = await runProseConversion(ctx, true);
				if (sent) {
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
				startNewSegment(rehearsal.recordPath, sceneStart || undefined);
				rehearsal.sceneStart = sceneStart;
				rehearsal.segment = [];
				rehearsal.proseWatermark = 0;
				updateRehearsalUi(ctx);
				ctx.ui.notify("已新开一段对戏", "info");
			}
			return;
		}

		// 场景：没有场景时引导就地创建（用 /场景 可后续编辑设定）
		let sceneId: string;
		const scenes = listEntities(ctx.cwd, "scenes");
		if (scenes.length === 0) {
			const sceneName = await ctx.ui.input(
				"还没有场景。创建本场对戏的场景名称",
				"例如：绯雪房间门口 / 山顶草地。回车确认，取消则退出",
			);
			if (sceneName === undefined) return;
			const trimmedName = sceneName.trim();
			if (!trimmedName) return;
			const createdScene = createEntity(ctx.cwd, "scenes", { name: trimmedName, body: "" });
			sceneId = createdScene.id;
		} else {
			const selectedScene = await ctx.ui.select(
				"选择对戏场景",
				scenes.map((scene) => scene.id),
			);
			if (!selectedScene) return;
			sceneId = selectedScene;
		}

		// AI 扮演的角色：没有人物时引导就地创建（用 /人物 或 /角色导入 可补充设定）
		const characters = listEntities(ctx.cwd, "characters");
		let aiChoice: string;
		if (characters.length === 0) {
			const aiName = await ctx.ui.input(
				"还没有人物。AI 扮演的角色名",
				"例如：绯雪。回车确认（稍后可用 /人物 补充设定，或 /角色导入 导入角色卡）",
			);
			if (aiName === undefined) return;
			const trimmedName = aiName.trim();
			if (!trimmedName) return;
			const created = createEntity(ctx.cwd, "characters", { name: trimmedName, body: "" });
			aiChoice = `${created.id} - ${created.name}`;
		} else {
			const selected = await ctx.ui.select(
				"AI 扮演的角色",
				characters.map((character) => `${character.id} - ${character.name}`),
			);
			if (!selected) return;
			aiChoice = selected;
		}
		const aiCharacterId = aiChoice.split(" - ")[0];
		const aiCharacter = getEntity(ctx.cwd, "characters", aiCharacterId);

		// 用户扮演的角色：任意名字或旁白；不必是已存在的人物
		let userRoleName: string | undefined;
		if (characters.length === 0) {
			const userInput = await ctx.ui.input("你扮演的角色名", "例如：策栖辞。留空 = 旁白/自己");
			if (userInput === undefined) return;
			const trimmed = userInput.trim();
			userRoleName = trimmed || undefined;
		} else {
			const userChoice = await ctx.ui.select("你扮演", [
				"旁白/自己",
				...characters.map((character) => `${character.id} - ${character.name}`),
			]);
			if (!userChoice) return;
			userRoleName = userChoice === "旁白/自己" ? undefined : (userChoice.split(" - ")[1] ?? userChoice);
		}

		const recordPath = recordPathFor(ctx.cwd, sceneId, aiCharacterId);
		let segment = readRecordSegment(recordPath);
		let sceneStart = readSegmentSceneStart(recordPath) ?? "";
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

		const scene = getEntity(ctx.cwd, "scenes", sceneId);
		if (segment.length === 0) {
			startNewSegment(recordPath, sceneStart || undefined);
		}
		rehearsal = {
			cwd: ctx.cwd,
			sceneId,
			sceneName: scene.name,
			aiCharacterId,
			aiCharacterName: aiCharacter.name,
			userRoleName,
			recordPath,
			prosePath: prosePathFor(ctx.cwd, sceneId, aiCharacterId),
			sceneStart,
			segment,
			proseWatermark: 0,
			autoProse: false,
		};
		noAiChapter = undefined;
		clearNoAiUi(ctx);
		updateRehearsalUi(ctx);
		ctx.ui.notify(`已进入对戏模式：${scene.name} · AI 扮演 ${aiCharacter.name}`, "info");
	};
	pi.registerCommand("对戏", {
		description: "进入角色扮演对戏模式（AI 扮演人物，你扮演任意角色）",
		handler: rehearsalCommand,
	});
	pi.registerCommand("roleplay", { description: "Enter roleplay rehearsal mode", handler: rehearsalCommand });

	const switchRoleHandler = async (args: string, ctx: ExtensionCommandContext) => {
		if (!rehearsal || rehearsal.cwd !== ctx.cwd) {
			ctx.ui.notify("当前不在对戏模式", "warning");
			return;
		}
		let roleName = args.trim();
		if (!roleName) {
			const characters = listEntities(ctx.cwd, "characters");
			const selected = await ctx.ui.select("切换扮演角色", [
				"旁白/自己",
				...characters.map((character) => `${character.id} - ${character.name}`),
			]);
			if (!selected) return;
			roleName = selected;
		}
		rehearsal.userRoleName = roleName === "旁白/自己" ? undefined : roleName;
		updateRehearsalUi(ctx);
		ctx.ui.notify(`你现在扮演：${rehearsal.userRoleName ?? "旁白/自己"}`, "info");
	};
	pi.registerCommand("扮演", { description: "切换你扮演的角色", handler: switchRoleHandler });
	pi.registerCommand("act-as", { description: "Switch the role you are playing", handler: switchRoleHandler });

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
	pi.registerCommand("对戏自动", { description: "切换自动成文", handler: autoProseHandler });

	const mergeProseHandler = async (args: string, ctx: ExtensionCommandContext) => {
		if (!rehearsal || rehearsal.cwd !== ctx.cwd) {
			ctx.ui.notify("当前不在对戏模式", "warning");
			return;
		}
		const chapterArg = args.trim();
		if (!chapterArg) {
			ctx.ui.notify("用法：/并入章节 <章节号或文件名>", "warning");
			return;
		}
		const prose = readProse(rehearsal.prosePath).trim();
		if (!prose) {
			ctx.ui.notify("排练稿还没有内容，先 /对戏成文", "warning");
			return;
		}
		try {
			const chapter = readChapter(ctx.cwd, chapterArg);
			const next = `${chapter.content.trimEnd()}\n\n${prose}\n`;
			saveSnapshot(ctx.cwd, {
				toolCallId: "command:merge-prose",
				action: "rewrite",
				path: chapter.path,
				oldContent: chapter.content,
			});
			rewriteChapter(ctx.cwd, next, chapter.file);
			ctx.ui.notify(`排练稿已并入 ${chapter.file}（${prose.length} 字）`, "info");
		} catch (error) {
			ctx.ui.notify(`并入章节失败：${error instanceof Error ? error.message : String(error)}`, "error");
		}
	};
	pi.registerCommand("并入章节", { description: "把排练稿并入指定章节", handler: mergeProseHandler });

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
	pi.registerCommand("规则", { description: "切换写作规则开关", handler: rulesHandler });
	pi.registerCommand("rules", { description: "Toggle writing rules", handler: rulesHandler });

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
	pi.registerCommand("破甲", { description: "切换系统提示词破甲模式", handler: armorHandler });

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

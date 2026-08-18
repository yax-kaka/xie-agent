import { readFileSync } from "node:fs";
import { join } from "node:path";
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
});

const UpdateEntitySchema = Type.Object({
	kind: CharacterOrScene,
	id: Type.String(),
	name: Type.Optional(Type.String()),
	tags: Type.Optional(Type.Array(Type.String())),
	body: Type.Optional(Type.String()),
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

	let systemPromptShown = false;
	pi.on("session_start", () => {
		systemPromptShown = false;
	});
	pi.on("before_agent_start", async (event, ctx) => {
		if (systemPromptShown || ctx.mode !== "tui") return;
		systemPromptShown = true;
		pi.appendEntry<{ text: string }>("system-prompt-preview", { text: event.systemPrompt });
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
			});
			return textResult(JSON.stringify(record, null, 2));
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

/**
 * Tavern 角色卡导入（兼容 Operit 2 的 extensions.operit.character_card 扩展字段）。
 */

export interface ImportedCharacter {
	name: string;
	body: string;
	opening: string;
	system: string;
	tags: string[];
}

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function textArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		.map((item) => item.trim());
}

function joinNonEmpty(parts: string[]): string {
	return parts.filter((part) => part.length > 0).join("\n\n");
}

interface OperitCardPayload {
	name?: string;
	description?: string;
	characterSetting?: string;
	openingStatement?: string;
	otherContent?: string;
	otherContentChat?: string;
	advancedCustomPrompt?: string;
}

function operitPayload(value: unknown): OperitCardPayload | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Record<string, unknown>;
	const card = record.character_card;
	if (typeof card !== "object" || card === null) return undefined;
	return card as OperitCardPayload;
}

export function parseTavernCard(content: string): ImportedCharacter {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error("角色卡不是有效的 JSON。");
	}
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error("角色卡格式不正确：缺少 data 字段。");
	}
	const record = parsed as Record<string, unknown>;
	const data = record.data;
	if (typeof data !== "object" || data === null) {
		throw new Error("角色卡格式不正确：缺少 data 字段。");
	}
	const d = data as Record<string, unknown>;

	const operit =
		record.extensions !== undefined && typeof record.extensions === "object"
			? operitPayload((record.extensions as Record<string, unknown>).operit)
			: undefined;

	const name = text(operit?.name) || text(d.name);
	if (!name) {
		throw new Error("角色卡缺少角色名称（data.name）。");
	}

	const plainBody = joinNonEmpty([
		text(d.description),
		text(d.personality),
		text(d.scenario),
		text(d.mes_example),
		text(d.creator_notes),
	]);
	const operitBody = joinNonEmpty([
		text(operit?.description),
		text(operit?.characterSetting),
		text(operit?.otherContent),
		text(operit?.otherContentChat),
	]);

	return {
		name,
		body: operitBody.length > 0 ? operitBody : plainBody,
		opening: text(operit?.openingStatement) || text(d.first_mes),
		system: joinNonEmpty([
			text(operit?.advancedCustomPrompt),
			text(d.system_prompt),
			text(d.post_history_instructions),
		]),
		tags: textArray(d.tags),
	};
}

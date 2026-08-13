import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readConstraint } from "./workspace.ts";

export interface WritingRule {
	id: string;
	name: string;
	text: string;
	defaultEnabled: boolean;
}

export interface EffectiveWritingRule {
	rule: WritingRule;
	enabled: boolean;
}

export const DEFAULT_WRITING_RULES: WritingRule[] = [
	{
		id: "hook",
		name: "章末钩子",
		defaultEnabled: true,
		text: "每章结尾停在未完成处并留钩子（反转/威胁/没说完的话/刚到来的人/悬念问题/即将发生而未发生的事）；禁止总结、点题、道理式收尾，禁止用闭合景色意象收束（如“把影子拉得老长”“太阳落下去”“笑声惊起一片鸟”“越走越亮”）。",
	},
	{
		id: "no-repeat",
		name: "禁止重复意象",
		defaultEnabled: true,
		text: "禁止复用前文已出现过的收尾意象和固定句式；影子、鸟、月光、灯、太阳、山风、笑声等不得重复用于收尾；控制“书呆子”“油嘴滑舌”“又笑作一团”“心怦怦跳”等口头禅重复。",
	},
	{
		id: "show-dont-tell",
		name: "动作化心理",
		defaultEnabled: true,
		text: "人物心理靠动作、表情、对话、环境反衬呈现，禁止“她这才明白”“这念头撑着她”“他心里想”式直接总结情绪。",
	},
	{
		id: "single-event",
		name: "单章单事件",
		defaultEnabled: true,
		text: "每章聚焦一个具体事件、一个具体场景，用动作和对话推进，不做“春夏秋冬”式时间蒙太奇收束；冲突不在一章内解决，至少留一事跨到下一章。",
	},
	{
		id: "limited-pov",
		name: "限知视角",
		defaultEnabled: true,
		text: "固定第三人称限知视角，切换人物视角需明确转场；禁止“而她不知道的是”式全知插入。",
	},
];

function rulesPath(cwd: string): string {
	return join(cwd, ".pi-xie", "writing-rules.json");
}

export function readRuleOverrides(cwd: string): Record<string, boolean> {
	const path = rulesPath(cwd);
	if (!existsSync(path)) return {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
		const result: Record<string, boolean> = {};
		for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
			if (typeof value === "boolean") result[key] = value;
		}
		return result;
	} catch {
		return {};
	}
}

function writeRuleOverrides(cwd: string, overrides: Record<string, boolean>): void {
	const path = rulesPath(cwd);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(overrides, null, 2)}\n`);
}

export function getEffectiveWritingRules(cwd: string): EffectiveWritingRule[] {
	const overrides = readRuleOverrides(cwd);
	return DEFAULT_WRITING_RULES.map((rule) => ({
		rule,
		enabled: overrides[rule.id] ?? rule.defaultEnabled,
	}));
}

export function setWritingRuleEnabled(cwd: string, id: string, enabled: boolean): EffectiveWritingRule | undefined {
	const rule = DEFAULT_WRITING_RULES.find((candidate) => candidate.id === id);
	if (!rule) return undefined;
	const overrides: Record<string, boolean> = {};
	for (const item of getEffectiveWritingRules(cwd)) {
		overrides[item.rule.id] = item.enabled;
	}
	overrides[id] = enabled;
	writeRuleOverrides(cwd, overrides);
	return { rule, enabled };
}

export function formatEnabledRulesForStyle(cwd: string): string {
	const enabled = getEffectiveWritingRules(cwd).filter((item) => item.enabled);
	if (enabled.length === 0) return "";
	const lines = enabled.map((item) => `- ${item.rule.name}：${item.rule.text}`);
	return `\n\n写作规则（可在 /规则 中逐条开关）：\n${lines.join("\n")}`;
}

export function getEffectiveStyleText(cwd: string): string {
	const base = readConstraint(cwd, "style");
	const rules = formatEnabledRulesForStyle(cwd);
	return rules ? `${base}${rules}` : base;
}

export function parseEnabledState(value: string): boolean | undefined {
	switch (value.toLowerCase()) {
		case "开":
		case "on":
		case "1":
		case "true":
		case "enable":
		case "enabled":
			return true;
		case "关":
		case "off":
		case "0":
		case "false":
		case "disable":
		case "disabled":
			return false;
		default:
			return undefined;
	}
}

export interface RuleToggleArgs {
	target: string;
	enabled: boolean;
}

export function parseRuleToggleArgs(args: string): RuleToggleArgs | undefined {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	if (parts.length !== 2) return undefined;
	const enabled = parseEnabledState(parts[1]);
	if (enabled === undefined) return undefined;
	return { target: parts[0], enabled };
}

export function resolveRuleId(target: string): string | undefined {
	const trimmed = target.trim();
	const byIndex = Number(trimmed);
	if (Number.isInteger(byIndex) && byIndex >= 1 && byIndex <= DEFAULT_WRITING_RULES.length) {
		return DEFAULT_WRITING_RULES[byIndex - 1].id;
	}
	const lower = trimmed.toLowerCase();
	return DEFAULT_WRITING_RULES.find((rule) => rule.id.toLowerCase() === lower || rule.name.toLowerCase() === lower)
		?.id;
}

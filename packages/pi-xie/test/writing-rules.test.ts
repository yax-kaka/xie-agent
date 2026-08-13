import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	DEFAULT_WRITING_RULES,
	formatEnabledRulesForStyle,
	getEffectiveStyleText,
	getEffectiveWritingRules,
	parseEnabledState,
	parseRuleToggleArgs,
	resolveRuleId,
	setWritingRuleEnabled,
} from "../src/extensions/pi-xie/writing-rules.ts";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-xie-writing-rules-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function writeStyle(content: string): void {
	const path = join(dir, "premises", "style.md");
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

function disableAllRules(): void {
	for (const rule of DEFAULT_WRITING_RULES) {
		setWritingRuleEnabled(dir, rule.id, false);
	}
}

describe("writing rules", () => {
	test("defaults every rule to enabled when no override exists", () => {
		expect(getEffectiveWritingRules(dir)).toHaveLength(DEFAULT_WRITING_RULES.length);
		expect(getEffectiveWritingRules(dir).every((item) => item.enabled)).toBe(true);
	});

	test("persists a single rule toggle", () => {
		setWritingRuleEnabled(dir, "hook", false);

		const effective = getEffectiveWritingRules(dir);
		expect(effective.find((item) => item.rule.id === "hook")?.enabled).toBe(false);
		expect(effective.filter((item) => item.enabled)).toHaveLength(DEFAULT_WRITING_RULES.length - 1);

		const saved = JSON.parse(readFileSync(join(dir, ".pi-xie", "writing-rules.json"), "utf8")) as Record<
			string,
			boolean
		>;
		expect(saved.hook).toBe(false);
	});

	test("formats only enabled rules and returns empty when all are disabled", () => {
		expect(formatEnabledRulesForStyle(dir)).toContain("写作规则（可在 /规则 中逐条开关）");
		expect(formatEnabledRulesForStyle(dir)).toContain("- 章末钩子：");

		disableAllRules();
		expect(formatEnabledRulesForStyle(dir)).toBe("");
	});

	test("appends enabled rules to the base style text", () => {
		writeStyle("乡土叙事，克制有力量。");
		const text = getEffectiveStyleText(dir);

		expect(text).toContain("乡土叙事，克制有力量。");
		expect(text).toContain("写作规则（可在 /规则 中逐条开关）");

		disableAllRules();
		expect(getEffectiveStyleText(dir)).toBe("乡土叙事，克制有力量。");
	});

	test("parses enabled state values", () => {
		expect(parseEnabledState("开")).toBe(true);
		expect(parseEnabledState("OFF")).toBe(false);
		expect(parseEnabledState("1")).toBe(true);
		expect(parseEnabledState("disabled")).toBe(false);
		expect(parseEnabledState("maybe")).toBeUndefined();
	});

	test("parses quick toggle arguments", () => {
		expect(parseRuleToggleArgs("2 关")).toEqual({ target: "2", enabled: false });
		expect(parseRuleToggleArgs("钩子 on")).toEqual({ target: "钩子", enabled: true });
		expect(parseRuleToggleArgs("hook")).toBeUndefined();
	});

	test("resolves rule ids by index, id, and name", () => {
		expect(resolveRuleId("1")).toBe("hook");
		expect(resolveRuleId("hook")).toBe("hook");
		expect(resolveRuleId("章末钩子")).toBe("hook");
		expect(resolveRuleId("99")).toBeUndefined();
		expect(resolveRuleId("nope")).toBeUndefined();
	});
});

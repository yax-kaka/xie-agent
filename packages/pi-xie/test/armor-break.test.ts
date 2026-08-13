import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { isArmorBreakEnabled, setArmorBreakEnabled } from "../src/core/armor-break.ts";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-xie-armor-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function armorPath(): string {
	return join(dir, ".pi-xie", "armor.json");
}

describe("armor break flag", () => {
	test("defaults to disabled", () => {
		expect(isArmorBreakEnabled(dir)).toBe(false);
	});

	test("persists an enabled state", () => {
		setArmorBreakEnabled(dir, true);
		expect(isArmorBreakEnabled(dir)).toBe(true);

		const saved = JSON.parse(readFileSync(armorPath(), "utf8")) as { enabled: boolean };
		expect(saved.enabled).toBe(true);
	});

	test("persists a disabled state after enabling", () => {
		setArmorBreakEnabled(dir, true);
		setArmorBreakEnabled(dir, false);
		expect(isArmorBreakEnabled(dir)).toBe(false);
	});

	test("treats a malformed file as disabled", () => {
		mkdirSync(dirname(armorPath()), { recursive: true });
		writeFileSync(armorPath(), "{not json");
		expect(isArmorBreakEnabled(dir)).toBe(false);
	});
});

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { isAutoWriteEnabled, setAutoWriteEnabled } from "../src/extensions/pi-xie/permissions.ts";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-xie-permissions-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function permissionsPath(): string {
	return join(dir, ".pi-xie", "permissions.json");
}

describe("auto write permission", () => {
	test("defaults to disabled", () => {
		expect(isAutoWriteEnabled(dir)).toBe(false);
	});

	test("persists an enabled state", () => {
		setAutoWriteEnabled(dir, true);
		expect(isAutoWriteEnabled(dir)).toBe(true);

		const saved = JSON.parse(readFileSync(permissionsPath(), "utf8")) as { autoWrite: boolean };
		expect(saved.autoWrite).toBe(true);
	});

	test("persists a disabled state after enabling", () => {
		setAutoWriteEnabled(dir, true);
		setAutoWriteEnabled(dir, false);
		expect(isAutoWriteEnabled(dir)).toBe(false);
	});

	test("treats a malformed file as disabled", () => {
		mkdirSync(dirname(permissionsPath()), { recursive: true });
		writeFileSync(permissionsPath(), "{not json");
		expect(isAutoWriteEnabled(dir)).toBe(false);
	});
});

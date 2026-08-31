import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	createEntity,
	deleteEntity,
	getActive,
	getManuscriptPath,
	listChapters,
	readConstraint,
	rebuildManuscript,
	rewriteChapter,
	saveSnapshot,
	selectPremises,
	undoLast,
	updateEntity,
	writeChapter,
	writeConstraint,
} from "../src/extensions/pi-xie/workspace.ts";

let cwd: string;

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "pi-xie-workspace-"));
});

afterEach(() => {
	// Best effort cleanup; the OS temp directory can also collect leftovers.
});

describe("pi-xie workspace", () => {
	test("creates, updates, and deletes characters and scenes", () => {
		const character = createEntity(cwd, "characters", {
			name: "Lin",
			body: "A quiet protagonist.",
		});
		const scene = createEntity(cwd, "scenes", {
			name: "Old Street",
			body: "Rainy street at night.",
		});

		expect(character.id).toMatch(/lin/);
		expect(scene.id).toMatch(/old-street/);

		const updated = updateEntity(cwd, "characters", character.id, { body: "A quiet but stubborn protagonist." });
		expect(updated.body).toContain("stubborn");

		deleteEntity(cwd, "scenes", scene.id);
	});

	test("selects active premises and reads constraints", () => {
		const character = createEntity(cwd, "characters", { name: "Lin", body: "Hero" });
		const scene = createEntity(cwd, "scenes", { name: "City", body: "Setting" });
		selectPremises(cwd, { characters: [character.id], scenes: [scene.id] });
		expect(getActive(cwd)).toEqual({ characters: [character.id], scenes: [scene.id] });

		writeConstraint(cwd, "style", "Calm, restrained prose.");
		expect(readConstraint(cwd, "style")).toContain("restrained");
	});

	test("writes and rewrites chapters with undo snapshots", () => {
		const first = writeChapter(cwd, "Chapter one text.");
		expect(first.number).toBe(1);
		expect(listChapters(cwd)).toHaveLength(1);

		saveSnapshot(cwd, {
			toolCallId: "t1",
			action: "rewrite",
			path: first.path,
			oldContent: readFileSync(first.path, "utf8"),
		});
		rewriteChapter(cwd, "Chapter one rewritten.", "1");
		expect(readFileSync(first.path, "utf8")).toContain("rewritten");

		const restored = undoLast(cwd);
		expect(restored?.action).toBe("rewrite");
		expect(readFileSync(first.path, "utf8")).toBe("Chapter one text.\n");
	});

	test("maintains manuscript.txt with append and replace", () => {
		const first = writeChapter(cwd, "Chapter one text.");
		writeChapter(cwd, "Chapter two text.");

		const manuscript = readFileSync(getManuscriptPath(cwd), "utf8");
		expect(manuscript).toContain("第1章\n\nChapter one text.");
		expect(manuscript).toContain("第2章\n\nChapter two text.");
		expect(manuscript.match(/第1章/g)).toHaveLength(1);
		expect(manuscript.match(/第2章/g)).toHaveLength(1);

		rewriteChapter(cwd, "Chapter two rewritten.", "2");
		const rewritten = readFileSync(getManuscriptPath(cwd), "utf8");
		expect(rewritten).toContain("Chapter two rewritten.");
		expect(rewritten).not.toContain("Chapter two text.");
		expect(rewritten.match(/第2章/g)).toHaveLength(1);
		expect(first.content).toBe("Chapter one text.");
	});

	test("rebuilds manuscript from chapter files", () => {
		writeChapter(cwd, "A");
		writeChapter(cwd, "B");
		const path = rebuildManuscript(cwd);
		const manuscript = readFileSync(path, "utf8");
		expect(manuscript).toContain("第1章\n\nA");
		expect(manuscript).toContain("第2章\n\nB");
	});
});

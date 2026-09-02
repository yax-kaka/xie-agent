import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type EntityKind = "characters" | "scenes";

export interface EntityMeta {
	id: string;
	name: string;
	tags: string[];
	updatedAt: string;
	kind: EntityKind;
	/** 开场白：进入对戏时子代理的自我介绍或场景开场。 */
	opening?: string;
	/** 高级自定义提示词：追加到角色卡之后、世界设定之前。 */
	system?: string;
}

export interface EntityRecord extends EntityMeta {
	body: string;
	/** 开场白：进入对戏时子代理的自我介绍或场景开场。 */
	opening: string;
	/** 高级自定义提示词：追加到角色卡之后、世界设定之前。 */
	system: string;
	path: string;
}

export interface ActivePremises {
	characters: string[];
	scenes: string[];
}

export interface ChapterInfo {
	number: number;
	file: string;
	path: string;
	content: string;
}

export interface UndoSnapshot {
	toolCallId: string;
	action: "create" | "update" | "delete" | "write" | "rewrite" | "constraint" | "active";
	path: string;
	oldContent: string | null;
}

function workspaceDir(cwd: string): string {
	return join(cwd, "premises");
}

function entityDir(cwd: string, kind: EntityKind): string {
	return join(workspaceDir(cwd), kind);
}

function chaptersDir(cwd: string): string {
	return join(cwd, "chapters");
}

function activePath(cwd: string): string {
	return join(workspaceDir(cwd), "active.json");
}

function manuscriptPath(cwd: string): string {
	return join(cwd, "manuscript.txt");
}

function undoDir(cwd: string): string {
	return join(cwd, ".pi-xie", "undo");
}

function undoLastPath(cwd: string): string {
	return join(undoDir(cwd), "last.json");
}

function slugify(value: string): string {
	const slug = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || randomUUID();
}

function encodeFrontmatter(meta: EntityMeta, body: string): string {
	return `---\n${JSON.stringify(meta, null, 2)}\n---\n${body.trim()}\n`;
}

function decodeFrontmatter(content: string): { meta: EntityMeta; body: string } | undefined {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return undefined;
	try {
		const meta = JSON.parse(match[1]) as EntityMeta;
		return { meta, body: match[2].trim() };
	} catch {
		return undefined;
	}
}

export function ensureWorkspace(cwd: string): void {
	mkdirSync(workspaceDir(cwd), { recursive: true });
	mkdirSync(entityDir(cwd, "characters"), { recursive: true });
	mkdirSync(entityDir(cwd, "scenes"), { recursive: true });
	mkdirSync(chaptersDir(cwd), { recursive: true });
	mkdirSync(undoDir(cwd), { recursive: true });
	if (!existsSync(activePath(cwd))) {
		writeFileSync(activePath(cwd), JSON.stringify({ characters: [], scenes: [] }, null, 2));
	}
	for (const constraint of ["worldview", "outline", "timeline", "style"]) {
		const path = join(workspaceDir(cwd), `${constraint}.md`);
		if (!existsSync(path)) writeFileSync(path, "");
	}
	if (!existsSync(manuscriptPath(cwd))) {
		rebuildManuscript(cwd);
	}
}

function uniqueId(base: string, dir: string): string {
	const root = slugify(base);
	let candidate = root;
	let suffix = 2;
	while (existsSync(join(dir, `${candidate}.md`))) {
		candidate = `${root}-${suffix++}`;
	}
	return candidate;
}

function entityPath(cwd: string, kind: EntityKind, id: string): string {
	return join(entityDir(cwd, kind), `${slugify(id)}.md`);
}

export function listEntities(cwd: string, kind: EntityKind): EntityRecord[] {
	const dir = entityDir(cwd, kind);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((file) => file.endsWith(".md"))
		.map((file) => {
			const path = join(dir, file);
			const content = readFileSync(path, "utf8");
			const decoded = decodeFrontmatter(content);
			if (!decoded) return undefined;
			return {
				...decoded.meta,
				kind,
				body: decoded.body,
				opening: decoded.meta.opening ?? "",
				system: decoded.meta.system ?? "",
				path,
			};
		})
		.filter((entity): entity is EntityRecord => entity !== undefined)
		.sort((a, b) => a.id.localeCompare(b.id));
}

export function getEntity(cwd: string, kind: EntityKind, id: string): EntityRecord {
	const path = entityPath(cwd, kind, id);
	if (!existsSync(path)) throw new Error(`Unknown ${kind.slice(0, -1)}: ${id}`);
	const content = readFileSync(path, "utf8");
	const decoded = decodeFrontmatter(content);
	if (!decoded) throw new Error(`Invalid entity file: ${path}`);
	return {
		...decoded.meta,
		kind,
		body: decoded.body,
		opening: decoded.meta.opening ?? "",
		system: decoded.meta.system ?? "",
		path,
	};
}

export function createEntity(
	cwd: string,
	kind: EntityKind,
	input: { id?: string; name: string; tags?: string[]; body: string; opening?: string; system?: string },
): EntityRecord {
	const dir = entityDir(cwd, kind);
	mkdirSync(dir, { recursive: true });
	const id = uniqueId(input.id || input.name, dir);
	const record: EntityRecord = {
		id,
		name: input.name.trim(),
		tags: input.tags ?? [],
		updatedAt: new Date().toISOString(),
		kind,
		body: input.body,
		opening: input.opening ?? "",
		system: input.system ?? "",
		path: join(dir, `${id}.md`),
	};
	writeFileSync(record.path, encodeFrontmatter(record, record.body));
	return record;
}

export function updateEntity(
	cwd: string,
	kind: EntityKind,
	id: string,
	input: { name?: string; tags?: string[]; body?: string; opening?: string; system?: string },
): EntityRecord {
	const existing = getEntity(cwd, kind, id);
	const next: EntityRecord = {
		...existing,
		name: input.name?.trim() || existing.name,
		tags: input.tags ?? existing.tags,
		updatedAt: new Date().toISOString(),
		body: input.body ?? existing.body,
		opening: input.opening ?? existing.opening,
		system: input.system ?? existing.system,
		path: existing.path,
	};
	writeFileSync(next.path, encodeFrontmatter(next, next.body));
	return next;
}

export function deleteEntity(cwd: string, kind: EntityKind, id: string): string {
	const path = entityPath(cwd, kind, id);
	if (!existsSync(path)) throw new Error(`Unknown ${kind.slice(0, -1)}: ${id}`);
	rmSync(path);
	return path;
}

export function getActive(cwd: string): ActivePremises {
	if (!existsSync(activePath(cwd))) return { characters: [], scenes: [] };
	try {
		const parsed = JSON.parse(readFileSync(activePath(cwd), "utf8")) as Partial<ActivePremises>;
		return { characters: parsed.characters ?? [], scenes: parsed.scenes ?? [] };
	} catch {
		return { characters: [], scenes: [] };
	}
}

export function selectPremises(cwd: string, premises: ActivePremises): ActivePremises {
	ensureWorkspace(cwd);
	writeFileSync(activePath(cwd), JSON.stringify(premises, null, 2));
	return premises;
}

export function readConstraint(cwd: string, name: "worldview" | "outline" | "timeline" | "style"): string {
	const path = join(workspaceDir(cwd), `${name}.md`);
	return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export function writeConstraint(
	cwd: string,
	name: "worldview" | "outline" | "timeline" | "style",
	content: string,
): string {
	ensureWorkspace(cwd);
	const path = join(workspaceDir(cwd), `${name}.md`);
	writeFileSync(path, content.trimEnd() + "\n");
	return path;
}

function chapterNumberFromString(value: string): number | undefined {
	const match = value.match(/(\d+)/);
	return match ? Number(match[1]) : undefined;
}

function chapterFile(cwd: string, chapter: string | number | undefined, next: boolean): string {
	const dir = chaptersDir(cwd);
	if (next || chapter === undefined) {
		const existing = listChapters(cwd);
		const number = existing.length > 0 ? Math.max(...existing.map((chapter) => chapter.number)) + 1 : 1;
		return join(dir, `${String(number).padStart(3, "0")}.md`);
	}
	const number = typeof chapter === "number" ? chapter : chapterNumberFromString(String(chapter));
	if (number === undefined) throw new Error(`Invalid chapter: ${chapter}`);
	return join(dir, `${String(number).padStart(3, "0")}.md`);
}

export function listChapters(cwd: string): ChapterInfo[] {
	const dir = chaptersDir(cwd);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((file) => file.endsWith(".md"))
		.map((file) => {
			const number = Number(file.replace(/\.md$/, "").replace(/\D/g, ""));
			const path = join(dir, file);
			return {
				number,
				file,
				path,
				content: readFileSync(path, "utf8"),
			};
		})
		.filter((chapter) => Number.isFinite(chapter.number))
		.sort((a, b) => a.number - b.number);
}

export function writeChapter(cwd: string, content: string, chapter?: string): ChapterInfo {
	ensureWorkspace(cwd);
	const path = chapterFile(cwd, chapter, chapter === undefined);
	if (existsSync(path)) throw new Error(`Chapter already exists: ${path}`);
	writeFileSync(path, content.trimEnd() + "\n");
	const number = Number(path.match(/(\d+)\.md$/)?.[1] ?? 1);
	const record: ChapterInfo = { number, file: path.split(/[\\/]/).pop() ?? path, path, content };
	syncManuscript(cwd, record, "append");
	return record;
}

export function rewriteChapter(cwd: string, content: string, chapter: string): ChapterInfo {
	ensureWorkspace(cwd);
	const path = chapterFile(cwd, chapter, false);
	if (!existsSync(path)) throw new Error(`Chapter not found: ${path}`);
	writeFileSync(path, content.trimEnd() + "\n");
	const number = Number(path.match(/(\d+)\.md$/)?.[1] ?? 1);
	const record: ChapterInfo = { number, file: path.split(/[\\/]/).pop() ?? path, path, content };
	syncManuscript(cwd, record, "replace");
	return record;
}

export function readChapter(cwd: string, chapter: string): ChapterInfo {
	const path = chapterFile(cwd, chapter, false);
	if (!existsSync(path)) throw new Error(`Chapter not found: ${path}`);
	const number = Number(path.match(/(\d+)\.md$/)?.[1] ?? 1);
	return { number, file: path.split(/[\\/]/).pop() ?? path, path, content: readFileSync(path, "utf8") };
}

export function saveSnapshot(cwd: string, snapshot: UndoSnapshot): void {
	mkdirSync(undoDir(cwd), { recursive: true });
	writeFileSync(undoLastPath(cwd), JSON.stringify(snapshot, null, 2));
}

function chapterBlock(chapter: ChapterInfo): string {
	return `第${chapter.number}章\n\n${chapter.content.trimEnd()}\n\n`;
}

function parseManuscriptBlocks(text: string): Array<{ number: number; block: string }> {
	const blocks: Array<{ number: number; block: string }> = [];
	const headerPattern = /第(\d+)章\n\n/g;
	const matches: Array<{ index: number; header: string; number: number }> = [];
	for (;;) {
		const match = headerPattern.exec(text);
		if (match === null) break;
		matches.push({ index: match.index, header: match[0], number: Number(match[1]) });
	}
	for (let index = 0; index < matches.length; index++) {
		const start = matches[index].index + matches[index].header.length;
		const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
		const content = text.slice(start, end).replace(/^\n+|\n+$/g, "");
		blocks.push({
			number: matches[index].number,
			block: chapterBlock({
				number: matches[index].number,
				file: "",
				path: "",
				content,
			}),
		});
	}
	return blocks;
}

function writeManuscriptBlocks(cwd: string, blocks: Array<{ number: number; block: string }>): void {
	const sorted = [...blocks].sort((a, b) => a.number - b.number);
	writeFileSync(manuscriptPath(cwd), sorted.map((entry) => entry.block).join(""));
}

export function getManuscriptPath(cwd: string): string {
	return manuscriptPath(cwd);
}

export function rebuildManuscript(cwd: string): string {
	const chapters = listChapters(cwd);
	const blocks = chapters.map((chapter) => ({ number: chapter.number, block: chapterBlock(chapter) }));
	writeManuscriptBlocks(cwd, blocks);
	return manuscriptPath(cwd);
}

export function syncManuscript(cwd: string, chapter: ChapterInfo, mode: "append" | "replace"): string {
	const path = manuscriptPath(cwd);
	if (!existsSync(path) || readFileSync(path, "utf8").trim() === "") {
		writeManuscriptBlocks(cwd, [{ number: chapter.number, block: chapterBlock(chapter) }]);
		return path;
	}

	const current = parseManuscriptBlocks(readFileSync(path, "utf8"));
	const existingIndex = current.findIndex((entry) => entry.number === chapter.number);

	if (existingIndex >= 0) {
		current[existingIndex] = { number: chapter.number, block: chapterBlock(chapter) };
		writeManuscriptBlocks(cwd, current);
		return path;
	}

	if (
		mode === "append" &&
		(current.length === 0 || chapter.number > Math.max(...current.map((entry) => entry.number)))
	) {
		writeFileSync(path, readFileSync(path, "utf8").replace(/\n+$/, "") + "\n\n" + chapterBlock(chapter));
		return path;
	}

	current.push({ number: chapter.number, block: chapterBlock(chapter) });
	writeManuscriptBlocks(cwd, current);
	return path;
}

export function undoLast(cwd: string): UndoSnapshot | undefined {
	const path = undoLastPath(cwd);
	if (!existsSync(path)) return undefined;
	const snapshot = JSON.parse(readFileSync(path, "utf8")) as UndoSnapshot;
	if (snapshot.action === "create") {
		if (existsSync(snapshot.path)) rmSync(snapshot.path);
	} else if (snapshot.oldContent === null) {
		if (existsSync(snapshot.path)) rmSync(snapshot.path);
	} else {
		mkdirSync(dirname(snapshot.path), { recursive: true });
		writeFileSync(snapshot.path, snapshot.oldContent);
	}
	if (snapshot.action === "write" || snapshot.action === "rewrite") {
		rebuildManuscript(cwd);
	}
	rmSync(path);
	return snapshot;
}

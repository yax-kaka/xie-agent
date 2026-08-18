import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

function permissionsPath(cwd: string): string {
	return join(cwd, ".pi-xie", "permissions.json");
}

export function isAutoWriteEnabled(cwd: string): boolean {
	const path = permissionsPath(cwd);
	if (!existsSync(path)) return false;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			const enabled = (parsed as Record<string, unknown>).autoWrite;
			if (typeof enabled === "boolean") return enabled;
		}
		return false;
	} catch {
		return false;
	}
}

export function setAutoWriteEnabled(cwd: string, enabled: boolean): void {
	const path = permissionsPath(cwd);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ autoWrite: enabled }, null, 2)}\n`);
}

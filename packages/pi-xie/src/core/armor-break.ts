import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

function armorBreakPath(cwd: string): string {
	return join(cwd, ".pi-xie", "armor.json");
}

export function isArmorBreakEnabled(cwd: string): boolean {
	const path = armorBreakPath(cwd);
	if (!existsSync(path)) return false;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			const enabled = (parsed as Record<string, unknown>).enabled;
			if (typeof enabled === "boolean") return enabled;
		}
		return false;
	} catch {
		return false;
	}
}

export function setArmorBreakEnabled(cwd: string, enabled: boolean): void {
	const path = armorBreakPath(cwd);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ enabled }, null, 2)}\n`);
}

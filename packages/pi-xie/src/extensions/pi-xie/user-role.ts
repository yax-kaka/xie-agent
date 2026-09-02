import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** 项目级「用户默认扮演角色」配置（自动选角时使用，手动选择不受影响）。 */

function configPath(cwd: string): string {
	return join(cwd, ".pi-xie", "user-role.json");
}

export function getDefaultUserRole(cwd: string): string | undefined {
	const path = configPath(cwd);
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			const roleId = (parsed as Record<string, unknown>).roleId;
			if (typeof roleId === "string" && roleId.trim()) return roleId.trim();
		}
		return undefined;
	} catch {
		return undefined;
	}
}

/** roleId 传 undefined/null 表示清空（回到 AI 自动判断用户角色）。 */
export function setDefaultUserRole(cwd: string, roleId: string | undefined): void {
	const path = configPath(cwd);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ roleId: roleId ?? null }, null, 2)}\n`);
}

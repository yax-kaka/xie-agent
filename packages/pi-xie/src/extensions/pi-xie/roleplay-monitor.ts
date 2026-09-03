/**
 * 角色 agent 监视面板（Claude Code 式）：全屏组件，
 * ↑/↓ 切换角色，Esc/Q 关闭；实时显示选中角色的流式输出与状态。
 */

import { matchesKey, sliceByColumn } from "@earendil-works/pi-tui";
import type { Theme } from "../../modes/interactive/theme/theme.ts";

export interface RoleplayMonitorCharacter {
	id: string;
	name: string;
	status: "idle" | "thinking" | "speaking";
	stream: string;
}

export interface RoleplayMonitorComponent {
	handleInput(data: string): void;
	render(width: number): string[];
	invalidate(): void;
	dispose(): void;
}

export function createRoleplayMonitorComponent(
	tui: { requestRender: () => void },
	theme: Theme,
	getCharacters: () => RoleplayMonitorCharacter[],
	done: () => void,
): RoleplayMonitorComponent {
	let selectedIndex = 0;
	let disposed = false;
	const interval = setInterval(() => {
		if (!disposed) tui.requestRender();
	}, 100);

	const statusLabel = (status: RoleplayMonitorCharacter["status"]): string =>
		status === "thinking" ? "思考中" : status === "speaking" ? "回应中" : "空闲";

	return {
		handleInput(data: string): void {
			const characters = getCharacters();
			if (matchesKey(data, "escape") || data === "q" || data === "Q") {
				disposed = true;
				clearInterval(interval);
				done();
				return;
			}
			if (matchesKey(data, "up")) {
				selectedIndex = Math.max(0, selectedIndex - 1);
			} else if (matchesKey(data, "down")) {
				selectedIndex = Math.min(characters.length - 1, selectedIndex + 1);
			}
		},
		render(width: number): string[] {
			const characters = getCharacters();
			if (selectedIndex >= characters.length) selectedIndex = Math.max(0, characters.length - 1);
			const dim = (s: string) => theme.fg("dim", s);
			const accent = (s: string) => theme.fg("accent", s);
			const lines: string[] = [accent(`角色 agent 监视 · ↑/↓ 切换 · Esc 关闭`)];
			for (const [index, character] of characters.entries()) {
				const marker = index === selectedIndex ? "▶" : " ";
				lines.push(dim(`${marker} ${character.name} · ${statusLabel(character.status)}`));
			}
			const selected = characters[selectedIndex];
			if (selected) {
				lines.push(dim("─".repeat(Math.max(8, Math.min(width - 2, 40)))));
				const stream = selected.stream.trim();
				const tail = stream ? stream.split(/\r?\n/).slice(-14) : ["（暂无输出）"];
				lines.push(accent(`[${selected.name}] · ${statusLabel(selected.status)}`));
				for (const line of tail) {
					lines.push(dim(`│ ${line}`));
				}
			}
			const maxWidth = Math.max(20, width);
			return lines.map((line) => sliceByColumn(line, 0, maxWidth, true));
		},
		invalidate(): void {
			// 无缓存，无需失效逻辑
		},
		dispose(): void {
			disposed = true;
			clearInterval(interval);
		},
	};
}

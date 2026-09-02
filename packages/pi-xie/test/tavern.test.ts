import { describe, expect, test } from "vitest";
import { parseTavernCard } from "../src/extensions/pi-xie/tavern.ts";

describe("parseTavernCard", () => {
	test("maps a plain Tavern card to entity fields", () => {
		const card = parseTavernCard(
			JSON.stringify({
				spec: "chara_card_v2",
				spec_version: "2.0",
				data: {
					name: "林晚",
					description: "女主角，医学生。",
					personality: "冷静、敏锐，偶尔毒舌。",
					scenario: "深夜急诊室。",
					first_mes: "你醒了？",
					mes_example: "<START>\n{{char}}: 别动，伤口还没处理完。\n",
					system_prompt: "你只以角色身份说话。",
					post_history_instructions: "不要替用户说话。",
					tags: ["现代", "医疗", ""],
					creator_notes: "来自示例卡。",
				},
			}),
		);

		expect(card.name).toBe("林晚");
		expect(card.opening).toBe("你醒了？");
		expect(card.system).toBe("你只以角色身份说话。\n\n不要替用户说话。");
		expect(card.tags).toEqual(["现代", "医疗"]);
		expect(card.body).toContain("女主角，医学生。");
		expect(card.body).toContain("深夜急诊室。");
		expect(card.body).toContain("来自示例卡。");
	});

	test("prefers the Operit extension payload when present", () => {
		const card = parseTavernCard(
			JSON.stringify({
				data: {
					name: "旧名字",
					description: "旧描述",
					first_mes: "旧开场",
				},
				extensions: {
					operit: {
						character_card: {
							name: "顾辞",
							characterSetting: "古代剑客，寡言。",
							openingStatement: "雨停之前，别出这条巷子。",
							advancedCustomPrompt: "每句话不超过 20 字。",
							otherContentChat: "聊天补充设定。",
						},
					},
				},
			}),
		);

		expect(card.name).toBe("顾辞");
		expect(card.opening).toBe("雨停之前，别出这条巷子。");
		expect(card.system).toContain("每句话不超过 20 字。");
		expect(card.body).toContain("古代剑客，寡言。");
		expect(card.body).toContain("聊天补充设定。");
	});

	test("throws when the card has no name", () => {
		expect(() => parseTavernCard(JSON.stringify({ data: { description: "没有名字" } }))).toThrow("缺少角色名称");
	});

	test("throws on invalid JSON", () => {
		expect(() => parseTavernCard("not-json")).toThrow("不是有效的 JSON");
	});

	test("throws when data is missing", () => {
		expect(() => parseTavernCard(JSON.stringify({ spec: "chara_card_v2" }))).toThrow("缺少 data 字段");
	});
});

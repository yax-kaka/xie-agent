package com.ai.assistance.operit.pixie.workspace

import com.google.gson.JsonElement
import com.google.gson.JsonParser

/**
 * Tavern 角色卡导入：与电脑 pi-xie 的 tavern.ts 行为一致
 * （兼容 Operit 2 的 extensions.operit.character_card 扩展字段）。
 */
object TavernCard {

    data class ImportedCharacter(
        val name: String,
        val body: String,
        val opening: String,
        val system: String,
        val tags: List<String>,
    )

    fun parse(content: String): ImportedCharacter {
        val parsed: JsonElement = try {
            JsonParser.parseString(content)
        } catch (e: Exception) {
            throw IllegalArgumentException("角色卡不是有效的 JSON。")
        }
        if (!parsed.isJsonObject) {
            throw IllegalArgumentException("角色卡格式不正确：缺少 data 字段。")
        }
        val record = parsed.asJsonObject
        val data = record.get("data")?.takeIf { it.isJsonObject }?.asJsonObject
            ?: throw IllegalArgumentException("角色卡格式不正确：缺少 data 字段。")

        val operit = record.get("extensions")?.takeIf { it.isJsonObject }?.asJsonObject
            ?.get("operit")?.takeIf { it.isJsonObject }?.asJsonObject
            ?.get("character_card")?.takeIf { it.isJsonObject }?.asJsonObject

        val name = text(operit?.get("name")) ?: text(data.get("name"))
        if (name.isNullOrEmpty()) {
            throw IllegalArgumentException("角色卡缺少角色名称（data.name）。")
        }

        val plainBody = joinNonEmpty(
            listOf(
                text(data.get("description")),
                text(data.get("personality")),
                text(data.get("scenario")),
                text(data.get("mes_example")),
                text(data.get("creator_notes")),
            ),
        )
        val operitBody = joinNonEmpty(
            listOf(
                text(operit?.get("description")),
                text(operit?.get("characterSetting")),
                text(operit?.get("otherContent")),
                text(operit?.get("otherContentChat")),
            ),
        )

        return ImportedCharacter(
            name = name,
            body = if (operitBody.isNotEmpty()) operitBody else plainBody,
            opening = text(operit?.get("openingStatement")) ?: text(data.get("first_mes")).orEmpty(),
            system = joinNonEmpty(
                listOf(
                    text(operit?.get("advancedCustomPrompt")),
                    text(data.get("system_prompt")),
                    text(data.get("post_history_instructions")),
                ),
            ),
            tags = data.get("tags")?.takeIf { it.isJsonArray }?.asJsonArray
                ?.mapNotNull { element ->
                    element.takeIf { it.isJsonPrimitive }?.asString?.trim()?.takeIf { it.isNotEmpty() }
                }
                ?: emptyList(),
        )
    }

    private fun text(element: JsonElement?): String? =
        element?.takeIf { it.isJsonPrimitive }?.asString?.trim()?.takeIf { it.isNotEmpty() }

    private fun joinNonEmpty(parts: List<String?>): String =
        parts.filterNotNull().filter { it.isNotEmpty() }.joinToString("\n\n")
}

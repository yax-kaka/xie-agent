package com.ai.assistance.operit.pixie.workspace

import java.io.File

/**
 * 对戏记录文件（premises/rehearsals/ 下的 .md）的 Kotlin 移植，格式与 pi-xie 一致：
 * - 段分隔 "\n---\n"；段头注释 "# 起始：..." 与 "# 顺序：id1,id2"；
 * - 台词行 "[角色] 文本" / "[user:角色] 文本"；
 * - 单角色保持旧命名 <scene>-<ai>.md，多角色按 id 排序拼接 <scene>-<ai1>-<ai2>.md；
 * - 成文排练稿在 premises/rehearsals/prose/ 下。
 */

data class RoleLine(
    val speaker: String,
    val text: String,
    val user: Boolean,
)

object RehearsalRecord {

    const val SEGMENT_SEPARATOR = "\n---\n"
    const val SCENE_START_PREFIX = "# 起始："
    const val ORDER_PREFIX = "# 顺序："

    fun rehearsalDir(cwd: File): File = File(cwd, "premises/rehearsals")

    fun fileStem(value: String): String {
        return value
            .trim()
            .lowercase()
            .replace(Regex("[^a-z0-9\\u4e00-\\u9fff]+"), "-")
            .replace(Regex("^-+|-+$"), "")
            .ifEmpty { "unnamed" }
    }

    fun recordPathFor(cwd: File, sceneId: String, aiCharacterIds: List<String>): File {
        return File(rehearsalDir(cwd), "${fileStem(sceneId)}-${participantStem(aiCharacterIds)}.md")
    }

    fun prosePathFor(cwd: File, sceneId: String, aiCharacterIds: List<String>): File {
        return File(rehearsalDir(cwd), "prose/${fileStem(sceneId)}-${participantStem(aiCharacterIds)}.md")
    }

    private fun participantStem(aiCharacterIds: List<String>): String {
        val ids = aiCharacterIds.toMutableList()
        if (ids.size == 1) return fileStem(ids[0])
        return ids.sorted().joinToString("-") { fileStem(it) }
    }

    fun formatRoleLine(line: RoleLine): String =
        "[${if (line.user) "user:" else ""}${line.speaker}] ${line.text}"

    fun parseRecordLine(raw: String): RoleLine? {
        val match = Regex("^\\[(user:)?([^\\]]+)\\]\\s*([\\s\\S]*)$").find(raw) ?: return null
        val text = match.groupValues[3].trim()
        if (text.isEmpty()) return null
        return RoleLine(
            speaker = match.groupValues[2].trim(),
            text = text,
            user = match.groupValues[1].isNotEmpty(),
        )
    }

    fun readRecordSegment(path: File): List<RoleLine> {
        if (!path.exists()) return emptyList()
        val content = path.readText()
        val segments = content.split(SEGMENT_SEPARATOR)
        val tail = segments.lastOrNull() ?: ""
        return tail
            .split(Regex("\\r?\\n"))
            .mapNotNull { parseRecordLine(it) }
    }

    fun readSegmentSceneStart(path: File): String? {
        if (!path.exists()) return null
        val segments = path.readText().split(SEGMENT_SEPARATOR)
        val tail = segments.lastOrNull() ?: ""
        val match = Regex("^${Regex.escape(SCENE_START_PREFIX)}(.+)$", RegexOption.MULTILINE).find(tail)
        return match?.groupValues?.get(1)?.trim()?.takeIf { it.isNotEmpty() }
    }

    fun readSegmentOrder(path: File): List<String> {
        if (!path.exists()) return emptyList()
        val segments = path.readText().split(SEGMENT_SEPARATOR)
        val tail = segments.lastOrNull() ?: ""
        val match = Regex("^${Regex.escape(ORDER_PREFIX)}(.+)$", RegexOption.MULTILINE).find(tail)
        return match
            ?.groupValues
            ?.get(1)
            ?.split(",")
            ?.map { it.trim() }
            ?.filter { it.isNotEmpty() }
            ?: emptyList()
    }

    fun appendRoleLine(path: File, line: RoleLine) {
        path.parentFile?.mkdirs()
        val existing = if (path.exists()) path.readText() else ""
        val body = if (existing.endsWith("\n") || existing.isEmpty()) existing else "$existing\n"
        path.writeText("$body${formatRoleLine(line)}\n")
    }

    fun rewriteRecordTail(path: File, sceneStart: String, lines: List<RoleLine>, orderIds: List<String>? = null) {
        path.parentFile?.mkdirs()
        val content = if (path.exists()) path.readText() else ""
        val segments = content.split(SEGMENT_SEPARATOR)
        val prefix =
            if (segments.size > 1) segments.dropLast(1).joinToString(SEGMENT_SEPARATOR) + SEGMENT_SEPARATOR else ""
        val normalized = sceneStart.replace(Regex("\\s*\\r?\\n\\s*"), " ").trim()
        val startMarker = if (normalized.isNotEmpty()) "$SCENE_START_PREFIX$normalized\n" else ""
        val orderMarker = if (!orderIds.isNullOrEmpty()) "$ORDER_PREFIX${orderIds.joinToString(",")}\n" else ""
        val tail = lines.joinToString("\n") { formatRoleLine(it) }
        path.writeText(prefix + startMarker + orderMarker + (if (tail.isNotEmpty()) "$tail\n" else ""))
    }

    fun startNewSegment(path: File, sceneStart: String? = null, orderIds: List<String>? = null) {
        path.parentFile?.mkdirs()
        val normalized = sceneStart?.replace(Regex("\\s*\\r?\\n\\s*"), " ")?.trim()
        val startMarker = if (!normalized.isNullOrEmpty()) "$SCENE_START_PREFIX$normalized\n" else ""
        val orderMarker = if (!orderIds.isNullOrEmpty()) "$ORDER_PREFIX${orderIds.joinToString(",")}\n" else ""
        val header = startMarker + orderMarker
        if (!path.exists()) {
            path.writeText(header)
            return
        }
        val existing = path.readText()
        if (existing.trim().isEmpty()) {
            path.writeText(header)
            return
        }
        path.writeText(existing.replace(Regex("\\n+$"), "") + SEGMENT_SEPARATOR + header)
    }

    fun readProse(path: File): String = if (path.exists()) path.readText() else ""

    fun writeProse(path: File, content: String, replace: Boolean): File {
        path.parentFile?.mkdirs()
        val trimmed = content.trim()
        if (replace) {
            path.writeText("$trimmed\n")
        } else {
            val existing = if (path.exists()) path.readText() else ""
            val body = if (existing.endsWith("\n") || existing.isEmpty()) existing else "$existing\n"
            path.writeText("$body$trimmed\n")
        }
        return path
    }
}

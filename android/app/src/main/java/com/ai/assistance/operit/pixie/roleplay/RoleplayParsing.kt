package com.ai.assistance.operit.pixie.roleplay

import com.ai.assistance.operit.pixie.workspace.RehearsalRecord.formatRoleLine
import com.ai.assistance.operit.pixie.workspace.RoleLine
import java.util.regex.Pattern

/**
 * 对戏解析器的 Kotlin 移植（与 pi-xie 的 roleplay.ts 语义一致）：
 * - 回复解析：支持「名字：…」与「[名字] …」两种标签、剥掉重复的自身标签、丢弃他人标签行；
 * - 沉默判定：整条回复等于「沉默」（宽容括号/引号/代码围栏/空白）；
 * - 输入解析：@点名 / 裸点名 / 角色切换；
 * - 会话消息：自己的行保持剧本行格式，他人的话转引述格式。
 */

data class RehearsalParticipant(val id: String, val name: String)

sealed class SpeakTarget {
    data class Ai(val participant: RehearsalParticipant) : SpeakTarget()
    data class User(val roleName: String) : SpeakTarget()
}

object RoleplayParsing {

    fun isSilenceReply(reply: String): Boolean {
        val normalized = reply
            .replace(Regex("```(?:plaintext|text|plain)?"), "")
            .replace(Regex("[（()）「」『』\"“”'’\\s]"), "")
        return normalized == "沉默" || normalized == "默"
    }

    fun parseSpeakAs(raw: String): SpeakInput {
        val match = Regex("^@([^\\s]+)\\s*([\\s\\S]*)$").find(raw)
            ?: return SpeakInput(text = raw)
        return SpeakInput(roleName = match.groupValues[1].trim(), text = match.groupValues[2])
    }

    data class SpeakInput(val roleName: String? = null, val text: String)

    fun classifySpeakTarget(roleName: String, aiParticipants: List<RehearsalParticipant>): SpeakTarget {
        val normalized = roleName.trim().lowercase()
        val participant = aiParticipants.firstOrNull {
            it.id.lowercase() == normalized || it.name.trim().lowercase() == normalized
        }
        return if (participant != null) SpeakTarget.Ai(participant) else SpeakTarget.User(roleName.trim())
    }

    fun parseAiReplyLines(
        reply: String,
        participants: List<RehearsalParticipant>,
        otherNames: List<String> = emptyList(),
    ): List<RoleLine> {
        val lines = mutableListOf<RoleLine>()
        var lastSpeaker: String? = null
        fun isForeign(name: String): Boolean =
            otherNames.any { it.trim().lowercase() == name.lowercase() }

        for (raw in reply.split(Regex("\\r?\\n"))) {
            val text = raw.trim()
            if (text.isEmpty()) continue
            val colonMatch = Regex("^([^\\s（(【：:]{1,16})[：:]\\s*([\\s\\S]*)$").find(text)
            val bracketMatch = Regex("^[\\[【]([^\\]】\\s]{1,16})[\\]】]\\s*([\\s\\S]*)$").find(text)
            val labelMatch = colonMatch ?: bracketMatch
            val named = labelMatch?.groupValues?.get(1)?.trim()
            // 替其他在场角色说话（如知遥的子代理输出「绯雪：…」）：不是本角色的内容，丢弃
            if (named != null && isForeign(named)) continue
            val matched = named?.let { n ->
                participants.firstOrNull {
                    it.name.trim().lowercase() == n.lowercase() || it.id.lowercase() == n.lowercase()
                }
            }
            if (matched != null) {
                // 剥掉行首（可能重复的）自身标签：如「[策知遥] [策知遥] （…）」
                val labelPattern = Pattern.compile(
                    "^(?:[\\[【]" + Pattern.quote(matched.name) + "[\\]】]|" +
                        Pattern.quote(matched.name) + "[：:])\\s*",
                )
                var content = (labelMatch.groupValues[2]).trim()
                for (guard in 0 until 4) {
                    val stripped = labelPattern.matcher(content).replaceFirst("")
                    if (stripped == content) break
                    content = stripped
                }
                content = content.trim()
                if (content.isNotEmpty()) {
                    lines.add(RoleLine(speaker = matched.name, text = content, user = false))
                    lastSpeaker = matched.name
                }
                continue
            }
            val target = lastSpeaker ?: participants.firstOrNull()?.name ?: continue
            val last = lines.lastOrNull()
            if (last != null && last.speaker == target) {
                lines[lines.size - 1] = last.copy(text = "${last.text} $text".trim())
            } else {
                lines.add(RoleLine(speaker = target, text = text, user = false))
                lastSpeaker = target
            }
        }
        return lines
    }

    /**
     * 单条记录行在该角色 agent 消息里的呈现：
     * 自己的行保持剧本行格式；其他角色的话改成引述格式（明确是「别人说过的话」）。
     */
    fun formatAgentMessage(line: RoleLine, selfId: String, selfName: String): String {
        val isSelf = !line.user && (line.speaker == selfName || line.speaker == selfId)
        if (isSelf || line.user) return formatRoleLine(line)
        return "${line.speaker}：「${line.text}」"
    }

    /** 把一段记录行回放成某角色的会话消息：自己的台词是 assistant，其余是 user。 */
    fun buildSessionMessages(
        segment: List<RoleLine>,
        selfId: String,
        selfName: String,
    ): List<SessionMessage> {
        return segment.map { line ->
            val isSelf = !line.user && (line.speaker == selfName || line.speaker == selfId)
            SessionMessage(
                role = if (isSelf) "assistant" else "user",
                content = formatAgentMessage(line, selfId, selfName),
            )
        }
    }

    data class SessionMessage(val role: String, val content: String)

    /** 统计对戏记录中的台词行数（纯点名指令行「@角色」不计）。 */
    fun countTranscriptLines(transcript: String): Int {
        return transcript
            .split(Regex("\\r?\\n"))
            .count { line ->
                Regex("^\\[(user:)?[^\\]]+\\]").containsMatchIn(line) &&
                    !Regex("^\\[(user:)?[^\\]]+\\]\\s*@[^\\s]+\\s*$").containsMatchIn(line)
            }
    }
}

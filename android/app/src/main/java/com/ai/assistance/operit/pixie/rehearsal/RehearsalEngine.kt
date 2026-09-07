package com.ai.assistance.operit.pixie.rehearsal

import com.ai.assistance.operit.pixie.prompt.PixiePrompts
import com.ai.assistance.operit.pixie.roleplay.RehearsalParticipant
import com.ai.assistance.operit.pixie.roleplay.RoleplayParsing
import com.ai.assistance.operit.pixie.roleplay.RoleplayParsing.SessionMessage
import com.ai.assistance.operit.pixie.roleplay.SpeakTarget
import com.ai.assistance.operit.pixie.workspace.EntityKind
import com.ai.assistance.operit.pixie.workspace.EntityRecord
import com.ai.assistance.operit.pixie.workspace.RehearsalRecord
import com.ai.assistance.operit.pixie.workspace.RoleLine
import com.ai.assistance.operit.pixie.workspace.WorkspaceStore
import java.io.File

/**
 * 对戏引擎：电脑 pi-xie 对戏循环的 Kotlin 移植。
 * - 每个 AI 角色一个常驻转录（独立 messages；他人台词以引述格式注入；人设提示词热更新）；
 * - 自判发言：除点名/推进语外不附加强制指令，由角色按人设判断开不开口（只输出「沉默」）；
 * - 轮内串行：同轮后面的角色能看到前面角色刚产生的新台词；
 * - 记录文件是唯一事实源：# 起始：/# 顺序：/角色行，与电脑版互拷兼容。
 */

const val DIRECTOR_MAX_TURNS = 3
const val DIRECTOR_CONTINUE_MESSAGE =
    "（导演模式：没有新的指示，请按当前局面自然继续互动，直到这一小场告一段落）"
const val FORCED_TURN_MESSAGE = "（点名：本轮你必须回应，不得沉默）"
const val BARE_MENTION_MESSAGE = "（点名：该你说话了，请按当前局面自然回应）"

val NARRATOR_ROLES = setOf("旁白", "自己", "导演", "narrator", "director")

/** 角色实时活动（直播条/监视面板的数据源；UI 观察此对象）。 */
class CharacterActivity {
    var status: String = "idle" // idle | speaking | thinking
    var stream: String = ""
}

/** 单个角色的常驻转录。 */
class CharacterSession(
    val participant: RehearsalParticipant,
    var systemPrompt: String,
    val messages: MutableList<SessionMessage> = mutableListOf(),
    var lastRole: String = "user",
    val activity: CharacterActivity = CharacterActivity(),
)

/** 网络边界：一次角色回合的流式补全（Android 实现见 AIServiceTurnRunner）。 */
interface CharacterTurnRunner {
    /**
     * @param extraUser 追加到历史末尾的用户消息；null 表示转录末尾已是新内容（continue）。
     */
    suspend fun runTurn(
        systemPrompt: String,
        history: List<SessionMessage>,
        extraUser: String?,
        onDelta: suspend (text: String) -> Unit,
    ): String

    fun abort()
}

/** 角色系统提示词提供者（角色卡 + 场景 + 约束 + 破甲开关）。 */
fun interface CharacterSystemPromptProvider {
    fun systemPromptFor(
        participant: RehearsalParticipant,
        allParticipants: List<RehearsalParticipant>,
        userRoleName: String?,
        sceneStart: String,
    ): String
}

/** 工作区读取实现，与电脑 pi-xie 的 buildCharacterSystemPromptFor 一致。 */
class WorkspaceCharacterPromptProvider(
    private val store: WorkspaceStore,
    private val scene: EntityRecord,
    private val unrestricted: Boolean,
) : CharacterSystemPromptProvider {
    private val worldview = store.readConstraint("worldview")
    private val outline = store.readConstraint("outline")
    private val timeline = store.readConstraint("timeline")
    private val style = store.readConstraint("style")

    override fun systemPromptFor(
        participant: RehearsalParticipant,
        allParticipants: List<RehearsalParticipant>,
        userRoleName: String?,
        sceneStart: String,
    ): String {
        val card = try {
            store.getEntity(EntityKind.CHARACTERS, participant.id)
        } catch (e: IllegalArgumentException) {
            null // 角色卡缺失时仍以参与者信息占位
        }
        return PixiePrompts.buildCharacterSystemPrompt(
            characterName = participant.name,
            characterBody = card?.body ?: "",
            characterSystem = card?.system ?: "",
            otherNames = allParticipants.filter { it.id != participant.id }.map { it.name },
            userRoleName = userRoleName,
            sceneName = scene.name,
            sceneBody = scene.body,
            sceneStart = sceneStart,
            worldview = worldview,
            outline = outline,
            timeline = timeline,
            style = style,
            unrestricted = unrestricted,
        )
    }
}

class RehearsalSession(
    val cwd: File,
    val sceneId: String,
    val sceneName: String,
    var sceneStart: String,
    var userRoleName: String?,
    /** 轮内评估顺序 = 此列表顺序（# 顺序： 持久化到记录文件）。 */
    val aiCharacters: MutableList<RehearsalParticipant>,
    val recordPath: File,
    val prosePath: File,
    val segment: MutableList<RoleLine>,
    val sessions: MutableMap<String, CharacterSession> = mutableMapOf(),
    var summary: String = "",
)

data class RoundOutcome(
    val produced: Boolean,
    val speakers: List<String>,
    val silent: List<String>,
)

data class AdvanceOutcome(
    val userLine: RoleLine?,
    val forcedParticipant: RehearsalParticipant?,
    val forcedProduced: Boolean?,
    val rounds: List<RoundOutcome>,
    val summary: String,
)

data class RetellOutcome(
    val speakerName: String,
    val keptCount: Int,
    val produced: Boolean,
)

class RehearsalEngine(
    private val store: WorkspaceStore,
    private val runner: CharacterTurnRunner,
    private val promptProvider: CharacterSystemPromptProvider,
) {
    /** UI 回调：新台词落盘时（聊天流追加角色行）。 */
    var onLineCommitted: ((RoleLine) -> Unit)? = null

    /** UI 回调：角色活动（直播条/监视面板）变化。 */
    var onActivityUpdate: ((CharacterSession) -> Unit)? = null

    /** UI 回调：轮次摘要变化。 */
    var onSummaryChanged: ((String) -> Unit)? = null

    /**
     * 进入/恢复对戏。startNew=true 时忽略已有记录开新段；
     * false 时恢复记录文件当前段（段头 # 起始：/# 顺序： 是唯一事实源）。
     */
    fun openSession(
        cwd: File,
        scene: EntityRecord,
        sceneStartText: String?,
        aiCharacters: List<RehearsalParticipant>,
        userRoleName: String?,
        startNew: Boolean,
    ): RehearsalSession {
        val recordPath = RehearsalRecord.recordPathFor(cwd, scene.id, aiCharacters.map { it.id })
        val order = aiCharacters.toMutableList()
        var sceneStart = ""
        if (!startNew) {
            val savedOrder = RehearsalRecord.readSegmentOrder(recordPath)
            val byId = aiCharacters.associateBy { it.id }
            if (savedOrder.isNotEmpty() && savedOrder.all { byId.containsKey(it) }) {
                order.clear()
                savedOrder.forEach { order.add(byId.getValue(it)) }
                aiCharacters.filterNot { savedOrder.contains(it.id) }.forEach { order.add(it) }
            }
            sceneStart = RehearsalRecord.readSegmentSceneStart(recordPath) ?: ""
        }
        val segment = if (startNew) {
            mutableListOf()
        } else {
            RehearsalRecord.readRecordSegment(recordPath).toMutableList()
        }
        if (segment.isEmpty()) {
            sceneStart = (sceneStartText ?: "").trim()
            RehearsalRecord.startNewSegment(
                recordPath,
                sceneStart.ifEmpty { null },
                order.map { it.id },
            )
        }
        val session = RehearsalSession(
            cwd = cwd,
            sceneId = scene.id,
            sceneName = scene.name,
            sceneStart = sceneStart,
            userRoleName = userRoleName,
            aiCharacters = order,
            recordPath = recordPath,
            prosePath = RehearsalRecord.prosePathFor(cwd, scene.id, order.map { it.id }),
            segment = segment,
        )
        for (participant in order) {
            ensureCharacterSession(session, participant)
        }
        return session
    }

    /** 角色转录不存在则按当前段回放创建。 */
    private fun ensureCharacterSession(session: RehearsalSession, participant: RehearsalParticipant) {
        if (session.sessions.containsKey(participant.id)) return
        val systemPrompt = buildSystemPrompt(session, participant)
        val characterSession = CharacterSession(
            participant = participant,
            systemPrompt = systemPrompt,
            messages = RoleplayParsing.buildSessionMessages(session.segment, participant.id, participant.name)
                .toMutableList(),
        )
        characterSession.lastRole = lastRoleFor(session.segment, participant)
        session.sessions[participant.id] = characterSession
    }

    /** 按当前段整体重建全部角色转录（/改台词、/重说、发言顺序变化后调用）。 */
    private fun rebuildTranscripts(session: RehearsalSession) {
        for (participant in session.aiCharacters) {
            val systemPrompt = buildSystemPrompt(session, participant)
            val characterSession = session.sessions[participant.id]
                ?: CharacterSession(participant, systemPrompt).also { session.sessions[participant.id] = it }
            characterSession.systemPrompt = systemPrompt
            characterSession.messages.clear()
            characterSession.messages.addAll(
                RoleplayParsing.buildSessionMessages(session.segment, participant.id, participant.name),
            )
            characterSession.lastRole = lastRoleFor(session.segment, participant)
        }
    }

    private fun lastRoleFor(segment: List<RoleLine>, participant: RehearsalParticipant): String {
        val last = segment.lastOrNull()
        return if (last != null && !last.user && last.speaker == participant.name) "assistant" else "user"
    }

    private fun buildSystemPrompt(session: RehearsalSession, participant: RehearsalParticipant): String =
        promptProvider.systemPromptFor(participant, session.aiCharacters, session.userRoleName, session.sceneStart)

    /** 用户行（含导演指示）注入所有角色转录（不触发回应）。 */
    private fun appendUserLineToAgents(session: RehearsalSession, line: RoleLine) {
        val content = RehearsalRecord.formatRoleLine(line)
        for (participant in session.aiCharacters) {
            session.sessions[participant.id]?.let {
                it.messages.add(SessionMessage("user", content))
                it.lastRole = "user"
            }
        }
    }

    /** 角色新台词以引述格式注入其他所有角色转录（自己的转录已由本回合自然包含）。 */
    private fun appendLineToOtherAgents(session: RehearsalSession, line: RoleLine, selfId: String) {
        val content = "${line.speaker}：「${line.text}」"
        for (participant in session.aiCharacters) {
            if (participant.id == selfId) continue
            session.sessions[participant.id]?.let {
                it.messages.add(SessionMessage("user", content))
                it.lastRole = "user"
            }
        }
    }

    /** 记录一行台词：文件 + 段缓存 + UI 回调。 */
    private fun recordLine(session: RehearsalSession, line: RoleLine) {
        RehearsalRecord.appendRoleLine(session.recordPath, line)
        session.segment.add(line)
        onLineCommitted?.invoke(line)
    }

    /**
     * 生成单个角色回应：基于其常驻转录，按人设自主判断该不该开口。
     * forced：点名回合，追加强制指令；否则转录末尾已是新内容时 continue，末尾是自己上句时以导演推进语 prompt。
     */
    suspend fun generateCharacterTurn(
        session: RehearsalSession,
        participant: RehearsalParticipant,
        forced: Boolean,
    ): List<RoleLine>? {
        // 人设热加载：systemPrompt 变化时只热更新提示词，不动转录
        val characterSession = session.sessions[participant.id] ?: return null
        val systemPrompt = buildSystemPrompt(session, participant)
        if (characterSession.systemPrompt != systemPrompt) {
            characterSession.systemPrompt = systemPrompt
        }
        val activity = characterSession.activity
        activity.status = "speaking"
        activity.stream = ""
        onActivityUpdate?.invoke(characterSession)

        val extraUser = when {
            forced -> FORCED_TURN_MESSAGE
            characterSession.lastRole == "user" -> null
            else -> DIRECTOR_CONTINUE_MESSAGE
        }
        var reply = ""
        try {
            reply = runner.runTurn(
                systemPrompt = systemPrompt,
                history = characterSession.messages.toList(),
                extraUser = extraUser,
                onDelta = { delta ->
                    activity.status = "speaking"
                    activity.stream += delta
                    onActivityUpdate?.invoke(characterSession)
                },
            )
        } catch (e: kotlinx.coroutines.CancellationException) {
            // 中断（停止按钮/退出）：必须继续抛出，不能当成回合失败吞掉
            activity.status = "idle"
            onActivityUpdate?.invoke(characterSession)
            throw e
        } catch (e: Exception) {
            // 单角色回合失败不炸掉整轮：视为未回应，由调用方决定汇总
            reply = ""
        }
        activity.status = "idle"
        onActivityUpdate?.invoke(characterSession)
        // 无论回应/沉默/失败，转录末尾都视为 assistant（与电脑版一致）
        characterSession.lastRole = "assistant"
        if (reply.isNotBlank()) {
            characterSession.messages.add(SessionMessage("assistant", reply))
        }
        if (reply.isBlank() || RoleplayParsing.isSilenceReply(reply)) return null
        val otherNames = session.aiCharacters.filter { it.id != participant.id }.map { it.name }
        val parsed = RoleplayParsing.parseAiReplyLines(reply, listOf(participant), otherNames)
        return parsed.ifEmpty { null }
    }

    /** 记录回应行（文件 + 段 + 其他角色注入）并刷新摘要；返回是否有产出。 */
    private fun commitCharacterTurn(
        session: RehearsalSession,
        participant: RehearsalParticipant,
        lines: List<RoleLine>,
    ): Boolean {
        for (line in lines) {
            recordLine(session, line)
            appendLineToOtherAgents(session, line, participant.id)
        }
        return lines.isNotEmpty()
    }

    /** 单角色强制回合（@点名 / /重说）：只唤醒该角色，沉默视为失败。 */
    suspend fun runCharacterTurn(
        session: RehearsalSession,
        participant: RehearsalParticipant,
    ): Boolean {
        val lines = generateCharacterTurn(session, participant, forced = true) ?: return false
        return commitCharacterTurn(session, participant, lines)
    }

    /** 一轮 = 全体 AI 角色按出场顺序串行各自判断是否接话（后面的角色能看到同轮前人的新台词）。 */
    suspend fun runCharacterRound(session: RehearsalSession): RoundOutcome {
        val speakers = mutableListOf<String>()
        val silent = mutableListOf<String>()
        for (participant in session.aiCharacters) {
            val lines = generateCharacterTurn(session, participant, forced = false)
            if (lines != null) {
                speakers.add(participant.name)
                commitCharacterTurn(session, participant, lines)
            } else {
                silent.add(participant.name)
            }
        }
        return RoundOutcome(produced = speakers.isNotEmpty(), speakers = speakers, silent = silent)
    }

    /** 推进一轮对戏：解析 @ 分派，记录用户台词，按模式执行全员判断轮。 */
    suspend fun advance(session: RehearsalSession, raw: String): AdvanceOutcome {
        val speak = RoleplayParsing.parseSpeakAs(raw)
        var target: SpeakTarget? =
            speak.roleName?.let { RoleplayParsing.classifySpeakTarget(it, session.aiCharacters) }
        var text = speak.text.trim()
        if (target is SpeakTarget.User) {
            val roleName = target.roleName
            val knownEntity =
                if (roleName in NARRATOR_ROLES) {
                    null
                } else {
                    store.listEntities(EntityKind.CHARACTERS)
                        .firstOrNull { it.id == roleName || it.name == roleName }
                }
            if (roleName in NARRATOR_ROLES || knownEntity != null) {
                // 归一化：内部 id 或名字都归一到角色显示名，
                // 否则记录行会出现 [user:ceqici] 这种与顶栏/角色卡不一致的内部标识
                session.userRoleName = knownEntity?.name ?: roleName
            } else {
                // 未知角色名（如没打空格的「@千夏你来了」）：不切换角色，整行按原文记为台词
                target = null
                text = raw.trim()
            }
        }

        val isDirector = session.userRoleName == null
        var roundsLeft = if (isDirector) DIRECTOR_MAX_TURNS else 1

        // 裸点名（如「@千夏」不带台词）：不记录用户行，只让该角色开口
        if (text.isEmpty() && target !is SpeakTarget.Ai) {
            return AdvanceOutcome(null, null, null, emptyList(), session.summary)
        }

        var userLine: RoleLine? = null
        if (text.isNotEmpty()) {
            userLine = RoleLine(speaker = session.userRoleName ?: "旁白", text = text, user = true)
            recordLine(session, userLine)
            appendUserLineToAgents(session, userLine)
        }

        var forcedParticipant: RehearsalParticipant? = null
        var forcedProduced: Boolean? = null
        var summary: String
        if (target is SpeakTarget.Ai) {
            forcedParticipant = target.participant
            if (text.isEmpty()) {
                // 裸点名：把「该你说话了」注入该角色转录，再强制回应
                session.sessions[target.participant.id]?.let {
                    it.messages.add(SessionMessage("user", BARE_MENTION_MESSAGE))
                    it.lastRole = "user"
                }
            }
            forcedProduced = runCharacterTurn(session, target.participant)
            summary = if (forcedProduced) "${target.participant.name} 接话" else "${target.participant.name} 未回应"
            roundsLeft = if (forcedProduced) roundsLeft - 1 else 0
        } else {
            summary = ""
        }

        val rounds = mutableListOf<RoundOutcome>()
        for (round in 0 until roundsLeft) {
            val result = runCharacterRound(session)
            rounds.add(result)
            summary = if (result.produced) {
                val silentPart = if (result.silent.isNotEmpty()) "（${result.silent.joinToString("、")} 沉默）" else ""
                "${result.speakers.joinToString("、")} 接话$silentPart"
            } else {
                "全场沉默"
            }
        }
        if (summary.isNotEmpty()) {
            session.summary = summary
            onSummaryChanged?.invoke(summary)
        }
        return AdvanceOutcome(userLine, forcedParticipant, forcedProduced, rounds, summary)
    }

    /**
     * /重说：撤回第 [targetIndex] 行（1 起，须为 AI 台词行）及其后内容，
     * 由该行说话角色基于此前用户最后一条消息重新生成。
     */
    suspend fun retell(session: RehearsalSession, targetIndex: Int): RetellOutcome? {
        val total = session.segment.size
        if (total == 0 || targetIndex < 1 || targetIndex > total) return null
        val targetLine = session.segment[targetIndex - 1]
        if (targetLine.user) return null
        val speakerParticipant = session.aiCharacters.firstOrNull { it.name == targetLine.speaker }
            ?: session.aiCharacters.firstOrNull()
            ?: return null

        var triggerUserIndex = -1
        for (index in targetIndex - 2 downTo 0) {
            if (session.segment[index].user) {
                triggerUserIndex = index
                break
            }
        }
        val kept = if (triggerUserIndex >= 0) {
            session.segment.take(triggerUserIndex + 1)
        } else {
            session.segment.take(targetIndex - 1)
        }
        session.segment.clear()
        session.segment.addAll(kept)
        RehearsalRecord.rewriteRecordTail(
            session.recordPath,
            session.sceneStart,
            kept,
            session.aiCharacters.map { it.id },
        )
        rebuildTranscripts(session)
        onSummaryChanged?.invoke(session.summary)
        val produced = runCharacterTurn(session, speakerParticipant)
        return RetellOutcome(speakerName = speakerParticipant.name, keptCount = kept.size, produced = produced)
    }

    /**
     * /改台词：修改第 [targetIndex] 行（1 起）。newText 空白 = 删除该行；
     * 非空白整行替换（保留原说话人与用户标记，去标签前缀）。
     * 返回 true 表示记录已改写。
     */
    fun editLine(session: RehearsalSession, targetIndex: Int, newText: String): Boolean {
        val total = session.segment.size
        if (total == 0 || targetIndex < 1 || targetIndex > total) return false
        val line = session.segment[targetIndex - 1]
        if (newText.trim().isEmpty()) {
            session.segment.removeAt(targetIndex - 1)
        } else {
            val text = newText.trim().replace(Regex("^\\[(user:)?[^\\]]+\\]\\s*"), "")
            session.segment[targetIndex - 1] = line.copy(text = text.ifEmpty { line.text })
        }
        RehearsalRecord.rewriteRecordTail(
            session.recordPath,
            session.sceneStart,
            session.segment,
            session.aiCharacters.map { it.id },
        )
        rebuildTranscripts(session)
        return true
    }

    /** /发言顺序：ids 为空返回当前顺序；否则校验并按新顺序重排（持久化到记录文件当前段）。 */
    fun setOrder(session: RehearsalSession, ids: List<String>): List<RehearsalParticipant>? {
        if (ids.isEmpty()) return session.aiCharacters.toList()
        val byId = session.aiCharacters.associateBy { it.id }
        if (ids.any { !byId.containsKey(it) }) return null
        val reordered = ids.map { byId.getValue(it) } + session.aiCharacters.filterNot { ids.contains(it.id) }
        session.aiCharacters.clear()
        session.aiCharacters.addAll(reordered)
        RehearsalRecord.rewriteRecordTail(
            session.recordPath,
            session.sceneStart,
            session.segment,
            session.aiCharacters.map { it.id },
        )
        return reordered
    }

    /** 退出对戏：中断在途回合。 */
    fun dispose() {
        runner.abort()
    }
}

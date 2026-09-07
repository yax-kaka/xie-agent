package com.ai.assistance.operit.pixie.rehearsal

import com.ai.assistance.operit.pixie.roleplay.RehearsalParticipant
import com.ai.assistance.operit.pixie.roleplay.RoleplayParsing.SessionMessage
import com.ai.assistance.operit.pixie.workspace.EntityKind
import com.ai.assistance.operit.pixie.workspace.EntityRecord
import com.ai.assistance.operit.pixie.workspace.RehearsalRecord
import com.ai.assistance.operit.pixie.workspace.RoleLine
import com.ai.assistance.operit.pixie.workspace.WorkspaceStore
import java.io.File
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * 对戏引擎测试：与电脑 pi-xie 的 rehearsal 语义逐项对照（golden）。
 * 网络边界用脚本化 FakeTurnRunner 模拟，重点验证：
 * 强制/导演/续写三种提示、轮内串行可见性、沉默/他人标签丢弃、
 * 记录文件落盘、重说/改台词裁剪、发言顺序持久化与恢复。
 */
class RehearsalEngineTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private class FakeTurnRunner(script: List<String>) : CharacterTurnRunner {
        data class Call(
            val systemPrompt: String,
            val history: List<SessionMessage>,
            val extraUser: String?,
        )

        val calls = mutableListOf<Call>()
        private val replies = ArrayDeque(script)
        var aborted = false

        override suspend fun runTurn(
            systemPrompt: String,
            history: List<SessionMessage>,
            extraUser: String?,
            onDelta: suspend (text: String) -> Unit,
        ): String {
            calls.add(Call(systemPrompt, history, extraUser))
            val reply = replies.removeFirstOrNull() ?: "沉默"
            reply.chunked(4).forEach { onDelta(it) } // 模拟流式增量
            return reply
        }

        override fun abort() {
            aborted = true
        }
    }

    private class Fixture(
        val root: File,
        val store: WorkspaceStore,
        val runner: FakeTurnRunner,
        val engine: RehearsalEngine,
        val scene: EntityRecord,
    ) {
        fun open(userRoleName: String? = null, startNew: Boolean = true): RehearsalSession =
            engine.openSession(
                cwd = root,
                scene = scene,
                sceneStartText = "两人在山门相遇。",
                aiCharacters = listOf(
                    RehearsalParticipant("feixue", "绯雪"),
                    RehearsalParticipant("zhizhiyao", "知遥"),
                ),
                userRoleName = userRoleName,
                startNew = startNew,
            )
    }

    private fun fixture(script: List<String> = emptyList()): Fixture {
        val store = WorkspaceStore(tmp.root)
        store.ensureWorkspace()
        val scene = store.createEntity(EntityKind.SCENES, "山门", "山门，晨雾未散。")
        store.createEntity(EntityKind.CHARACTERS, "绯雪", "红发，温柔而敏锐。", id = "feixue")
        store.createEntity(EntityKind.CHARACTERS, "知遥", "少年，话少。", id = "zhizhiyao")
        // 非 AI 扮演的用户可切换角色（名字与实体一致 → 切换，不点名 AI）
        store.createEntity(EntityKind.CHARACTERS, "策栖辞", "男主角。", id = "ceqici")
        val runner = FakeTurnRunner(script)
        val engine = RehearsalEngine(
            store = store,
            runner = runner,
            promptProvider = WorkspaceCharacterPromptProvider(store, scene, unrestricted = false),
        )
        return Fixture(tmp.root, store, runner, engine, scene)
    }

    @Test
    fun startWritesSegmentMarkersAndBuildsSessions() {
        val f = fixture()
        val session = f.open()
        val raw = session.recordPath.readText()
        assertTrue(raw.startsWith("# 起始：两人在山门相遇。\n# 顺序：feixue,zhizhiyao\n"))
        assertEquals(2, session.sessions.size)
        assertEquals("", session.summary)
        val feixue = session.sessions.getValue("feixue")
        assertTrue(feixue.systemPrompt.contains("名字：绯雪"))
        assertTrue(feixue.systemPrompt.contains("场景：山门"))
        assertTrue(feixue.systemPrompt.contains("知遥")) // 在场名单
        assertEquals(emptyList<SessionMessage>(), feixue.messages)
        assertEquals("user", feixue.lastRole)
    }

    @Test
    fun directorAdvanceRunsThreeRoundsWithSerialVisibility() = runTest {
        val f = fixture(
            listOf(
                "绯雪：（抬头）早。",
                "沉默",
                "沉默",
                "知遥：哥，早。",
                "沉默",
                "沉默",
            ),
        )
        val session = f.open()
        val outcome = f.engine.advance(session, "雾散了。")

        assertEquals(RoleLine("旁白", "雾散了。", user = true), outcome.userLine)
        assertEquals(3, outcome.rounds.size)
        assertEquals(RoundOutcome(true, listOf("绯雪"), listOf("知遥")), outcome.rounds[0])
        assertEquals(RoundOutcome(true, listOf("知遥"), listOf("绯雪")), outcome.rounds[1])
        assertEquals(RoundOutcome(false, emptyList(), listOf("绯雪", "知遥")), outcome.rounds[2])
        assertEquals("全场沉默", outcome.summary)
        assertEquals(6, f.runner.calls.size)

        // 轮内串行：知遥第 1 轮能看到绯雪同轮刚产生的台词（引述格式），且末尾是新内容 → continue（无额外用户消息）
        val zhiyaoRound1 = f.runner.calls[1]
        assertEquals("user", zhiyaoRound1.history.last().role)
        assertEquals("绯雪：「（抬头）早。」", zhiyaoRound1.history.last().content)
        assertNull(zhiyaoRound1.extraUser)

        // 绯雪第 2 轮：末尾是自己上句 → 导演推进语 prompt
        assertEquals(DIRECTOR_CONTINUE_MESSAGE, f.runner.calls[2].extraUser)

        // 记录文件按剧本行格式落盘
        val raw = session.recordPath.readText()
        assertTrue(raw.contains("[user:旁白] 雾散了。\n"))
        assertTrue(raw.contains("[绯雪] （抬头）早。\n"))
        assertTrue(raw.contains("[知遥] 哥，早。\n"))
        assertEquals(3, RehearsalRecord.readRecordSegment(session.recordPath).size)
    }

    @Test
    fun mentionForcesTargetAndBareMentionInjectsNudge() = runTest {
        val f = fixture(listOf("知遥：哥，你吃了没？", "沉默"))
        val session = f.open(userRoleName = "策栖辞")
        val outcome = f.engine.advance(session, "@知遥 你吃了吗。")

        assertEquals(RoleLine("策栖辞", "你吃了吗。", user = true), outcome.userLine)
        assertEquals("zhizhiyao", outcome.forcedParticipant?.id)
        assertEquals(true, outcome.forcedProduced)
        assertEquals(0, outcome.rounds.size) // 用户扮演模式只轮一次，点名消耗掉了
        assertEquals("知遥 接话", outcome.summary)

        val forcedCall = f.runner.calls[0]
        assertEquals(FORCED_TURN_MESSAGE, forcedCall.extraUser)
        assertEquals("[user:策栖辞] 你吃了吗。", forcedCall.history.last().content)

        // 裸点名：注入「该你说话了」再强制回应；沉默视为未回应
        val bare = f.engine.advance(session, "@绯雪")
        assertNull(bare.userLine)
        assertEquals(false, bare.forcedProduced)
        assertEquals("绯雪 未回应", bare.summary)
        val bareCall = f.runner.calls[1]
        assertEquals(BARE_MENTION_MESSAGE, bareCall.history.last().content)
        assertEquals(FORCED_TURN_MESSAGE, bareCall.extraUser)
        assertEquals(2, session.segment.size)
    }

    @Test
    fun roleSwitchKnownEntityAndUnknownRoleVerbatim() = runTest {
        val f = fixture(listOf("沉默", "沉默"))
        val session = f.open()
        f.engine.advance(session, "@自己 天亮了。")
        assertEquals("自己", session.userRoleName)
        assertEquals(RoleLine("自己", "天亮了。", user = true), session.segment.last())

        f.engine.advance(session, "@策栖辞 早。")
        assertEquals("策栖辞", session.userRoleName)
        assertEquals(RoleLine("策栖辞", "早。", user = true), session.segment.last())

        // 未知角色名整体按原文记为台词，不切换角色
        f.engine.advance(session, "@千夏你来了")
        assertEquals("策栖辞", session.userRoleName)
        assertEquals(RoleLine("策栖辞", "@千夏你来了", user = true), session.segment.last())
    }

    @Test
    fun retellTrimsSegmentRebuildsAndForcesSpeaker() = runTest {
        val f = fixture(
            listOf(
                "绯雪：（抬头）早。",
                "知遥：哥，你昨晚没睡好？",
                "知遥：哥，喝水。",
            ),
        )
        val session = f.open(userRoleName = "策栖辞")
        f.engine.advance(session, "早。")
        assertEquals(3, session.segment.size)

        val outcome = f.engine.retell(session, 3)
        assertEquals("知遥", outcome?.speakerName)
        assertEquals(1, outcome?.keptCount)
        assertEquals(true, outcome?.produced)

        // 段缓存与记录文件一致：用户行 + 重新生成的知遥行
        assertEquals(2, session.segment.size)
        assertEquals(
            session.segment,
            RehearsalRecord.readRecordSegment(session.recordPath),
        )
        assertEquals(RoleLine("知遥", "哥，喝水。", user = false), session.segment.last())

        // 重说后的强制回合基于重建转录：只含保留的用户行
        val forcedCall = f.runner.calls[2]
        assertEquals(FORCED_TURN_MESSAGE, forcedCall.extraUser)
        assertEquals(listOf(SessionMessage("user", "[user:策栖辞] 早。")), forcedCall.history)

        // 用户行不可重说
        assertNull(f.engine.retell(session, 1))
        // 越界不可重说
        assertNull(f.engine.retell(session, 99))
    }

    @Test
    fun editLineReplacesDeletesAndPersists() = runTest {
        val f = fixture(
            listOf(
                "绯雪：（抬头）早。",
                "知遥：哥，你昨晚没睡好？",
            ),
        )
        val session = f.open(userRoleName = "策栖辞")
        f.engine.advance(session, "早。")
        assertEquals(3, session.segment.size)

        // 整行替换：去标签前缀，保留说话人与用户标记
        assertEquals(true, f.engine.editLine(session, 2, "[绯雪] （改）嗯。"))
        assertEquals(RoleLine("绯雪", "（改）嗯。", user = false), session.segment[1])
        assertEquals(
            session.segment,
            RehearsalRecord.readRecordSegment(session.recordPath),
        )
        // 重建后绯雪转录里的该行同步为新文本（下标 1；末尾是知遥的引述行）
        assertEquals(
            "[绯雪] （改）嗯。",
            session.sessions.getValue("feixue").messages[1].content,
        )

        // 空白 = 删除该行
        assertEquals(true, f.engine.editLine(session, 2, "   "))
        assertEquals(2, session.segment.size)
        assertEquals(
            session.segment,
            RehearsalRecord.readRecordSegment(session.recordPath),
        )
        assertEquals(false, f.engine.editLine(session, 99, "x"))
    }

    @Test
    fun setOrderPersistsAndResumeApplies() = runTest {
        val f = fixture(listOf("沉默", "知遥：嗯。"))
        val session = f.open(userRoleName = "策栖辞")
        val reordered = f.engine.setOrder(session, listOf("zhizhiyao", "feixue"))
        assertEquals(listOf("zhizhiyao", "feixue"), reordered?.map { it.id })
        assertTrue(session.recordPath.readText().contains("# 顺序：zhizhiyao,feixue\n"))

        // 轮内顺序按新顺序：第一个被评估的是知遥（本轮 2 次调用，倒数第二个是知遥）
        f.engine.advance(session, "晚上了。")
        val zhiyaoCall = f.runner.calls[f.runner.calls.size - 2]
        assertTrue(zhiyaoCall.systemPrompt.contains("名字：知遥"))

        // 未知 id 拒绝
        assertNull(f.engine.setOrder(session, listOf("bogus")))

        // 恢复会话：顺序与段内容都来自记录文件（唯一事实源）
        val resumed = f.open(startNew = false)
        assertEquals(listOf("zhizhiyao", "feixue"), resumed.aiCharacters.map { it.id })
        assertEquals("两人在山门相遇。", resumed.sceneStart)
        assertEquals(session.segment, resumed.segment)
    }

    @Test
    fun silenceAndForeignLabelledLinesProduceNothing() = runTest {
        val f = fixture(listOf("沉默", "绯雪：（别过脸）先起来。"))
        val session = f.open(userRoleName = "策栖辞")
        val outcome = f.engine.advance(session, "起了。")

        // 绯雪沉默；知遥替绯雪说话 → 整行丢弃 → 全场沉默
        assertEquals(RoundOutcome(false, emptyList(), listOf("绯雪", "知遥")), outcome.rounds.single())
        assertEquals("全场沉默", outcome.summary)
        assertEquals(1, session.segment.size) // 只有用户行

        // 沉默回应仍进入该角色转录（assistant），下次轮到它走导演推进语
        val feixue = session.sessions.getValue("feixue")
        assertEquals(SessionMessage("assistant", "沉默"), feixue.messages.last())
        assertEquals("assistant", feixue.lastRole)
    }

    @Test
    fun abortPropagatesToRunner() {
        val f = fixture()
        f.engine.dispose()
        assertTrue(f.runner.aborted)
    }
}

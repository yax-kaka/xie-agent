package com.ai.assistance.operit.pixie.roleplay

import com.ai.assistance.operit.pixie.workspace.RoleLine
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 对戏解析器测试：与电脑 pi-xie 的 roleplay.test.ts 用例逐项对照（golden）。
 */
class RoleplayParsingTest {

    private val feixue = RehearsalParticipant(id = "feixue", name = "绯雪")
    private val zhiyao = RehearsalParticipant(id = "zhizhiyao", name = "知遥")

    @Test
    fun parseSpeakAsExtractsRolePrefixAndBareMention() {
        assertEquals(
            RoleplayParsing.SpeakInput(roleName = "张三", text = "你来了。"),
            RoleplayParsing.parseSpeakAs("@张三 你来了。"),
        )
        assertEquals(
            RoleplayParsing.SpeakInput(roleName = "千夏", text = ""),
            RoleplayParsing.parseSpeakAs("@千夏"),
        )
        assertEquals(
            RoleplayParsing.SpeakInput(text = "你来了。"),
            RoleplayParsing.parseSpeakAs("你来了。"),
        )
    }

    @Test
    fun classifySpeakTargetMatchesByNameOrIdAndFallsBackToUser() {
        assertEquals(
            SpeakTarget.Ai(zhiyao),
            RoleplayParsing.classifySpeakTarget("知遥", listOf(feixue, zhiyao)),
        )
        assertEquals(
            SpeakTarget.Ai(feixue),
            RoleplayParsing.classifySpeakTarget("feixue", listOf(feixue, zhiyao)),
        )
        assertEquals(
            SpeakTarget.User("策栖辞"),
            RoleplayParsing.classifySpeakTarget("策栖辞", listOf(feixue, zhiyao)),
        )
    }

    @Test
    fun isSilenceReplyRecognizesMarkerWithDecorations() {
        assertTrue(RoleplayParsing.isSilenceReply("沉默"))
        assertTrue(RoleplayParsing.isSilenceReply("（沉默）"))
        assertTrue(RoleplayParsing.isSilenceReply("“沉默”"))
        assertTrue(RoleplayParsing.isSilenceReply("```\n沉默\n```"))
        assertTrue(RoleplayParsing.isSilenceReply(" 默 "))
        assertFalse(RoleplayParsing.isSilenceReply("绯雪：（沉默了两秒）……没事。"))
        assertFalse(RoleplayParsing.isSilenceReply(""))
    }

    @Test
    fun parseAiReplyLinesStripsColonAndBracketLabelsIncludingDuplicates() {
        assertEquals(
            listOf(RoleLine("绯雪", "（抬头）早。", user = false)),
            RoleplayParsing.parseAiReplyLines("绯雪：（抬头）早。", listOf(feixue)),
        )
        assertEquals(
            listOf(RoleLine("绯雪", "（抬头）早。", user = false)),
            RoleplayParsing.parseAiReplyLines("[绯雪] （抬头）早。", listOf(feixue)),
        )
        assertEquals(
            listOf(RoleLine("绯雪", "（抬头）早。", user = false)),
            RoleplayParsing.parseAiReplyLines("[绯雪] [绯雪] （抬头）早。", listOf(feixue)),
        )
        assertEquals(
            listOf(RoleLine("绯雪", "（抬头）早。", user = false)),
            RoleplayParsing.parseAiReplyLines("绯雪：绯雪：（抬头）早。", listOf(feixue)),
        )
    }

    @Test
    fun parseAiReplyLinesDropsForeignLabelledLines() {
        assertEquals(
            listOf(RoleLine("知遥", "哥，你昨晚没睡好？", user = false)),
            RoleplayParsing.parseAiReplyLines(
                "知遥：哥，你昨晚没睡好？\n绯雪：（别过脸）先起来。",
                listOf(zhiyao),
                listOf("绯雪"),
            ),
        )
        assertEquals(
            emptyList<RoleLine>(),
            RoleplayParsing.parseAiReplyLines("[绯雪] （别过脸）先起来。", listOf(zhiyao), listOf("绯雪")),
        )
    }

    @Test
    fun parseAiReplyLinesAttributesBareLinesToFirstParticipant() {
        val lines = RoleplayParsing.parseAiReplyLines("（她先开口）早。", listOf(feixue, zhiyao))
        assertEquals(1, lines.size)
        assertEquals("绯雪", lines[0].speaker)
    }

    @Test
    fun buildSessionMessagesUsesQuotedFormatForOthersAndKeepsSelfAsAssistant() {
        val segment = listOf(
            RoleLine("策栖辞", "早。", user = true),
            RoleLine("绯雪", "（抬头）早。", user = false),
            RoleLine("知遥", "哥，你昨晚没睡好？", user = false),
        )
        assertEquals(
            listOf(
                RoleplayParsing.SessionMessage("user", "[user:策栖辞] 早。"),
                RoleplayParsing.SessionMessage("assistant", "[绯雪] （抬头）早。"),
                RoleplayParsing.SessionMessage("user", "知遥：「哥，你昨晚没睡好？」"),
            ),
            RoleplayParsing.buildSessionMessages(segment, "feixue", "绯雪"),
        )
        assertEquals(
            RoleplayParsing.SessionMessage("assistant", "[知遥] 哥，你昨晚没睡好？"),
            RoleplayParsing.buildSessionMessages(segment, "zhizhiyao", "知遥")[2],
        )
    }

    @Test
    fun countTranscriptLinesExcludesInstructionOnlyMentions() {
        assertEquals(2, RoleplayParsing.countTranscriptLines("[user:男主] 到了。\n[绯雪] （抬头）嗯。\n"))
        assertEquals(0, RoleplayParsing.countTranscriptLines("# 起始：两人在山上\n\n正文段"))
        assertEquals(1, RoleplayParsing.countTranscriptLines("[user:策栖辞] @千夏\n[绯雪] 嗯。"))
        assertEquals(1, RoleplayParsing.countTranscriptLines("[user:策栖辞] @千夏 端粥进来"))
    }
}

package com.ai.assistance.operit.pixie.workspace

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/**
 * 对戏记录文件测试：与电脑 pi-xie 的 roleplay.ts 行为逐项对照。
 */
class RehearsalRecordTest {

    @get:Rule
    val tmp = TemporaryFolder()

    @Test
    fun recordNamingKeepsLegacyForOneAndDeterministicForMany() {
        val cwd = tmp.root
        val single = RehearsalRecord.recordPathFor(cwd, "早饭", listOf("feixue"))
        assertTrue(single.absolutePath.endsWith("premises/rehearsals/早饭-feixue.md".replace('/', File.separatorChar)))
        val group = RehearsalRecord.recordPathFor(cwd, "早饭", listOf("zhizhiyao", "feixue"))
        val reversed = RehearsalRecord.recordPathFor(cwd, "早饭", listOf("feixue", "zhizhiyao"))
        assertEquals(group, reversed)
        assertTrue(group.absolutePath.endsWith("早饭-feixue-zhizhiyao.md".replace('/', File.separatorChar)))
    }

    @Test
    fun appendsAndReadsOnlyTheTailSegment() {
        val path = RehearsalRecord.recordPathFor(tmp.root, "深夜急诊室", listOf("林晚"))
        RehearsalRecord.appendRoleLine(path, RoleLine("林晚", "你醒了？", user = false))
        RehearsalRecord.appendRoleLine(path, RoleLine("你", "这是哪？", user = true))
        RehearsalRecord.startNewSegment(path, "两人爬到山顶，坐下休息。")
        RehearsalRecord.appendRoleLine(path, RoleLine("林晚", "新的对话。", user = false))

        assertEquals(
            listOf(RoleLine("林晚", "新的对话。", user = false)),
            RehearsalRecord.readRecordSegment(path),
        )
        assertEquals("两人爬到山顶，坐下休息。", RehearsalRecord.readSegmentSceneStart(path))

        val raw = path.readText()
        assertTrue(raw.contains("[林晚] 你醒了？"))
        assertTrue(raw.contains("[user:你] 这是哪？"))
        assertTrue(raw.contains("---"))
        assertTrue(raw.contains("# 起始：两人爬到山顶，坐下休息。"))
    }

    @Test
    fun persistsAndReadsSpeakingOrderMarker() {
        val path = RehearsalRecord.recordPathFor(tmp.root, "早饭", listOf("feixue", "zhizhiyao"))
        RehearsalRecord.startNewSegment(path, "早饭桌上。", listOf("zhizhiyao", "feixue"))
        assertEquals(listOf("zhizhiyao", "feixue"), RehearsalRecord.readSegmentOrder(path))
        assertTrue(path.readText().contains("# 顺序：zhizhiyao,feixue"))

        RehearsalRecord.rewriteRecordTail(
            path,
            "早饭桌上。",
            listOf(RoleLine("绯雪", "早。", user = false)),
            listOf("zhizhiyao", "feixue"),
        )
        assertEquals(listOf("zhizhiyao", "feixue"), RehearsalRecord.readSegmentOrder(path))
        assertEquals(
            listOf(RoleLine("绯雪", "早。", user = false)),
            RehearsalRecord.readRecordSegment(path),
        )

        // 不带顺序参数时不写标记
        RehearsalRecord.rewriteRecordTail(path, "早饭桌上。", listOf(RoleLine("绯雪", "早。", user = false)))
        assertEquals(emptyList<String>(), RehearsalRecord.readSegmentOrder(path))
    }

    @Test
    fun emptySegmentHasNoSceneStartOrOrder() {
        val path = RehearsalRecord.recordPathFor(tmp.root, "s", listOf("c"))
        RehearsalRecord.startNewSegment(path)
        assertEquals(emptyList<RoleLine>(), RehearsalRecord.readRecordSegment(path))
        assertNull(RehearsalRecord.readSegmentSceneStart(path))
        assertEquals(emptyList<String>(), RehearsalRecord.readSegmentOrder(path))
    }

    @Test
    fun rewriteRecordTailPreservesOlderSegments() {
        val path = RehearsalRecord.recordPathFor(tmp.root, "早饭", listOf("绯雪"))
        RehearsalRecord.startNewSegment(path, "早饭桌上。")
        RehearsalRecord.appendRoleLine(path, RoleLine("绯雪", "早。", user = false))
        RehearsalRecord.startNewSegment(path, "下午茶时间。")
        RehearsalRecord.appendRoleLine(path, RoleLine("绯雪", "要加糖吗？", user = false))

        RehearsalRecord.rewriteRecordTail(
            path,
            "下午茶时间。",
            listOf(
                RoleLine("绯雪", "换一句。", user = false),
                RoleLine("你", "不用了。", user = true),
            ),
        )

        val raw = path.readText()
        assertTrue(raw.contains("[绯雪] 早。")) // 旧段保留
        assertTrue(raw.contains("# 起始：下午茶时间。"))
        assertTrue(raw.contains("[绯雪] 换一句。"))
        assertTrue(raw.contains("[user:你] 不用了。"))
        assertTrue(!raw.contains("要加糖吗？"))
        assertEquals(2, RehearsalRecord.readRecordSegment(path).size)
    }

    @Test
    fun proseAppendsByDefaultAndReplacesWhenRequested() {
        val path = File(tmp.root, "premises/rehearsals/prose/test.md")
        RehearsalRecord.writeProse(path, "第一段。", replace = false)
        RehearsalRecord.writeProse(path, "第二段。", replace = false)
        assertEquals("第一段。\n第二段。\n", RehearsalRecord.readProse(path))

        RehearsalRecord.writeProse(path, "覆盖。", replace = true)
        assertEquals("覆盖。\n", RehearsalRecord.readProse(path))
    }
}

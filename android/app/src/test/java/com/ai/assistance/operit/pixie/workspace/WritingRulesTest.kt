package com.ai.assistance.operit.pixie.workspace

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * 写作规则测试：与电脑 pi-xie 的 writing-rules.ts 行为逐项对照。
 */
class WritingRulesTest {

    @get:Rule
    val tmp = TemporaryFolder()

    @Test
    fun defaultsAreAllEnabled() {
        val root = tmp.root
        val effective = WritingRules.effective(root)
        assertEquals(5, effective.size)
        assertTrue(effective.all { it.enabled })
    }

    @Test
    fun togglePersistsAndFeedsStyleText() {
        val root = tmp.root
        WritingRules.setEnabled(root, "hook", false)
        val effective = WritingRules.effective(root)
        assertEquals(false, effective.first { it.rule.id == "hook" }.enabled)

        val style = WritingRules.styleText(root, "风格约束。")
        assertTrue(style.contains("风格约束。"))
        assertTrue(style.contains("写作规则"))
        assertFalse(style.contains("章末钩子")) // 已关闭的规则不进风格文本
        assertTrue(style.contains("动作化心理")) // 开启的规则在列

        // 重读文件：开关持久化到 .pi-xie/writing-rules.json
        val overrides = WritingRules.readOverrides(root)
        assertEquals(false, overrides["hook"])
    }

    @Test
    fun pcFormatOverridesAreReadCorrectly() {
        val root = tmp.root
        java.io.File(root, ".pi-xie").mkdirs()
        java.io.File(root, ".pi-xie/writing-rules.json").writeText("{\"hook\": false, \"limited-pov\": false}\n")
        val effective = WritingRules.effective(root)
        assertEquals(false, effective.first { it.rule.id == "hook" }.enabled)
        assertEquals(false, effective.first { it.rule.id == "limited-pov" }.enabled)
        assertEquals(true, effective.first { it.rule.id == "show-dont-tell" }.enabled)
    }
}

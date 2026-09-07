package com.ai.assistance.operit.pixie.writing

import com.ai.assistance.operit.pixie.workspace.EntityKind
import com.ai.assistance.operit.pixie.workspace.WorkspaceStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * 写作 agent 工具回路测试：工具必须真实执行，结果回传内容可核对（对齐电脑 pi-xie）。
 */
class WritingAgentToolsTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun store(): WorkspaceStore {
        val store = WorkspaceStore(tmp.root)
        store.ensureWorkspace()
        return store
    }

    private fun invoke(name: String, vararg params: Pair<String, String>): String =
        WritingAgentTools.execute(store(), WritingAgentTools.ToolInvocation(name, params.toMap()))

    @Test
    fun extractInvocationsParsesXmlCalls() {
        val raw = """
            好的。
            <tool name="delete_entity"><param name="kind">character</param><param name="id">feixue</param></tool>
            <tool name="set_style"><param name="content">文艺。</param></tool>
        """.trimIndent()
        val invocations = WritingAgentTools.extractInvocations(raw)
        assertEquals(2, invocations.size)
        assertEquals("delete_entity", invocations[0].name)
        assertEquals("character", invocations[0].params["kind"])
        assertEquals("feixue", invocations[0].params["id"])
        assertEquals("文艺。", invocations[1].params["content"])
    }

    @Test
    fun entityCrudRoundtripWithRealFiles() {
        val store = store()
        val tools = { name: String, params: Map<String, String> ->
            WritingAgentTools.execute(store, WritingAgentTools.ToolInvocation(name, params))
        }

        val created = tools("create_entity", mapOf("kind" to "character", "name" to "绯雪", "body" to "红发，温柔。", "opening" to "早。"))
        assertTrue(created.startsWith("ok: 已创建"))
        // slugify 保留汉字：id = 绯雪
        assertTrue(store.getEntity(EntityKind.CHARACTERS, "绯雪").body == "红发，温柔。")

        val updated = tools("update_entity", mapOf("kind" to "character", "id" to "绯雪", "body" to "红发，温柔而敏锐。"))
        assertTrue(updated.contains("ok"))
        assertTrue(store.getEntity(EntityKind.CHARACTERS, "绯雪").body.contains("敏锐"))

        val listed = tools("list_entities", mapOf("kind" to "character"))
        assertTrue(listed.contains("绯雪：绯雪"))

        val deleted = tools("delete_entity", mapOf("kind" to "character", "id" to "绯雪"))
        assertTrue(deleted.startsWith("ok: 已删除"))
        assertFalse(java.io.File(tmp.root, "premises/characters/绯雪.md").exists())

        val undo = tools("undo_last", emptyMap())
        assertTrue(undo.contains("已撤销 delete"))
        assertTrue(java.io.File(tmp.root, "premises/characters/绯雪.md").exists())
    }

    @Test
    fun constraintAndChapterToolsWriteRealContent() {
        val store = store()
        val tools = { name: String, params: Map<String, String> ->
            WritingAgentTools.execute(store, WritingAgentTools.ToolInvocation(name, params))
        }
        assertTrue(tools("set_worldview", mapOf("content" to "现代都市修仙。")).startsWith("ok"))
        assertTrue(tools("read_constraint", mapOf("name" to "worldview")).contains("现代都市修仙。"))

        assertTrue(tools("write_chapter", mapOf("content" to "第一章。")).contains("001.md"))
        assertTrue(tools("list_chapters", emptyMap()).contains("001.md"))
        assertTrue(tools("read_chapter", mapOf("chapter" to "001.md")).contains("第一章。"))
        assertTrue(tools("rewrite_chapter", mapOf("chapter" to "001.md", "content" to "改写后。")).startsWith("ok"))
        assertTrue(tools("read_chapter", mapOf("chapter" to "001.md")).contains("改写后。"))
    }

    @Test
    fun errorsReportRealFailureInsteadOfFakeSuccess() {
        val store = store()
        val result = WritingAgentTools.execute(
            store,
            WritingAgentTools.ToolInvocation("delete_entity", mapOf("kind" to "character", "id" to "不存在")),
        )
        assertTrue(result.startsWith("error:"))
    }
}

package com.ai.assistance.operit.pixie.workspace

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * 工作区文件格式测试：与电脑 pi-xie 的 workspace.ts 行为逐项对照。
 */
class WorkspaceTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun store(): WorkspaceStore {
        val store = WorkspaceStore(tmp.root)
        store.ensureWorkspace()
        return store
    }

    @Test
    fun ensureWorkspaceCreatesStandardLayout() {
        val root = tmp.root
        store()
        assertTrue(File(root, "premises/characters").isDirectory)
        assertTrue(File(root, "premises/scenes").isDirectory)
        assertTrue(File(root, "chapters").isDirectory)
        assertTrue(File(root, "premises/active.json").isFile)
        for (constraint in listOf("worldview", "outline", "timeline", "style")) {
            assertTrue(File(root, "premises/$constraint.md").isFile)
        }
        assertTrue(File(root, "manuscript.txt").isFile)
    }

    @Test
    fun entityFrontmatterRoundtripMatchesPiXieFormat() {
        val store = store()
        val entity = store.createEntity(
            kind = EntityKind.CHARACTERS,
            name = "绯雪",
            body = "红发，温柔而敏锐。",
            tags = listOf("女主"),
            opening = "（开场）你来了。",
            system = "自定义提示词。",
        )
        val raw = entity.path.readText()
        // frontmatter 是 JSON 元数据（pi-xie 的 encodeFrontmatter 格式）
        assertTrue(raw.startsWith("---\n"))
        assertTrue(raw.contains("\"id\": \"${entity.id}\""))
        assertTrue(raw.contains("\"name\": \"绯雪\""))
        assertTrue(raw.contains("\"opening\": \"（开场）你来了。\""))
        assertTrue(raw.contains("---\n红发，温柔而敏锐。\n"))

        val loaded = store.getEntity(EntityKind.CHARACTERS, entity.id)
        assertEquals("绯雪", loaded.name)
        assertEquals("红发，温柔而敏锐。", loaded.body)
        assertEquals(listOf("女主"), loaded.tags)
        assertEquals("（开场）你来了。", loaded.opening)
        assertEquals("自定义提示词。", loaded.system)
    }

    @Test
    fun slugifyMatchesPiXie() {
        // 电脑 pi-xie 的 slugify 保留汉字（不做拼音转写），只折叠分隔符
        assertEquals("绯雪", WorkspaceStore.slugify("绯雪"))
        assertEquals("早饭", WorkspaceStore.slugify("早饭"))
        assertEquals("a-b", WorkspaceStore.slugify(" a  b "))
        assertEquals("才明-2号", WorkspaceStore.slugify("才明 2号"))
    }

    @Test
    fun chaptersAndManuscript() {
        val store = store()
        val first = store.writeChapter("第一段内容。")
        val second = store.writeChapter("第二段内容。")
        assertEquals(1, first.number)
        assertEquals("001.md", first.file)
        assertEquals(2, second.number)

        val manuscript = File(tmp.root, "manuscript.txt").readText()
        assertTrue(manuscript.contains("第1章\n\n第一段内容。"))
        assertTrue(manuscript.contains("第2章\n\n第二段内容。"))

        store.rewriteChapter("改写后的内容。", "001.md")
        val rewritten = File(tmp.root, "manuscript.txt").readText()
        assertTrue(rewritten.contains("改写后的内容。"))
        assertTrue(!rewritten.contains("第一段内容。"))
    }

    @Test
    fun constraintsAndActive() {
        val store = store()
        store.writeConstraint("worldview", "现代都市修仙。")
        assertEquals("现代都市修仙。\n", store.readConstraint("worldview"))

        store.selectPremises(ActivePremises(characters = listOf("ceqici"), scenes = listOf("scene-1")))
        val active = store.getActive()
        assertEquals(listOf("ceqici"), active.characters)
        assertEquals(listOf("scene-1"), active.scenes)
    }
}

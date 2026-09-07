package com.ai.assistance.operit.pixie.workspace

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
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

    @Test
    fun undoRestoresEntityCreateUpdateDelete() {
        val store = store()
        // 新建 → 撤销删除文件
        val created = store.createEntity(EntityKind.CHARACTERS, "绯雪", "红发。", id = "feixue")
        assertTrue(store.hasUndo())
        val snapshot1 = store.undoLast()
        assertEquals("create", snapshot1?.action)
        assertFalse(created.path.exists())
        assertFalse(store.hasUndo())

        // 修改 → 撤销恢复旧内容
        val entity = store.createEntity(EntityKind.CHARACTERS, "绯雪", "红发。", id = "feixue")
        store.updateEntity(EntityKind.CHARACTERS, entity.id, body = "被覆盖的外貌。")
        val snapshot2 = store.undoLast()
        assertEquals("update", snapshot2?.action)
        assertEquals("红发。", store.getEntity(EntityKind.CHARACTERS, "feixue").body)

        // 删除 → 撤销恢复文件
        store.deleteEntity(EntityKind.CHARACTERS, "feixue")
        assertFalse(File(tmp.root, "premises/characters/feixue.md").exists())
        val snapshot3 = store.undoLast()
        assertEquals("delete", snapshot3?.action)
        assertTrue(store.getEntity(EntityKind.CHARACTERS, "feixue").path.exists())
        assertNull(store.undoLast()) // 快照已清空
    }

    @Test
    fun undoRestoresConstraintAndChapterWithManuscript() {
        val store = store()
        store.writeConstraint("worldview", "旧设定。")
        store.writeConstraint("worldview", "新设定。")
        store.undoLast()
        assertEquals("旧设定。\n", store.readConstraint("worldview"))

        val chapter = store.writeChapter("第一章内容。")
        store.rewriteChapter("被改写的内容。", chapter.file)
        store.undoLast()
        assertEquals("第一章内容。\n", store.readChapter(chapter.file).content)
        assertTrue(File(tmp.root, "manuscript.txt").readText().contains("第一章内容。"))
    }
}

package com.ai.assistance.operit.pixie.workspace

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * 工作区 zip 导入/导出测试：
 * 与电脑 pi-xie 工作区互拷的格式（zip 根直接含 premises/chapters/.pi-xie/manuscript.txt）。
 */
class WorkspaceTransferTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun sampleWorkspace(): File {
        val root = tmp.newFolder("source")
        File(root, "premises/characters").mkdirs()
        File(root, "premises/scenes").mkdirs()
        File(root, "premises/rehearsals/prose").mkdirs()
        File(root, "chapters").mkdirs()
        File(root, ".pi-xie").mkdirs()
        File(root, "premises/characters/feixue.md").writeText("---\n{\"id\":\"feixue\",\"name\":\"绯雪\"}\n---\n红发。\n")
        File(root, "premises/worldview.md").writeText("现代都市修仙。\n")
        File(root, "premises/rehearsals/a-feixue.md").writeText("# 起始：山门\n[绯雪] 早。\n")
        File(root, "chapters/001.md").writeText("第一章。\n")
        File(root, "manuscript.txt").writeText("第1章\n\n第一章。\n")
        File(root, ".pi-xie/armor.json").writeText("{\"enabled\":true}\n")
        // 工作区之外的散文件：导出时忽略
        File(root, "tavern_card.json").writeText("{}")
        return root
    }

    @Test
    fun exportImportRoundtripPreservesWorkspace() {
        val source = sampleWorkspace()
        val bytes = ByteArrayOutputStream()
        WorkspaceTransfer.exportZip(source, bytes)

        val target = tmp.newFolder("target")
        val result = WorkspaceTransfer.importZip(target, ByteArrayInputStream(bytes.toByteArray()))
        assertEquals(0, result.notes.size)
        assertEquals(6, result.entryCount)

        assertEquals("红发。", File(target, "premises/characters/feixue.md").readText().lineSequence().last { it.isNotBlank() })
        assertEquals("现代都市修仙。\n", File(target, "premises/worldview.md").readText())
        assertEquals("# 起始：山门\n[绯雪] 早。\n", File(target, "premises/rehearsals/a-feixue.md").readText())
        assertEquals("第一章。\n", File(target, "chapters/001.md").readText())
        assertEquals("{\"enabled\":true}\n", File(target, ".pi-xie/armor.json").readText())
        assertFalse(File(target, "tavern_card.json").exists()) // 顶层散文件不随工作区走
    }

    @Test
    fun rejectsPathTraversalEntries() {
        val bytes = ByteArrayOutputStream()
        ZipOutputStream(bytes).use { zip ->
            zip.putNextEntry(ZipEntry("premises/characters/ok.md"))
            zip.write("ok".toByteArray())
            zip.closeEntry()
            zip.putNextEntry(ZipEntry("../evil.txt"))
            zip.write("evil".toByteArray())
            zip.closeEntry()
            zip.putNextEntry(ZipEntry("premises/../../evil2.txt"))
            zip.write("evil2".toByteArray())
            zip.closeEntry()
        }
        val target = tmp.newFolder("target")
        val result = WorkspaceTransfer.importZip(target, ByteArrayInputStream(bytes.toByteArray()))
        assertEquals(1, result.entryCount)
        assertTrue(result.notes.any { it.contains("穿越") })
        assertTrue(File(target, "premises/characters/ok.md").exists()) // 正常条目照常导入
        assertFalse(File(target, "evil.txt").exists()) // 穿越条目未逃逸到工作区根
        assertFalse(File(target.parentFile, "evil2.txt").exists())
    }

    @Test
    fun foreignTopLevelEntriesAreIgnoredWithNote() {
        val bytes = ByteArrayOutputStream()
        ZipOutputStream(bytes).use { zip ->
            zip.putNextEntry(ZipEntry("premises/worldview.md"))
            zip.write("设定".toByteArray())
            zip.closeEntry()
            zip.putNextEntry(ZipEntry("movies/m1.mp4"))
            zip.write("x".toByteArray())
            zip.closeEntry()
        }
        val target = tmp.newFolder("target")
        val result = WorkspaceTransfer.importZip(target, ByteArrayInputStream(bytes.toByteArray()))
        assertEquals(1, result.entryCount)
        assertTrue(result.notes.any { it.contains("movies") })
        assertTrue(File(target, "premises/worldview.md").exists())
        assertFalse(File(target, "movies/m1.mp4").exists())
    }

    @Test
    fun zipWithoutPremisesIsReported() {
        val bytes = ByteArrayOutputStream()
        ZipOutputStream(bytes).use { zip ->
            zip.putNextEntry(ZipEntry("chapters/001.md"))
            zip.write("章".toByteArray())
            zip.closeEntry()
        }
        val target = tmp.newFolder("target")
        val result = WorkspaceTransfer.importZip(target, ByteArrayInputStream(bytes.toByteArray()))
        assertTrue(result.notes.any { it.contains("premises") })
    }
}

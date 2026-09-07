package com.ai.assistance.operit.pixie.workspace

import java.io.BufferedOutputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * 写作工作区的 zip 导入/导出，与电脑 pi-xie 工作区互拷：
 * zip 根直接包含 premises/、chapters/、.pi-xie/、manuscript.txt
 * （即「打包工作区目录本身」，不额外套一层文件夹）。
 * 导入只接受这些顶层条目，拒绝路径穿越与绝对路径。
 */
object WorkspaceTransfer {

    val TOP_LEVEL_ENTRIES = setOf("premises", "chapters", ".pi-xie", "manuscript.txt")

    const val MAX_ENTRIES = 2000
    const val MAX_ENTRY_BYTES = 50L * 1024 * 1024

    data class ImportPlan(
        val totalFiles: Int,
        val conflicts: List<String>,
        val newFiles: List<String>,
        val notes: List<String>,
    )

    /** 只解析不落盘：列出将覆盖的冲突文件与新增文件（供导入确认对话框使用）。 */
    fun planImport(workspaceRoot: File, input: InputStream): ImportPlan {
        val rootCanonical = workspaceRoot.canonicalFile
        val conflicts = mutableListOf<String>()
        val newFiles = mutableListOf<String>()
        val notes = mutableListOf<String>()
        var total = 0
        var premisesSeen = false
        ZipInputStream(input).use { zip ->
            var entry = zip.nextEntry
            while (entry != null) {
                if (!entry.isDirectory) {
                    val name = entry.name.replace('\\', '/')
                    val top = name.substringBefore('/')
                    if (top in TOP_LEVEL_ENTRIES) {
                        val target = File(rootCanonical, name).canonicalFile
                        when {
                            !target.path.startsWith(rootCanonical.path + File.separator) ->
                                notes.add("拒绝路径穿越条目：$name")
                            entry.size > MAX_ENTRY_BYTES ->
                                notes.add("忽略超大文件（>50MB）：$name")
                            else -> {
                                total++
                                if (top == "premises") premisesSeen = true
                                if (target.exists()) conflicts.add(name) else newFiles.add(name)
                            }
                        }
                    } else {
                        notes.add("忽略未知顶层条目：$top/")
                    }
                }
                zip.closeEntry()
                entry = zip.nextEntry
            }
        }
        if (!premisesSeen) {
            notes.add("zip 中没有 premises/ 目录，工作区内容不会被导入")
        }
        if (total > MAX_ENTRIES) {
            notes.add("文件数超过 $MAX_ENTRIES 上限，请分批导入")
        }
        return ImportPlan(total, conflicts, newFiles, notes)
    }

    fun exportZip(workspaceRoot: File, output: OutputStream) {
        ZipOutputStream(BufferedOutputStream(output)).use { zip ->
            val rootPath = workspaceRoot.canonicalFile.toPath()
            fun walk(dir: File) {
                dir.listFiles()?.sortedBy { it.name }?.forEach { file ->
                    val relative = rootPath.relativize(file.canonicalFile.toPath())
                        .toString()
                        .replace('\\', '/')
                    if (file.isDirectory) {
                        zip.putNextEntry(ZipEntry("$relative/"))
                        zip.closeEntry()
                        walk(file)
                    } else if (relative.substringBefore('/') in TOP_LEVEL_ENTRIES) {
                        zip.putNextEntry(ZipEntry(relative))
                        file.inputStream().use { it.copyTo(zip) }
                        zip.closeEntry()
                    }
                }
            }
            walk(workspaceRoot)
        }
    }

    data class ImportResult(val entryCount: Int, val skipped: List<String>, val notes: List<String>)

    /**
     * 导入工作区 zip。overwrite=false 时跳过已存在的文件（保留本地内容），
     * 跳过清单在 [ImportResult.skipped] 中返回。
     */
    fun importZip(workspaceRoot: File, input: InputStream, overwrite: Boolean): ImportResult {
        val notes = mutableListOf<String>()
        val skipped = mutableListOf<String>()
        val rootCanonical = workspaceRoot.canonicalFile
        var count = 0
        var premisesSeen = false
        ZipInputStream(input).use { zip ->
            var entry = zip.nextEntry
            while (entry != null && count < MAX_ENTRIES) {
                if (!entry.isDirectory) {
                    val name = entry.name.replace('\\', '/')
                    val top = name.substringBefore('/')
                    if (top in TOP_LEVEL_ENTRIES) {
                        val target = File(rootCanonical, name).canonicalFile
                        when {
                            !target.path.startsWith(rootCanonical.path + File.separator) ->
                                notes.add("拒绝路径穿越条目：$name")
                            entry.size > MAX_ENTRY_BYTES ->
                                notes.add("忽略超大文件（>50MB）：$name")
                            target.exists() && !overwrite ->
                                skipped.add(name)
                            else -> {
                                target.parentFile?.mkdirs()
                                target.outputStream().use { zip.copyTo(it) }
                                count++
                                if (top == "premises") premisesSeen = true
                            }
                        }
                    } else {
                        notes.add("忽略未知顶层条目：$top/")
                    }
                }
                zip.closeEntry()
                entry = zip.nextEntry
            }
            if (count >= MAX_ENTRIES) {
                notes.add("文件数超过 $MAX_ENTRIES 上限，剩余条目未导入")
            }
        }
        if (!premisesSeen) {
            notes.add("zip 中没有 premises/ 目录，工作区内容未被导入")
        }
        return ImportResult(count, skipped, notes)
    }
}

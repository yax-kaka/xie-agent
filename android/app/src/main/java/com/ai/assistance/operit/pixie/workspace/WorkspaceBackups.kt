package com.ai.assistance.operit.pixie.workspace

import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 工作区备份：zip 备份到工作区之外的目录（避免备份被自身导出/导入递归包含）。
 * 导入 zip 前自动备份 + 手动备份/恢复，是人物设定被误改后的恢复手段。
 */
object WorkspaceBackups {

    data class BackupInfo(val file: File, val label: String, val timestamp: Long, val size: Long)

    private val timeFormat = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT)

    /** 创建备份：workspaceRoot 打包为 <label>-<时间戳>.zip；返回备份文件。 */
    fun createBackup(workspaceRoot: File, backupsDir: File, label: String): File {
        backupsDir.mkdirs()
        val file = File(backupsDir, "$label-${timeFormat.format(Date())}.zip")
        file.outputStream().use { WorkspaceTransfer.exportZip(workspaceRoot, it) }
        return file
    }

    /** 列出备份（按时间倒序，新的在前）。 */
    fun listBackups(backupsDir: File): List<BackupInfo> {
        if (!backupsDir.exists()) return emptyList()
        return backupsDir.listFiles()
            ?.filter { it.isFile && it.name.endsWith(".zip") }
            ?.mapNotNull { file ->
                val match = Regex("^(.+)-(\\d{8}-\\d{6})\\.zip$").find(file.name) ?: return@mapNotNull null
                BackupInfo(file = file, label = match.groupValues[1], timestamp = file.lastModified(), size = file.length())
            }
            ?.sortedByDescending { it.timestamp }
            ?: emptyList()
    }

    /**
     * 从备份恢复：先把当前工作区再备份一次（防止误恢复二次破坏），
     * 再用备份 zip 覆盖工作区（覆盖全部文件）。返回（自动备份文件, 导入结果）。
     */
    fun restoreBackup(workspaceRoot: File, backupsDir: File, backupFile: File): Pair<File, WorkspaceTransfer.ImportResult> {
        val safety = createBackup(workspaceRoot, backupsDir, "before-restore")
        val result = backupFile.inputStream().use { input ->
            WorkspaceTransfer.importZip(workspaceRoot, input, overwrite = true)
        }
        return safety to result
    }
}

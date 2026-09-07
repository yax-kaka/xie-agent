package com.ai.assistance.operit.pixie.workspace

import android.content.Context
import java.io.File

/**
 * Android 端 pi-xie 工作区根目录解析。
 * 默认放在应用私有目录 filesDir/pi-xie-workspace（电脑版互拷目录由 Phase 3 的导入/导出入口接管）。
 */
object PixieWorkspace {
    fun root(context: Context): File = File(context.filesDir, "pi-xie-workspace")

    fun store(context: Context): WorkspaceStore =
        WorkspaceStore(root(context)).also { it.ensureWorkspace() }
}

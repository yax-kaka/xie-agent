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

    /** 破甲开关：.pi-xie/armor.json（{"enabled": bool}，与电脑 pi-xie 格式一致）。 */
    fun isArmorBreakEnabled(context: Context): Boolean {
        val path = File(root(context), ".pi-xie/armor.json")
        if (!path.exists()) return false
        return try {
            val parsed = com.google.gson.Gson().fromJson(
                path.readText(),
                com.google.gson.reflect.TypeToken.get(
                    Map::class.java,
                ),
            ) as? Map<*, *>
            parsed?.get("enabled") == true
        } catch (e: Exception) {
            false
        }
    }

    fun setArmorBreakEnabled(context: Context, enabled: Boolean) {
        val path = File(root(context), ".pi-xie/armor.json")
        path.parentFile?.mkdirs()
        path.writeText("""{"enabled": $enabled}""" + "\n")
    }

    /** 自动写入开关：.pi-xie/permissions.json（{"autoWrite": bool}，与电脑一致）。 */
    fun isAutoWriteEnabled(context: Context): Boolean {
        val path = File(root(context), ".pi-xie/permissions.json")
        if (!path.exists()) return false
        return try {
            val parsed = com.google.gson.Gson().fromJson(
                path.readText(),
                com.google.gson.reflect.TypeToken.get(Map::class.java),
            ) as? Map<*, *>
            parsed?.get("autoWrite") == true
        } catch (e: Exception) {
            false
        }
    }

    fun setAutoWriteEnabled(context: Context, enabled: Boolean) {
        val path = File(root(context), ".pi-xie/permissions.json")
        path.parentFile?.mkdirs()
        path.writeText("""{"autoWrite": $enabled}""" + "\n")
    }

    /** 用户默认扮演角色：.pi-xie/user-role.json（{"roleId": "id"|null}，与电脑一致）。 */
    fun getDefaultUserRole(context: Context): String? {
        val path = File(root(context), ".pi-xie/user-role.json")
        if (!path.exists()) return null
        return try {
            val parsed = com.google.gson.Gson().fromJson(
                path.readText(),
                com.google.gson.reflect.TypeToken.get(Map::class.java),
            ) as? Map<*, *>
            (parsed?.get("roleId") as? String)?.takeIf { it.isNotBlank() }
        } catch (e: Exception) {
            null
        }
    }

    fun setDefaultUserRole(context: Context, roleId: String?) {
        val path = File(root(context), ".pi-xie/user-role.json")
        path.parentFile?.mkdirs()
        val value = if (roleId == null) "null" else "\"$roleId\""
        path.writeText("""{"roleId": $value}""" + "\n")
    }
}

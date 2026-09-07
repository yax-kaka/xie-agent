package com.ai.assistance.operit.pixie.workspace

import android.content.Context
import java.io.File

/**
 * Android 端 pi-xie 工作区根目录解析与多工作区管理。
 * - 历史目录 files/pi-xie-workspace 作为「默认」工作区（已有数据不变）；
 * - 新建工作区放在 files/pi-xie-workspaces/<名称>/；
 * - 活跃工作区名持久化在 SharedPreferences。
 */
object PixieWorkspace {
    const val DEFAULT_WORKSPACE_NAME = "默认"
    private const val PREFS_NAME = "pixie_workspace_prefs"
    private const val KEY_ACTIVE = "active_workspace"

    fun workspacesRoot(context: Context): File = File(context.filesDir, "pi-xie-workspaces")

    fun activeWorkspaceName(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_ACTIVE, null) ?: DEFAULT_WORKSPACE_NAME
    }

    fun setActiveWorkspace(context: Context, name: String) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit().putString(KEY_ACTIVE, name).apply()
    }

    /** 工作区根目录：默认 → files/pi-xie-workspace（历史目录），其余 → pi-xie-workspaces/<名称>。 */
    fun root(context: Context): File {
        val name = activeWorkspaceName(context)
        return if (name == DEFAULT_WORKSPACE_NAME) {
            File(context.filesDir, "pi-xie-workspace")
        } else {
            File(workspacesRoot(context), name)
        }
    }

    fun listWorkspaces(context: Context): List<String> {
        val names = mutableListOf(DEFAULT_WORKSPACE_NAME)
        workspacesRoot(context).listFiles()
            ?.filter { it.isDirectory }
            ?.map { it.name }
            ?.sorted()
            ?.let { names.addAll(it) }
        return names
    }

    /** 新建工作区（目录 + 骨架），返回名称；已存在则抛异常。 */
    fun createWorkspace(context: Context, name: String): String {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) throw IllegalArgumentException("名称不能为空")
        if (trimmed == DEFAULT_WORKSPACE_NAME) throw IllegalArgumentException("名称与默认工作区冲突")
        val dir = File(workspacesRoot(context), trimmed)
        if (dir.exists()) throw IllegalArgumentException("工作区已存在：$trimmed")
        WorkspaceStore(dir).ensureWorkspace()
        return trimmed
    }

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

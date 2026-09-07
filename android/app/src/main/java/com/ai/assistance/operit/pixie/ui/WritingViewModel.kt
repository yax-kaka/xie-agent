package com.ai.assistance.operit.pixie.ui

import android.app.Application
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.ai.assistance.operit.data.model.CharacterCard
import com.ai.assistance.operit.data.model.ChatMessage
import com.ai.assistance.operit.data.preferences.CharacterCardManager
import com.ai.assistance.operit.pixie.prompt.PixiePrompts
import com.ai.assistance.operit.pixie.rehearsal.AIServiceTurnRunner
import com.ai.assistance.operit.pixie.roleplay.RoleplayParsing.SessionMessage
import com.ai.assistance.operit.pixie.workspace.EntityKind
import com.ai.assistance.operit.pixie.workspace.EntityRecord
import com.ai.assistance.operit.pixie.workspace.PixieWorkspace
import com.ai.assistance.operit.pixie.workspace.WorkspaceStore
import com.ai.assistance.operit.pixie.workspace.WorkspaceTransfer
import com.ai.assistance.operit.util.ImagePoolManager
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 写作工作区 ViewModel：
 * - 前提面板（世界观/大纲/时间线/风格/角色/场景）直接读写工作区文件；
 * - 写作对话：AI 只输出文本提案，落盘由用户点保存（杜绝虚假成功）；
 * - zip 导入/导出（与电脑 pi-xie 工作区互拷）。
 */
class WritingViewModel(application: Application) : AndroidViewModel(application) {

    val store: WorkspaceStore = PixieWorkspace.store(application)
    private val runner = AIServiceTurnRunner(application)

    /** 直接使用 Operit 的 ChatMessage 模型，气泡组件拿来即用。 */
    val messages = mutableStateListOf<ChatMessage>()
    var busy by mutableStateOf(false)
    var notice by mutableStateOf("")
    var unrestricted by mutableStateOf(true)

    /** 约束内容：worldview/outline/timeline/style → 文本。 */
    val constraints = mutableStateMapOf<String, String>()
    var characters by mutableStateOf(emptyList<EntityRecord>())
    var scenes by mutableStateOf(emptyList<EntityRecord>())

    /** 起草流：编辑器对话框直接消费。 */
    var drafting by mutableStateOf(false)
    var draftText by mutableStateOf("")
    var draftTitle by mutableStateOf("")

    /** 待发送附件：图片进入 ImagePool，文本文件读入内容。 */
    data class PendingAttachment(
        val kind: String, // "image" | "file"
        val label: String,
        val imageId: String?,
        val text: String?,
    )

    val pendingAttachments = mutableStateListOf<PendingAttachment>()

    fun loadPremises() {
        viewModelScope.launch(Dispatchers.IO) { loadPremisesInternal() }
    }

    private suspend fun loadPremisesInternal() {
        for (name in listOf("worldview", "outline", "timeline", "style")) {
            constraints[name] = store.readConstraint(name)
        }
        characters = store.listEntities(EntityKind.CHARACTERS)
        scenes = store.listEntities(EntityKind.SCENES)
    }

    private fun systemPrompt(): String = PixiePrompts.buildWritingSystemPrompt(
        unrestricted = unrestricted,
        worldview = constraints["worldview"] ?: "",
        outline = constraints["outline"] ?: "",
        timeline = constraints["timeline"] ?: "",
        style = constraints["style"] ?: "",
        characterSummaries = characters.map { "${it.name}：${it.body.take(120)}" },
        sceneSummaries = scenes.map { "${it.name}：${it.body.take(120)}" },
    )

    /** 写作对话：AI 只回复文本提案；保存动作只在用户点按钮时发生。 */
    fun send(raw: String) {
        if (busy) return
        viewModelScope.launch {
            busy = true
            // 附件与文本合并成一条用户消息（图片用 Operit 的 image link 协议）
            val attachmentBlock = pendingAttachments.joinToString("\n") { attachment ->
                if (attachment.kind == "image") {
                    """<link type="image" id="${attachment.imageId}"></link>"""
                } else {
                    "【附件：${attachment.label}】\n${attachment.text}"
                }
            }
            pendingAttachments.clear()
            val content = if (attachmentBlock.isEmpty()) raw else "$raw\n\n$attachmentBlock"
            messages.add(ChatMessage(sender = "user", content = content))
            messages.add(ChatMessage(sender = "ai", content = "", roleName = "写作助理"))
            val last = messages.lastIndex
            try {
                runner.runTurn(
                    systemPrompt = systemPrompt(),
                    history = messages.dropLast(1).map { SessionMessage(it.sender, it.content) },
                    extraUser = content,
                    onDelta = { delta ->
                        messages[last] = messages[last].copy(content = messages[last].content + delta)
                    },
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notice = "写作请求失败：${e.message}"
            } finally {
                busy = false
                if (messages[last].content.isBlank()) {
                    messages[last] = messages[last].copy(content = "（无回复）")
                }
            }
        }
    }

    /** 添加图片附件（＋ 面板）：注册进 ImagePool，随下一条消息发送给视觉模型。 */
    fun attachImage(path: String) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val id = ImagePoolManager.addImage(path)
                pendingAttachments.add(
                    PendingAttachment(kind = "image", label = File(path).name, imageId = id, text = null),
                )
                notice = "已添加图片 ${File(path).name}"
            } catch (e: Exception) {
                notice = "添加图片失败：${e.message}"
            }
        }
    }

    /** 添加文件附件：读取文本内容（最多 4000 字）随下一条消息发送。 */
    fun attachFile(path: String) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val file = File(path)
                val text = file.readText().take(4000)
                pendingAttachments.add(
                    PendingAttachment(kind = "file", label = file.name, imageId = null, text = text),
                )
                notice = "已添加文件 ${file.name}（内容随下一条消息发送）"
            } catch (e: Exception) {
                notice = "读取文件失败：${e.message}（仅支持文本文件）"
            }
        }
    }

    fun removeAttachment(index: Int) {
        if (index in pendingAttachments.indices) pendingAttachments.removeAt(index)
    }

    /** SAF 内容 Uri → 本地缓存文件路径（图片注册/角色立绘共用）。 */
    fun copyUriToCache(uri: Uri): String? {
        return try {
            val context = getApplication<Application>()
            val resolver = context.contentResolver
            val mime = resolver.getType(uri) ?: "image/png"
            val ext = when {
                mime.contains("png") -> "png"
                mime.contains("webp") -> "webp"
                mime.contains("gif") -> "gif"
                else -> "jpg"
            }
            val file = File(context.cacheDir, "attach-${System.currentTimeMillis()}.$ext")
            resolver.openInputStream(uri)?.use { input ->
                file.outputStream().use { input.copyTo(it) }
            } ?: return null
            file.absolutePath
        } catch (e: Exception) {
            notice = "读取所选文件失败：${e.message}"
            null
        }
    }

    /** 把写作角色卡导出为 Operit 角色卡（AI 对话可用，气泡头像按此查找）。 */
    fun exportCharacterToOperit(id: String) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val entity = store.getEntity(EntityKind.CHARACTERS, id)
                val card = CharacterCard(
                    id = "",
                    name = entity.name,
                    description = entity.body,
                    characterSetting = entity.body,
                    openingStatement = entity.opening,
                    advancedCustomPrompt = entity.system,
                    isDefault = false,
                )
                CharacterCardManager.getInstance(getApplication()).createCharacterCard(card)
                notice = "已导出到 Operit 角色卡「${entity.name}」"
            } catch (e: Exception) {
                notice = "导出角色卡失败：${e.message}"
            }
        }
    }

    /** 角色图片：保存到工作区（premises/characters/images/，电脑 pi-xie 不受影响）。 */
    fun storeCharacterImage(id: String, sourcePath: String): String? {
        return try {
            val file = File(sourcePath)
            val ext = file.extension.ifBlank { "png" }
            val imagesDir = File(PixieWorkspace.root(getApplication()), "premises/characters/images")
            imagesDir.mkdirs()
            val target = File(imagesDir, "$id.$ext")
            file.copyTo(target, overwrite = true)
            target.absolutePath
        } catch (e: Exception) {
            notice = "保存角色图片失败：${e.message}"
            null
        }
    }

    /** 让写作 agent 看角色图片并更新外貌（输出完整设定正文，流式写入 draftText，由角色编辑框采纳）。 */
    fun draftAppearance(charId: String, charName: String, imagePath: String) {
        if (busy) return
        viewModelScope.launch(Dispatchers.IO) {
            busy = true
            drafting = true
            draftTitle = "外貌：$charName"
            draftText = ""
            try {
                val imageId = ImagePoolManager.addImage(imagePath)
                val currentBody = try {
                    store.getEntity(EntityKind.CHARACTERS, charId).body
                } catch (e: IllegalArgumentException) {
                    ""
                }
                runner.runTurn(
                    systemPrompt = systemPrompt(),
                    history = emptyList(),
                    extraUser = PixiePrompts.buildAppearanceUpdateInstruction(imageId, charName, currentBody),
                    onDelta = { delta -> draftText += delta },
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notice = "外貌分析失败：${e.message}"
            } finally {
                busy = false
                drafting = false
            }
        }
    }

    /** 起草某前提：结果流式写入 draftText，由编辑器对话框保存。 */
    fun draftConstraint(name: String) {
        if (busy) return
        val title = when (name) {
            "worldview" -> "世界观"
            "outline" -> "大纲"
            "timeline" -> "时间线"
            else -> "风格"
        }
        viewModelScope.launch {
            busy = true
            drafting = true
            draftTitle = title
            draftText = ""
            val current = constraints[name] ?: ""
            val prompt = buildString {
                append("请为「$title」起草一份完整的设定内容。")
                if (current.isNotBlank()) {
                    append("\n当前内容（在此基础上完善，输出完整新文本）：\n<当前>\n$current\n</当前>")
                }
                append("\n直接输出设定正文，不要任何前后缀、解释或 Markdown 标题。")
            }
            try {
                runner.runTurn(
                    systemPrompt = systemPrompt(),
                    history = emptyList(),
                    extraUser = prompt,
                    onDelta = { delta -> draftText += delta },
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notice = "起草失败：${e.message}"
            } finally {
                busy = false
                drafting = false
            }
        }
    }

    fun saveConstraint(name: String, content: String) {
        viewModelScope.launch(Dispatchers.IO) {
            store.writeConstraint(name, content)
            loadPremisesInternal()
            notice = "已保存"
        }
    }

    fun saveCharacter(id: String?, name: String, body: String) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                if (id == null) {
                    val record = store.createEntity(EntityKind.CHARACTERS, name, body)
                    notice = "已创建角色「${record.name}」"
                } else {
                    val record = store.updateEntity(EntityKind.CHARACTERS, id, name = name, body = body)
                    notice = "已更新角色「${record.name}」"
                }
                loadPremisesInternal()
            } catch (e: Exception) {
                notice = "保存角色失败：${e.message}"
            }
        }
    }

    fun saveScene(id: String?, name: String, body: String) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                if (id == null) {
                    val record = store.createEntity(EntityKind.SCENES, name, body)
                    notice = "已创建场景「${record.name}」"
                } else {
                    val record = store.updateEntity(EntityKind.SCENES, id, name = name, body = body)
                    notice = "已更新场景「${record.name}」"
                }
                loadPremisesInternal()
            } catch (e: Exception) {
                notice = "保存场景失败：${e.message}"
            }
        }
    }

    fun importWorkspace(uri: Uri) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val context = getApplication<Application>()
                val result = context.contentResolver.openInputStream(uri)?.use { input ->
                    WorkspaceTransfer.importZip(PixieWorkspace.root(context), input)
                } ?: WorkspaceTransfer.ImportResult(0, listOf("无法读取所选文件"))
                loadPremisesInternal()
                notice = if (result.notes.isEmpty()) {
                    "已导入 ${result.entryCount} 个文件"
                } else {
                    "导入完成（${result.entryCount} 个文件）：${result.notes.joinToString("；")}"
                }
            } catch (e: Exception) {
                notice = "导入失败：${e.message}"
            }
        }
    }

    fun exportWorkspace(uri: Uri) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val context = getApplication<Application>()
                val output = context.contentResolver.openOutputStream(uri)
                    ?: throw IllegalStateException("无法写入所选位置")
                output.use { WorkspaceTransfer.exportZip(PixieWorkspace.root(context), it) }
                notice = "已导出工作区 zip"
            } catch (e: Exception) {
                notice = "导出失败：${e.message}"
            }
        }
    }

    fun abort() {
        runner.abort()
    }

    override fun onCleared() {
        runner.abort()
        super.onCleared()
    }
}

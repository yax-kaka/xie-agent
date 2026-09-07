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
import com.ai.assistance.operit.pixie.writing.WritingAgentTools
import com.ai.assistance.operit.pixie.workspace.ActivePremises
import com.ai.assistance.operit.pixie.workspace.EntityKind
import com.ai.assistance.operit.pixie.workspace.EntityRecord
import com.ai.assistance.operit.pixie.workspace.PixieWorkspace
import com.ai.assistance.operit.pixie.workspace.TavernCard
import com.ai.assistance.operit.pixie.workspace.WorkspaceBackups
import com.ai.assistance.operit.pixie.workspace.WorkspaceStore
import com.ai.assistance.operit.pixie.workspace.WorkspaceTransfer
import com.ai.assistance.operit.pixie.workspace.WritingRules
import com.ai.assistance.operit.util.ImagePoolManager
import java.io.File
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
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
    /** 破甲开关：持久化到 .pi-xie/armor.json（与电脑 pi-xie 一致）。 */
    var unrestricted by mutableStateOf(PixieWorkspace.isArmorBreakEnabled(application))
    var rules by mutableStateOf(emptyList<WritingRules.EffectiveRule>())

    fun changeUnrestricted(enabled: Boolean) {
        unrestricted = enabled
        PixieWorkspace.setArmorBreakEnabled(getApplication(), enabled)
    }

    /** 自动写入（免确认）：.pi-xie/permissions.json，与电脑一致。 */
    var autoWrite by mutableStateOf(PixieWorkspace.isAutoWriteEnabled(application))

    /** 默认扮演角色（自动选角时使用）。 */
    var defaultRoleId by mutableStateOf<String?>(PixieWorkspace.getDefaultUserRole(application))

    /** 工具执行确认（PC 行为：mutating 工具默认逐个确认）。 */
    data class ToolConfirm(val name: String, val summary: String)

    var pendingToolConfirm by mutableStateOf<ToolConfirm?>(null)
    private var toolConfirmDeferred: CompletableDeferred<Boolean>? = null

    fun toggleAutoWrite() {
        autoWrite = !autoWrite
        PixieWorkspace.setAutoWriteEnabled(getApplication(), autoWrite)
        notice = if (autoWrite) "自动写入：开启（工具免确认）" else "自动写入：关闭（每次确认）"
    }

    fun answerToolConfirm(ok: Boolean) {
        val deferred = toolConfirmDeferred
        toolConfirmDeferred = null
        pendingToolConfirm = null
        deferred?.complete(ok)
    }

    /** 默认扮演：传 null 表示旁白/自己（回到 AI 自动判断）。 */
    fun setDefaultRole(roleId: String?) {
        PixieWorkspace.setDefaultUserRole(getApplication(), roleId)
        defaultRoleId = roleId
        notice = "已设置默认扮演"
    }

    fun rebuildManuscript() {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                store.rebuildManuscript()
                notice = "manuscript.txt 已重建"
            } catch (e: Exception) {
                notice = "重建失败：${e.message}"
            }
        }
    }

    fun selectPremises(characters: List<String>, scenes: List<String>) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                store.selectPremises(ActivePremises(characters = characters, scenes = scenes))
                notice = "已更新前提选择"
            } catch (e: Exception) {
                notice = "前提选择失败：${e.message}"
            }
        }
    }

    /** 酒馆角色卡导入（Tavern JSON，与电脑 pi-xie 行为一致）。 */
    fun importTavern(uri: Uri) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val context = getApplication<Application>()
                val content = context.contentResolver.openInputStream(uri)?.use { input ->
                    input.bufferedReader().readText()
                } ?: throw IllegalStateException("无法读取所选文件")
                val card = TavernCard.parse(content)
                val record = store.createEntity(
                    EntityKind.CHARACTERS,
                    name = card.name,
                    body = card.body,
                    tags = card.tags,
                    opening = card.opening,
                    system = card.system,
                )
                loadPremisesInternal()
                notice = "已导入角色：${record.id}（${record.name}）"
            } catch (e: Exception) {
                notice = "角色卡导入失败：${e.message}"
            }
        }
    }

    /** 工具确认：autoWrite 开则免确认（PC 行为）。 */
    private suspend fun awaitToolConfirm(invocation: WritingAgentTools.ToolInvocation): Boolean {
        if (autoWrite) return true
        val deferred = CompletableDeferred<Boolean>()
        pendingToolConfirm = ToolConfirm(invocation.name, invocation.params.toString())
        toolConfirmDeferred = deferred
        return deferred.await()
    }

    fun toggleRule(id: String, enabled: Boolean) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                WritingRules.setEnabled(PixieWorkspace.root(getApplication()), id, enabled)
                loadPremisesInternal()
                notice = "规则已更新"
            } catch (e: Exception) {
                notice = "规则更新失败：${e.message}"
            }
        }
    }

    /** 约束内容：worldview/outline/timeline/style → 文本。 */
    val constraints = mutableStateMapOf<String, String>()
    var characters by mutableStateOf(emptyList<EntityRecord>())
    var scenes by mutableStateOf(emptyList<EntityRecord>())
    var canUndo by mutableStateOf(false)

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
        rules = WritingRules.effective(PixieWorkspace.root(getApplication()))
        canUndo = store.hasUndo()
    }

    /** 撤销最近一次写操作（人物/场景/约束/章节），恢复后刷新面板。 */
    fun undoLast() {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val snapshot = store.undoLast()
                notice = snapshot?.let { "已撤销：${it.action} ${it.path}" } ?: "没有可撤销的操作"
                loadPremisesInternal()
            } catch (e: Exception) {
                notice = "撤销失败：${e.message}"
            }
        }
    }

    private fun systemPrompt(): String = PixiePrompts.buildWritingSystemPrompt(
        unrestricted = unrestricted,
        worldview = constraints["worldview"] ?: "",
        outline = constraints["outline"] ?: "",
        timeline = constraints["timeline"] ?: "",
        style = WritingRules.styleText(PixieWorkspace.root(getApplication()), constraints["style"] ?: ""),
        characterSummaries = characters.map { "${it.name}：${it.body.take(120)}" },
        sceneSummaries = scenes.map { "${it.name}：${it.body.take(120)}" },
        includeTools = true,
        toolDefinitions = WritingAgentTools.toolDefinitionsText(),
    )

    /** 起草类任务的提示词：不带工具（只输出文本提案，由界面保存）。 */
    private fun draftSystemPrompt(): String = PixiePrompts.buildWritingSystemPrompt(
        unrestricted = unrestricted,
        worldview = constraints["worldview"] ?: "",
        outline = constraints["outline"] ?: "",
        timeline = constraints["timeline"] ?: "",
        style = WritingRules.styleText(PixieWorkspace.root(getApplication()), constraints["style"] ?: ""),
        characterSummaries = characters.map { "${it.name}：${it.body.take(120)}" },
        sceneSummaries = scenes.map { "${it.name}：${it.body.take(120)}" },
        includeTools = false,
    )

    /**
     * 写作对话：AI 通过工具真实读写工作区（对齐电脑 pi-xie）。
     * 工具结果回传给 AI 后它才下结论——结论只能基于真实执行结果。
     */
    fun send(raw: String) {
        if (busy) return
        viewModelScope.launch(Dispatchers.IO) {
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
            var last = messages.lastIndex
            var executedTools = 0
            try {
                var pending = content
                for (round in 0 until WritingAgentTools.MAX_TOOL_ROUNDS) {
                    val reply = runner.runTurn(
                        systemPrompt = systemPrompt(),
                        history = messages.dropLast(1).map { SessionMessage(it.sender, it.content) },
                        extraUser = pending,
                        onDelta = { delta ->
                            messages[last] = messages[last].copy(content = messages[last].content + delta)
                        },
                    )
                    val invocations = WritingAgentTools.extractInvocations(reply)
                    if (invocations.isEmpty()) break
                    // 真实执行工具（mutating 默认确认，autoWrite 免确认）；结果原样回传
                    val results = invocations.map { invocation ->
                        val allowed = awaitToolConfirm(invocation)
                        val result = if (!allowed) {
                            "error: 用户取消"
                        } else {
                            WritingAgentTools.execute(store, invocation)
                        }
                        "<tool_result name=\"${invocation.name}\">${result.replace("<", "&lt;")}</tool_result>"
                    }
                    executedTools += invocations.size
                    notice = "已真实执行 $executedTools 个工具操作（可撤销）"
                    messages[last] = messages[last].copy(
                        content = messages[last].content + "\n\n" + results.joinToString("\n"),
                    )
                    messages.add(ChatMessage(sender = "user", content = results.joinToString("\n")))
                    messages.add(ChatMessage(sender = "ai", content = "", roleName = "写作助理"))
                    last = messages.lastIndex
                    pending = results.joinToString("\n")
                }
                if (messages[last].content.isBlank()) {
                    messages[last] = messages[last].copy(content = "（无回复）")
                }
                if (executedTools > 0) {
                    loadPremisesInternal()
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notice = "写作请求失败：${e.message}"
            } finally {
                busy = false
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

    /** 章节内容（章节面板用）。 */
    fun chapterContent(file: String): String = store.readChapter(file).content

    /** 让写作 agent 改写指定章节：流式写入 draftText（输出完整章节正文）。 */
    fun draftChapter(file: String) {
        if (busy) return
        viewModelScope.launch(Dispatchers.IO) {
            busy = true
            drafting = true
            draftTitle = "章节：$file"
            draftText = ""
            try {
                val current = store.readChapter(file).content
                val prompt = buildString {
                    append("请改写下面的章节（保持剧情、人物与已有正文一致，遵守当前风格与写作规则，已有台词逐句保留），输出完整章节正文：")
                    append("\n<章节>\n$current\n</章节>")
                    append("\n直接输出完整正文，不要任何前后缀。")
                }
                runner.runTurn(
                    systemPrompt = systemPrompt(),
                    history = emptyList(),
                    extraUser = prompt,
                    onDelta = { delta -> draftText += delta },
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notice = "章节改写失败：${e.message}"
            } finally {
                busy = false
                drafting = false
            }
        }
    }

    /** 保存章节：file=null 新建章节，否则整章改写。 */
    fun saveChapter(file: String?, content: String) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val info = if (file == null) store.writeChapter(content) else store.rewriteChapter(content, file)
                notice = "已保存章节 ${info.file}"
            } catch (e: Exception) {
                notice = "保存章节失败：${e.message}"
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

    /** 把写作角色卡导出为 Operit 角色卡（AI 对话可用，气泡头像按此查找；同名已存在则更新）。 */
    fun exportCharacterToOperit(id: String) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val entity = store.getEntity(EntityKind.CHARACTERS, id)
                val manager = CharacterCardManager.getInstance(getApplication())
                val existing = manager.findCharacterCardByName(entity.name)
                if (existing != null) {
                    manager.updateCharacterCard(
                        existing.copy(
                            description = entity.body,
                            characterSetting = entity.body,
                            openingStatement = entity.opening,
                            advancedCustomPrompt = entity.system,
                        ),
                    )
                    notice = "已更新 Operit 角色卡「${entity.name}」"
                } else {
                    val card = CharacterCard(
                        id = "",
                        name = entity.name,
                        description = entity.body,
                        characterSetting = entity.body,
                        openingStatement = entity.opening,
                        advancedCustomPrompt = entity.system,
                        isDefault = false,
                    )
                    manager.createCharacterCard(card)
                    notice = "已导出到 Operit 角色卡「${entity.name}」"
                }
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

    /** 删除人物/场景（写入撤销快照，可一键撤销）。 */
    fun deleteEntity(kind: EntityKind, id: String) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                store.deleteEntity(kind, id)
                loadPremisesInternal()
                notice = "已删除（可点「撤销」恢复）"
            } catch (e: Exception) {
                notice = "删除失败：${e.message}"
            }
        }
    }

    fun importWorkspace(uri: Uri) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val context = getApplication<Application>()
                val result = context.contentResolver.openInputStream(uri)?.use { input ->
                    WorkspaceTransfer.importZip(PixieWorkspace.root(context), input, overwrite = true)
                } ?: WorkspaceTransfer.ImportResult(0, emptyList(), listOf("无法读取所选文件"))
                loadPremisesInternal()
                notice = if (result.notes.isEmpty() && result.skipped.isEmpty()) {
                    "已导入 ${result.entryCount} 个文件"
                } else {
                    "导入完成（${result.entryCount} 个文件）：${(result.notes + result.skipped).joinToString("；")}"
                }
            } catch (e: Exception) {
                notice = "导入失败：${e.message}"
            }
        }
    }

    // ===== 导入保护：dry-run 冲突确认 + 导入前自动备份 + 备份/恢复 =====

    private val backupsDir: File
        get() = File(getApplication<Application>().filesDir, "pi-xie-workspace-backups")

    /** 待确认的导入计划（dry-run 结果）与对应的 uri。 */
    var importPlan by mutableStateOf<WorkspaceTransfer.ImportPlan?>(null)
    var pendingImportUri by mutableStateOf<Uri?>(null)

    /** 只解析 zip，列出冲突/新增文件，等用户选择覆盖策略。 */
    fun planImport(uri: Uri) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val context = getApplication<Application>()
                val plan = context.contentResolver.openInputStream(uri)?.use { input ->
                    WorkspaceTransfer.planImport(PixieWorkspace.root(context), input)
                } ?: WorkspaceTransfer.ImportPlan(0, emptyList(), emptyList(), listOf("无法读取所选文件"))
                if (plan.notes.isNotEmpty()) {
                    notice = plan.notes.joinToString("；")
                    importPlan = null
                    pendingImportUri = null
                    return@launch
                }
                importPlan = plan
                pendingImportUri = uri
            } catch (e: Exception) {
                notice = "解析 zip 失败：${e.message}"
            }
        }
    }

    fun cancelImport() {
        importPlan = null
        pendingImportUri = null
    }

    /** 用户确认后执行导入：先自动备份现有工作区，再按策略写入。 */
    fun confirmImport(overwrite: Boolean) {
        val uri = pendingImportUri ?: return
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val context = getApplication<Application>()
                val root = PixieWorkspace.root(context)
                val backup = WorkspaceBackups.createBackup(root, backupsDir, "pre-import")
                val result = context.contentResolver.openInputStream(uri)?.use { input ->
                    WorkspaceTransfer.importZip(root, input, overwrite = overwrite)
                } ?: WorkspaceTransfer.ImportResult(0, emptyList(), listOf("无法读取所选文件"))
                loadPremisesInternal()
                val skippedNote = if (result.skipped.isNotEmpty()) "，跳过 ${result.skipped.size} 个冲突文件" else ""
                notice = "已导入 ${result.entryCount} 个文件$skippedNote；导入前已备份：${backup.name}"
            } catch (e: Exception) {
                notice = "导入失败：${e.message}"
            } finally {
                importPlan = null
                pendingImportUri = null
            }
        }
    }

    fun listBackups(): List<WorkspaceBackups.BackupInfo> = WorkspaceBackups.listBackups(backupsDir)

    fun backupNow() {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val backup = WorkspaceBackups.createBackup(PixieWorkspace.root(getApplication()), backupsDir, "manual")
                notice = "已备份：${backup.name}"
            } catch (e: Exception) {
                notice = "备份失败：${e.message}"
            }
        }
    }

    fun restoreBackup(file: File) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val (safety, result) = WorkspaceBackups.restoreBackup(
                    PixieWorkspace.root(getApplication()),
                    backupsDir,
                    file,
                )
                loadPremisesInternal()
                notice = "已从备份恢复（${result.entryCount} 个文件）；恢复前已备份：${safety.name}"
            } catch (e: Exception) {
                notice = "恢复失败：${e.message}"
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

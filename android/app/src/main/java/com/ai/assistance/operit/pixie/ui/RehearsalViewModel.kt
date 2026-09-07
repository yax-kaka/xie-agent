package com.ai.assistance.operit.pixie.ui

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.ai.assistance.operit.api.voice.VoiceService
import com.ai.assistance.operit.api.voice.VoiceServiceFactory
import com.ai.assistance.operit.pixie.prompt.PixiePrompts
import com.ai.assistance.operit.pixie.rehearsal.AIServiceTurnRunner
import com.ai.assistance.operit.pixie.rehearsal.AUTO_PROSE_THRESHOLD_LINES
import com.ai.assistance.operit.pixie.rehearsal.RehearsalEngine
import com.ai.assistance.operit.pixie.rehearsal.RehearsalSession
import com.ai.assistance.operit.pixie.rehearsal.WorkspaceCharacterPromptProvider
import com.ai.assistance.operit.pixie.roleplay.RehearsalParticipant
import com.ai.assistance.operit.pixie.writing.WritingAgentTools
import com.ai.assistance.operit.pixie.workspace.ChapterInfo
import com.ai.assistance.operit.pixie.workspace.EntityKind
import com.ai.assistance.operit.pixie.workspace.EntityRecord
import com.ai.assistance.operit.pixie.workspace.PixieWorkspace
import com.ai.assistance.operit.pixie.workspace.RehearsalRecord
import com.ai.assistance.operit.pixie.workspace.RoleLine
import com.ai.assistance.operit.pixie.workspace.WorkspaceStore
import com.ai.assistance.operit.pixie.workspace.WritingRules
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 对戏 UI 行：1 起编号，供长按菜单与重说/改台词对话框引用。 */
data class UiLine(val number: Int, val line: RoleLine)

/** 角色活动快照（immutable，触发 Compose 重组）。 */
data class ActivitySnapshot(val status: String, val stream: String)

class RehearsalViewModel(application: Application) : AndroidViewModel(application) {

    val store: WorkspaceStore = PixieWorkspace.store(application)
    private val runner = AIServiceTurnRunner(application)
    private var engine: RehearsalEngine? = null
    // 必须是 snapshot state：SetupSheet 只读 active（→ session），
    // start() 成功后若不触发任何 SetupSheet 已读状态的失效，界面永远停在设置页。
    private var session by mutableStateOf<RehearsalSession?>(null)

    // 对戏状态
    val lines = mutableStateListOf<UiLine>()
    val activities = mutableStateMapOf<String, ActivitySnapshot>()
    var busy by mutableStateOf(false)
    var summary by mutableStateOf("")
    var notice by mutableStateOf("")
    var sceneName by mutableStateOf("")
    var userRoleLabel by mutableStateOf("")
    var participants by mutableStateOf(emptyList<RehearsalParticipant>())

    // 设置面板数据
    var scenes by mutableStateOf(emptyList<EntityRecord>())
    var characters by mutableStateOf(emptyList<EntityRecord>())
    var sceneId by mutableStateOf("")
    var selectedCharacterIds by mutableStateOf(emptyList<String>())
    var userRoleName by mutableStateOf<String?>(null)
    var sceneStart by mutableStateOf("")
    /** 设置页破甲开关（从 .pi-xie/armor.json 载入，开始时持久化）。 */
    var setupUnrestricted by mutableStateOf(false)
    /** AI 选角进行中。 */
    var casting by mutableStateOf(false)
    /** 自动成文开关（每 8 句写排练稿）。 */
    var autoProse by mutableStateOf(false)

    /** 当前场景 + 选中角色组合是否已有对戏记录（决定是否显示「续写对戏」）。 */
    fun recordExistsFor(sceneId: String, characterIds: List<String>): Boolean {
        if (sceneId.isBlank() || characterIds.isEmpty()) return false
        return com.ai.assistance.operit.pixie.workspace.RehearsalRecord
            .recordPathFor(PixieWorkspace.root(getApplication()), sceneId, characterIds)
            .exists()
    }

    val active: Boolean get() = session != null

    // 成文（对齐电脑 pi-xie 的 /对戏成文）：把本段对戏交给写作 agent，
    // 改写为正文写入目标章节并可选续写；AI 只输出草案，点保存才真正落盘
    var proseBusy by mutableStateOf(false)
    var proseDraft by mutableStateOf("")
    private var proseChapterFile: String? = null
    private var unrestrictedValue = true

    fun chapters(): List<ChapterInfo> = store.listChapters()

    /** 按保真规则把当前对戏记录改写成正文（流式写入 proseDraft，目标是 [chapterFile] 章节）。 */
    fun draftProse(chapterFile: String, continuation: String) {
        val current = session ?: return
        // 对戏回合进行中禁止成文：两者共用同一个 runner，并发会互相抢流/杀错 job
        if (busy || proseBusy) return
        viewModelScope.launch(Dispatchers.IO) {
            proseBusy = true
            proseDraft = ""
            proseChapterFile = chapterFile
            try {
                val transcript = current.segment.joinToString("\n") { RehearsalRecord.formatRoleLine(it) }
                val instruction = PixiePrompts.buildChapterProseInstruction(
                    chapterFile = chapterFile,
                    sceneName = current.sceneName,
                    transcript = transcript,
                    continuation = continuation.trim().ifEmpty { null },
                ) + "\n\n当前环境没有文件工具：请直接输出「写回后的完整章节正文」（现有内容 + 改写正文 + 续写），不要省略现有内容，不要任何前后缀。"
                runner.runTurn(
                    systemPrompt = writingSystemPrompt(),
                    history = emptyList(),
                    extraUser = instruction,
                    onDelta = { delta -> proseDraft += delta },
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notice = "成文失败：${e.message}"
            } finally {
                proseBusy = false
            }
        }
    }

    /** 保存成文草案：整章改写为目标章节（AI 输出的就是完整章节正文）。 */
    fun saveProseToChapter() {
        val chapter = proseChapterFile ?: return
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val info = store.rewriteChapter(proseDraft, chapter)
                notice = "已写入章节 ${info.file}"
            } catch (e: Exception) {
                notice = "写入章节失败：${e.message}"
            }
        }
    }

    /** 退出菜单的「新开一段」：沿用用户在设置页选择的破甲开关。 */
    fun restartNewSegment() {
        start(unrestricted = unrestrictedValue, startNew = true)
    }

    fun loadSetupData() {
        viewModelScope.launch(Dispatchers.IO) { loadSetupDataInternal() }
    }

    /**
     * 同步版刷新：供 createCharacter/createScene 直接调用。
     * 不能并发 launch，否则内部的 selectedCharacterIds = emptyList()
     * 会与调用方随后追加的选中项竞争（先跑后跑不定，选中态被清掉）。
     */
    private suspend fun loadSetupDataInternal() {
        val sceneList = store.listEntities(EntityKind.SCENES)
        val charList = store.listEntities(EntityKind.CHARACTERS)
        scenes = sceneList
        characters = charList
        sceneId = sceneList.firstOrNull()?.id ?: ""
        selectedCharacterIds = emptyList()
        sceneStart = sceneList.firstOrNull()?.let { "进入场景：${it.name}。" } ?: ""
        setupUnrestricted = PixieWorkspace.isArmorBreakEnabled(getApplication())
    }

    /** 写作系统提示词（成文/选角共用）：前提 + 规则风格 + 破甲。 */
    private fun writingSystemPrompt(): String = PixiePrompts.buildWritingSystemPrompt(
        unrestricted = unrestrictedValue,
        worldview = store.readConstraint("worldview"),
        outline = store.readConstraint("outline"),
        timeline = store.readConstraint("timeline"),
        style = WritingRules.styleText(PixieWorkspace.root(getApplication()), store.readConstraint("style")),
        characterSummaries = store.listEntities(EntityKind.CHARACTERS)
            .map { "${it.name}：${it.body.take(120)}" },
        sceneSummaries = store.listEntities(EntityKind.SCENES)
            .map { "${it.name}：${it.body.take(120)}" },
    )

    /** 带工具定义的写作提示词（自动成文写排练稿用）。 */
    private fun writingToolsSystemPrompt(): String = PixiePrompts.buildWritingSystemPrompt(
        unrestricted = unrestrictedValue,
        worldview = store.readConstraint("worldview"),
        outline = store.readConstraint("outline"),
        timeline = store.readConstraint("timeline"),
        style = WritingRules.styleText(PixieWorkspace.root(getApplication()), store.readConstraint("style")),
        characterSummaries = store.listEntities(EntityKind.CHARACTERS)
            .map { "${it.name}：${it.body.take(120)}" },
        sceneSummaries = store.listEntities(EntityKind.SCENES)
            .map { "${it.name}：${it.body.take(120)}" },
        includeTools = true,
        toolDefinitions = WritingAgentTools.toolDefinitionsText(),
    )

    /** AI 选角（对齐 PC buildCastPrompt）：按场景推荐 aiRoles/userRole，自动预选。 */
    fun castScene() {
        val scene = scenes.firstOrNull { it.id == sceneId } ?: return
        if (casting || busy) return
        viewModelScope.launch(Dispatchers.IO) {
            casting = true
            try {
                val prompt = PixiePrompts.buildCastPrompt(
                    sceneName = scene.name,
                    sceneBody = scene.body,
                    sceneStart = sceneStart,
                    characters = characters.map { PixiePrompts.CastCharacter(it.id, it.name, it.body) },
                    defaultUserRoleId = PixieWorkspace.getDefaultUserRole(getApplication()),
                )
                val reply = runner.runTurn(
                    systemPrompt = writingSystemPrompt(),
                    history = emptyList(),
                    extraUser = prompt,
                    onDelta = {},
                )
                val parsed = parseCastReply(reply)
                selectedCharacterIds = parsed.aiRoles.filter { roleId ->
                    characters.any { it.id == roleId }
                }
                userRoleName = parsed.userRole?.let { roleId ->
                    characters.firstOrNull { it.id == roleId }?.name
                }
                notice = "已按 AI 建议预选角色（可手动调整）"
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notice = "AI 选角失败：${e.message}"
            } finally {
                casting = false
            }
        }
    }

    private data class CastResult(val aiRoles: List<String>, val userRole: String?)

    private fun parseCastReply(reply: String): CastResult {
        // 模型可能在 JSON 外附带文字：取第一个 {...} 块解析
        val match = Regex("\\{[^{}]*\"aiRoles\"[^{}]*}").find(reply)
            ?: Regex("\\{[^{}]*\"userRole\"[^{}]*}").find(reply)
            ?: return CastResult(emptyList(), null)
        return try {
            val json = com.google.gson.JsonParser.parseString(match.value).asJsonObject
            val aiRoles = json.getAsJsonArray("aiRoles")
                ?.mapNotNull { it.asString?.takeIf { value -> value.isNotBlank() } }
                ?: emptyList()
            val userRole = json.get("userRole")?.takeIf { !it.isJsonNull }?.asString?.takeIf { it.isNotBlank() }
            CastResult(aiRoles, userRole)
        } catch (e: Exception) {
            CastResult(emptyList(), null)
        }
    }

    fun toggleAutoProse() {
        autoProse = !autoProse
        session?.autoProse = autoProse
        notice = if (autoProse) {
            "自动成文：开启（每 $AUTO_PROSE_THRESHOLD_LINES 句写一次排练稿）"
        } else {
            "自动成文：关闭"
        }
    }

    // ===== 工具确认（自动成文写排练稿时用，与写作侧同机制） =====

    data class ToolConfirm(val name: String, val summary: String)

    var pendingToolConfirm by mutableStateOf<ToolConfirm?>(null)
    private var toolConfirmDeferred: CompletableDeferred<Boolean>? = null

    fun answerToolConfirm(ok: Boolean) {
        val deferred = toolConfirmDeferred
        toolConfirmDeferred = null
        pendingToolConfirm = null
        deferred?.complete(ok)
    }

    private suspend fun awaitToolConfirm(invocation: WritingAgentTools.ToolInvocation): Boolean {
        if (PixieWorkspace.isAutoWriteEnabled(getApplication())) return true
        val deferred = CompletableDeferred<Boolean>()
        pendingToolConfirm = ToolConfirm(invocation.name, invocation.params.toString())
        toolConfirmDeferred = deferred
        return deferred.await()
    }

    // ===== 朗读（复用 Operit 语音体系：活跃语音配置档案，声线在语音服务设置里选） =====

    var ttsEnabled by mutableStateOf(false)
    private var voiceService: VoiceService? = null

    fun toggleTts() {
        ttsEnabled = !ttsEnabled
        if (!ttsEnabled) {
            viewModelScope.launch(Dispatchers.IO) { voiceService?.stop() }
        }
        notice = if (ttsEnabled) {
            "朗读：开启（AI 台词自动朗读，声线在「语音服务设置」里选择）"
        } else {
            "朗读：关闭"
        }
    }

    fun selectScene(id: String) {
        sceneId = id
        sceneStart = scenes.firstOrNull { it.id == id }?.let { "进入场景：${it.name}。" } ?: sceneStart
    }

    /** 快捷新建角色（写作 agent 的 entity 工具落地同一路径；Phase 2 会有完整管理页）。 */
    fun createCharacter(name: String, body: String) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val record = store.createEntity(EntityKind.CHARACTERS, name, body)
                loadSetupDataInternal()
                selectedCharacterIds = selectedCharacterIds + record.id
                notice = "已创建角色「${record.name}」"
            } catch (e: Exception) {
                notice = "创建角色失败：${e.message}"
            }
        }
    }

    /** 快捷新建场景。 */
    fun createScene(name: String, body: String) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val record = store.createEntity(EntityKind.SCENES, name, body)
                loadSetupDataInternal()
                sceneId = record.id
                sceneStart = "进入场景：${record.name}。"
                notice = "已创建场景「${record.name}」"
            } catch (e: Exception) {
                notice = "创建场景失败：${e.message}"
            }
        }
    }

    fun start(unrestricted: Boolean, startNew: Boolean) {
        unrestrictedValue = unrestricted
        setupUnrestricted = unrestricted
        // 破甲开关持久化（.pi-xie/armor.json，与电脑互拷一致）
        PixieWorkspace.setArmorBreakEnabled(getApplication(), unrestricted)
        val scene = scenes.firstOrNull { it.id == sceneId } ?: return
        val participants = selectedCharacterIds.mapNotNull { id ->
            characters.firstOrNull { it.id == id }
                ?.let { RehearsalParticipant(it.id, it.name) }
        }
        if (participants.isEmpty()) {
            notice = "请至少选择一个 AI 扮演的角色"
            return
        }
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val promptProvider = WorkspaceCharacterPromptProvider(store, scene, unrestricted)
                val eng = RehearsalEngine(store, runner, promptProvider)
                val sess = eng.openSession(
                    cwd = PixieWorkspace.root(getApplication()),
                    scene = scene,
                    sceneStartText = sceneStart,
                    aiCharacters = participants,
                    userRoleName = userRoleName,
                    startNew = startNew,
                )
                engine = eng
                session = sess
                sceneName = sess.sceneName
                userRoleLabel = sess.userRoleName ?: "旁白/自己"
                wireCallbacks(eng)
                refresh()
                summary = sess.summary
            } catch (e: Exception) {
                notice = "进入对戏失败：${e.message}"
            }
        }
    }

    private fun wireCallbacks(eng: RehearsalEngine) {
        eng.onLineCommitted = { line ->
            lines.add(UiLine(lines.size + 1, line))
            // 朗读：AI 角色的台词落盘后立即朗读（声线由 Operit 语音服务设置选择）
            if (ttsEnabled && !line.user) {
                viewModelScope.launch(Dispatchers.IO) {
                    try {
                        val voice = voiceService
                            ?: VoiceServiceFactory.getInstance(getApplication()).also { voiceService = it }
                        if (!voice.isInitialized) voice.initialize()
                        voice.speak(line.text, interrupt = true)
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        notice = "朗读失败：${e.message}"
                    }
                }
            }
        }
        eng.onActivityUpdate = { characterSession ->
            activities[characterSession.participant.id] =
                ActivitySnapshot(characterSession.activity.status, characterSession.activity.stream)
        }
        eng.onSummaryChanged = { summary = it }
    }

    fun send(raw: String) {
        val current = session ?: return
        if (busy) return
        viewModelScope.launch {
            busy = true
            try {
                engine?.advance(current, raw)
                // 自动成文：每 8 句新台词把本段对戏改写成排练稿
                autoProseIfNeeded(current)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notice = "对戏失败：${e.message}"
            } finally {
                busy = false
                // @角色 切换扮演后同步顶栏标签
                userRoleLabel = current.userRoleName ?: "旁白/自己"
            }
        }
    }

    private suspend fun autoProseIfNeeded(current: RehearsalSession) {
        if (!current.autoProse) return
        if (current.segment.size - current.proseWatermark < AUTO_PROSE_THRESHOLD_LINES) return
        current.proseWatermark = current.segment.size
        try {
            val transcript = current.segment.joinToString("\n") { RehearsalRecord.formatRoleLine(it) }
            val instruction = PixiePrompts.buildProseInstruction(current.sceneName, transcript, replace = false)
            // 工具回路（对齐 PC：主 agent 调 write_rehearsal_prose 真实写入）
            var pending = instruction
            for (round in 0 until WritingAgentTools.MAX_TOOL_ROUNDS) {
                val reply = runner.runTurn(
                    systemPrompt = writingToolsSystemPrompt(),
                    history = emptyList(),
                    extraUser = pending,
                    onDelta = {},
                )
                val invocations = WritingAgentTools.extractInvocations(reply)
                if (invocations.isEmpty()) break
                var executed = 0
                val results = invocations.map { invocation ->
                    val allowed = awaitToolConfirm(invocation)
                    val result = if (!allowed) {
                        "error: 用户取消"
                    } else {
                        executed++
                        WritingAgentTools.execute(
                            store,
                            invocation,
                            WritingAgentTools.ToolContext(current.prosePath),
                        )
                    }
                    "<tool_result name=\"${invocation.name}\">${result.replace("<", "&lt;")}</tool_result>"
                }
                if (executed > 0) {
                    notice = "自动成文：已真实执行 $executed 个工具操作（可撤销）"
                }
                pending = results.joinToString("\n")
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            notice = "自动成文失败：${e.message}"
        }
    }

    fun retell(lineNumber: Int) {
        val current = session ?: return
        if (busy) return
        viewModelScope.launch {
            busy = true
            try {
                val outcome = engine?.retell(current, lineNumber)
                notice = if (outcome != null) {
                    "已撤回，由 ${outcome.speakerName} 重新回应"
                } else {
                    "只能重说 AI 角色的台词行"
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notice = "重说失败：${e.message}"
            } finally {
                busy = false
            }
        }
    }

    fun editLine(lineNumber: Int, newText: String) {
        val current = session ?: return
        viewModelScope.launch(Dispatchers.IO) {
            val edited = engine?.editLine(current, lineNumber, newText) ?: false
            notice = if (edited) "台词已更新" else "行号无效"
            refresh()
        }
    }

    fun setOrder(ids: List<String>) {
        val current = session ?: return
        viewModelScope.launch(Dispatchers.IO) {
            val result = engine?.setOrder(current, ids)
            notice = if (result != null) {
                "发言顺序：${result.joinToString(" → ") { it.name }}"
            } else {
                "发言顺序无效"
            }
        }
    }

    fun abort() {
        runner.abort()
        activities.keys.forEach { activities[it] = ActivitySnapshot("idle", activities[it]?.stream ?: "") }
    }

    fun exit() {
        abort()
        viewModelScope.launch(Dispatchers.IO) { voiceService?.stop() }
        voiceService = null
        ttsEnabled = false
        engine?.dispose()
        engine = null
        session = null
        lines.clear()
        activities.clear()
        busy = false
        summary = ""
        notice = ""
        // 回到设置页前重读实体：退出期间角色/场景可能被外部修改（含角色管理、电脑互拷）
        loadSetupData()
    }

    override fun onCleared() {
        engine?.dispose()
        viewModelScope.launch(Dispatchers.IO) { voiceService?.stop() }
        super.onCleared()
    }

    /** 记录文件 + 段缓存 → UI 行与活动快照全量同步。 */
    private fun refresh() {
        val current = session ?: return
        lines.clear()
        current.segment.forEachIndexed { index, line ->
            lines.add(UiLine(index + 1, line))
        }
        activities.clear()
        current.aiCharacters.forEach { participant ->
            val characterSession = current.sessions[participant.id] ?: return@forEach
            activities[participant.id] =
                ActivitySnapshot(characterSession.activity.status, characterSession.activity.stream)
        }
        participants = current.aiCharacters.toList()
        userRoleLabel = current.userRoleName ?: "旁白/自己"
    }
}

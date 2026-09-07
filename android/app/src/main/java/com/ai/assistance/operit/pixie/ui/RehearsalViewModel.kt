package com.ai.assistance.operit.pixie.ui

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.ai.assistance.operit.pixie.rehearsal.AIServiceTurnRunner
import com.ai.assistance.operit.pixie.rehearsal.RehearsalEngine
import com.ai.assistance.operit.pixie.rehearsal.RehearsalSession
import com.ai.assistance.operit.pixie.rehearsal.WorkspaceCharacterPromptProvider
import com.ai.assistance.operit.pixie.roleplay.RehearsalParticipant
import com.ai.assistance.operit.pixie.workspace.EntityKind
import com.ai.assistance.operit.pixie.workspace.EntityRecord
import com.ai.assistance.operit.pixie.workspace.PixieWorkspace
import com.ai.assistance.operit.pixie.workspace.RoleLine
import com.ai.assistance.operit.pixie.workspace.WorkspaceStore
import kotlinx.coroutines.CancellationException
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
    private var session: RehearsalSession? = null

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
    var hasRecord by mutableStateOf(false)

    val active: Boolean get() = session != null

    fun loadSetupData() {
        viewModelScope.launch(Dispatchers.IO) {
            val sceneList = store.listEntities(EntityKind.SCENES)
            val charList = store.listEntities(EntityKind.CHARACTERS)
            scenes = sceneList
            characters = charList
            sceneId = sceneList.firstOrNull()?.id ?: ""
            selectedCharacterIds = emptyList()
            sceneStart = sceneList.firstOrNull()?.let { "进入场景：${it.name}。" } ?: ""
            hasRecord = sceneList.any { scene ->
                charList.isNotEmpty() &&
                    com.ai.assistance.operit.pixie.workspace.RehearsalRecord
                        .recordPathFor(
                            PixieWorkspace.root(getApplication()),
                            scene.id,
                            charList.map { it.id },
                        ).exists()
            }
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
                loadSetupData()
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
                loadSetupData()
                sceneId = record.id
                sceneStart = "进入场景：${record.name}。"
                notice = "已创建场景「${record.name}」"
            } catch (e: Exception) {
                notice = "创建场景失败：${e.message}"
            }
        }
    }

    fun start(unrestricted: Boolean, startNew: Boolean) {
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
        eng.onLineCommitted = { line -> lines.add(UiLine(lines.size + 1, line)) }
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
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                notice = "对戏失败：${e.message}"
            } finally {
                busy = false
            }
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
        engine?.dispose()
        engine = null
        session = null
        lines.clear()
        activities.clear()
        busy = false
        summary = ""
        notice = ""
    }

    override fun onCleared() {
        engine?.dispose()
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

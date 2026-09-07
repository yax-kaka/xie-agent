package com.ai.assistance.operit.pixie.writing

import com.ai.assistance.operit.pixie.workspace.ActivePremises
import com.ai.assistance.operit.pixie.workspace.EntityKind
import com.ai.assistance.operit.pixie.workspace.RehearsalRecord
import com.ai.assistance.operit.pixie.workspace.WorkspaceStore
import com.ai.assistance.operit.pixie.workspace.WritingRules
import com.ai.assistance.operit.util.ChatMarkupRegex
import java.io.File

/**
 * 写作 agent 工具回路：与电脑 pi-xie 的写作工具集逐项对齐
 * （list_entities / get_entity / create_entity / update_entity / delete_entity /
 * select_premises / set_worldview / set_outline / set_timeline / set_style /
 * write_chapter / rewrite_chapter / read_chapter / undo_last）。
 *
 * AI 在回复里发 <tool name="..."><param name="...">值</param></tool>，
 * 这里真实执行（WorkspaceStore 写操作全部走撤销快照），
 * 把真实结果以 <tool_result> 回传给 AI，AI 只能基于结果下结论——不可能虚假成功。
 */
object WritingAgentTools {

    const val MAX_TOOL_ROUNDS = 6

    data class ToolInvocation(val name: String, val params: Map<String, String>)

    /** 工具执行上下文：write_rehearsal_prose 需要当前对戏的排练稿路径。 */
    data class ToolContext(val prosePath: File? = null)

    fun extractInvocations(raw: String): List<ToolInvocation> {
        return ChatMarkupRegex.toolCallPattern.findAll(raw).map { match ->
            val name = match.groupValues[2].trim()
            val body = match.groupValues[3]
            val params = mutableMapOf<String, String>()
            ChatMarkupRegex.toolParamPattern.findAll(body).forEach { param ->
                params[param.groupValues[1].trim()] = param.groupValues[2].trim()
            }
            ToolInvocation(name, params)
        }.toList()
    }

    fun toolDefinitionsText(): String = """
可用工具（必须通过工具调用执行，不能空口描述结果）：
- list_entities(kind)：列出角色（kind=character）或场景（kind=scene），返回「id：名字 — 设定摘要」。
- get_entity(kind, id)：读取单个角色/场景的完整内容（名字、设定、开场白、自定义提示词）。
- create_entity(kind, name, body, id?, tags?, opening?, system?)：新建角色/场景，返回真实 id。
- update_entity(kind, id, name?, tags?, body?, opening?, system?)：更新角色/场景，返回更新结果。
- delete_entity(kind, id)：删除角色/场景，返回真实删除结果。
- select_premises(characters, scenes)：设定当前选中的角色/场景（id 用英文逗号分隔）。
- get_active_context()：一次性读取当前前提、选中的角色/场景、全部约束（含规则风格）、章节列表与最近三章、manuscript 路径。
- read_constraint(name)：读取前提（worldview/outline/timeline/style）。
- set_worldview(content) / set_outline(content) / set_timeline(content) / set_style(content)：写入对应前提全文。
- get_style()：读取当前有效写作风格（style 约束 + 启用的写作规则）。
- list_chapters()：列出章节文件（如 001.md）与开头摘要。
- read_chapter(chapter)：读取章节全文。
- write_chapter(content, chapter?)：不传 chapter 时新建下一章；传 chapter（如 003.md）时改写该章。
- rewrite_chapter(content, chapter)：整章改写为给定全文。
- write_rehearsal_prose(content, replace?)：把对戏改写的正文写入当前排练稿（replace=true 覆盖，否则追加）。
- undo_last()：撤销最近一次写操作。

调用格式（XML，可一次多个）：
<tool name="delete_entity"><param name="kind">character</param><param name="id">feixue</param></tool>
    """.trimIndent()

    fun execute(store: WorkspaceStore, invocation: ToolInvocation, context: ToolContext = ToolContext()): String {
        val params = invocation.params
        return try {
            when (invocation.name) {
                "list_entities" -> {
                    val kind = entityKind(params["kind"]) ?: return "error: kind 必须是 character 或 scene"
                    val entities = store.listEntities(kind)
                    if (entities.isEmpty()) "ok: （空）"
                    else entities.joinToString("\n") { "${it.id}：${it.name} — ${it.body.take(80)}" }
                }
                "get_entity" -> {
                    val kind = entityKind(params["kind"]) ?: return "error: kind 必须是 character 或 scene"
                    val id = params["id"].orEmpty().trim()
                    if (id.isEmpty()) return "error: id 必填"
                    val record = store.getEntity(kind, id)
                    buildString {
                        append("ok:\n")
                        append("id：${record.id}\n名字：${record.name}\n设定：${record.body}\n")
                        if (record.opening.isNotBlank()) append("开场白：${record.opening}\n")
                        if (record.system.isNotBlank()) append("自定义提示词：${record.system}\n")
                    }
                }
                "create_entity" -> {
                    val kind = entityKind(params["kind"]) ?: return "error: kind 必须是 character 或 scene"
                    val name = params["name"].orEmpty().trim()
                    val body = params["body"].orEmpty().trim()
                    if (name.isEmpty()) return "error: name 必填"
                    if (body.isEmpty()) return "error: body 必填"
                    val record = store.createEntity(
                        kind = kind,
                        name = name,
                        body = body,
                        id = params["id"]?.trim()?.ifEmpty { null },
                        tags = params["tags"]?.split(",")?.map { it.trim() }?.filter { it.isNotEmpty() } ?: emptyList(),
                        opening = params["opening"]?.trim() ?: "",
                        system = params["system"]?.trim() ?: "",
                    )
                    "ok: 已创建 ${record.name}（id=${record.id}）"
                }
                "update_entity" -> {
                    val kind = entityKind(params["kind"]) ?: return "error: kind 必须是 character 或 scene"
                    val id = params["id"].orEmpty().trim()
                    if (id.isEmpty()) return "error: id 必填"
                    val record = store.updateEntity(
                        kind = kind,
                        id = id,
                        name = params["name"]?.trim()?.ifEmpty { null },
                        tags = params["tags"]?.split(",")?.map { it.trim() }?.filter { it.isNotEmpty() },
                        body = params["body"]?.trim()?.ifEmpty { null },
                        opening = params["opening"]?.trim()?.ifEmpty { null },
                        system = params["system"]?.trim()?.ifEmpty { null },
                    )
                    "ok: 已更新 ${record.name}（id=${record.id}）"
                }
                "delete_entity" -> {
                    val kind = entityKind(params["kind"]) ?: return "error: kind 必须是 character 或 scene"
                    val id = params["id"].orEmpty().trim()
                    if (id.isEmpty()) return "error: id 必填"
                    val path = store.deleteEntity(kind, id)
                    "ok: 已删除 $id（${path.name}）"
                }
                "select_premises" -> {
                    store.selectPremises(
                        ActivePremises(
                            characters = params["characters"]?.split(",")?.map { it.trim() }?.filter { it.isNotEmpty() } ?: emptyList(),
                            scenes = params["scenes"]?.split(",")?.map { it.trim() }?.filter { it.isNotEmpty() } ?: emptyList(),
                        ),
                    )
                    "ok: 已更新前提选择"
                }
                "get_active_context" -> {
                    val active = store.getActive()
                    val characters = store.listEntities(EntityKind.CHARACTERS)
                        .filter { active.characters.contains(it.id) }
                        .joinToString("\n") { "${it.id}：${it.name} — ${it.body.take(80)}" }
                    val scenes = store.listEntities(EntityKind.SCENES)
                        .filter { active.scenes.contains(it.id) }
                        .joinToString("\n") { "${it.id}：${it.name} — ${it.body.take(80)}" }
                    val chapters = store.listChapters()
                    val recentChapters = chapters.takeLast(3)
                        .joinToString("\n\n") { "${it.file}\n${it.content.take(400)}" }
                    buildString {
                        append("ok:\n")
                        append("active.characters: ${active.characters.joinToString(",")}\n")
                        append("active.scenes: ${active.scenes.joinToString(",")}\n")
                        append("characters:\n${characters.ifEmpty { "（无）" }}\n")
                        append("scenes:\n${scenes.ifEmpty { "（无）" }}\n")
                        append("constraints:\n")
                        append("worldview: ${store.readConstraint("worldview")}\n")
                        append("outline: ${store.readConstraint("outline")}\n")
                        append("timeline: ${store.readConstraint("timeline")}\n")
                        append("style: ${WritingRules.styleText(store.cwdFile(), store.readConstraint("style"))}\n")
                        append("chapters: ${chapters.joinToString(", ") { it.file }.ifEmpty { "（无）" }}\n")
                        append("manuscriptPath: ${store.cwdFile().path}/manuscript.txt\n")
                        append("previousChapters:\n${recentChapters.ifEmpty { "（无）" }}")
                    }
                }
                "get_style" -> {
                    "ok:\n${WritingRules.styleText(store.cwdFile(), store.readConstraint("style"))}"
                }
                "write_rehearsal_prose" -> {
                    val content = params["content"].orEmpty().trim()
                    if (content.isEmpty()) return "error: content 必填"
                    val prosePath = context.prosePath
                        ?: return "error: 当前没有进行中的对戏，无法写入排练稿"
                    val replace = params["replace"]?.trim()?.lowercase() == "true"
                    val previous = RehearsalRecord.readProse(prosePath)
                    store.snapshotUndo("rewrite", prosePath, previous.ifEmpty { null })
                    val path = RehearsalRecord.writeProse(prosePath, content, replace)
                    "ok: 已写入排练稿（${if (replace) "覆盖" else "追加"}）：${path.name}"
                }
                "read_constraint" -> {
                    val name = params["name"].orEmpty().trim()
                    if (name.isEmpty()) return "error: name 必填"
                    val content = store.readConstraint(name)
                    if (content.isBlank()) "ok: （空）" else "ok:\n$content"
                }
                "set_worldview", "set_outline", "set_timeline", "set_style" -> {
                    val content = params["content"].orEmpty().trim()
                    if (content.isEmpty()) return "error: content 必填"
                    store.writeConstraint(invocation.name.removePrefix("set_"), content)
                    "ok: 已写入 ${invocation.name.removePrefix("set_")}"
                }
                "list_chapters" -> {
                    val chapters = store.listChapters()
                    if (chapters.isEmpty()) "ok: （空）"
                    else chapters.joinToString("\n") { "${it.file}：${it.content.take(60)}" }
                }
                "read_chapter" -> {
                    val chapter = params["chapter"].orEmpty().trim()
                    if (chapter.isEmpty()) return "error: chapter 必填"
                    val info = store.readChapter(chapter)
                    "ok:\n${info.content}"
                }
                "write_chapter" -> {
                    val content = params["content"].orEmpty().trim()
                    if (content.isEmpty()) return "error: content 必填"
                    val info = store.writeChapter(content, params["chapter"]?.trim()?.ifEmpty { null })
                    "ok: 已写入章节 ${info.file}"
                }
                "rewrite_chapter" -> {
                    val file = params["chapter"].orEmpty().trim()
                    val content = params["content"].orEmpty().trim()
                    if (file.isEmpty()) return "error: chapter 必填"
                    if (content.isEmpty()) return "error: content 必填"
                    val info = store.rewriteChapter(content, file)
                    "ok: 已改写章节 ${info.file}"
                }
                "undo_last" -> {
                    val snapshot = store.undoLast()
                    if (snapshot == null) "ok: 没有可撤销的操作"
                    else "ok: 已撤销 ${snapshot.action} ${snapshot.path}"
                }
                else -> "error: 未知工具 ${invocation.name}"
            }
        } catch (e: Exception) {
            "error: ${e.message}"
        }
    }

    private fun entityKind(raw: String?): EntityKind? = when (raw?.trim()?.lowercase()) {
        "character" -> EntityKind.CHARACTERS
        "scene" -> EntityKind.SCENES
        else -> null
    }
}

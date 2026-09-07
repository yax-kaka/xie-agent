package com.ai.assistance.operit.pixie.workspace

import com.google.gson.GsonBuilder
import com.google.gson.reflect.TypeToken
import java.io.File
import java.util.Locale
import java.util.UUID

/**
 * pi-xie 工作区（premises/章节/manuscript）的 Kotlin 移植。
 * 文件格式与电脑版 pi-xie 完全一致（互拷兼容）：
 * - 实体：premises/characters/<slug>.md、premises/scenes/<slug>.md，YAML frontmatter 为 JSON 元数据；
 * - 约束：premises/worldview.md、outline.md、timeline.md、style.md；
 * - 章节：chapters/NNN.md；manuscript.txt 为章节合集（「第N章」块）；
 * - active.json：当前选中的角色/场景。
 */

enum class EntityKind(val dirName: String) {
    CHARACTERS("characters"),
    SCENES("scenes"),
}

data class EntityMeta(
    val id: String,
    val name: String,
    val tags: List<String>,
    val updatedAt: String,
    val kind: EntityKind,
    val opening: String = "",
    val system: String = "",
)

data class EntityRecord(
    val id: String,
    val name: String,
    val tags: List<String>,
    val updatedAt: String,
    val kind: EntityKind,
    val opening: String,
    val system: String,
    val body: String,
    val path: File,
)

data class ActivePremises(
    val characters: List<String>,
    val scenes: List<String>,
)

data class ChapterInfo(
    val number: Int,
    val file: String,
    val path: File,
    val content: String,
)

class WorkspaceStore(private val cwd: File) {

    // 与电脑 pi-xie 的 JSON.stringify(meta, null, 2) 对齐：2 空格缩进、冒号后带空格
    private val gson = GsonBuilder().setPrettyPrinting().create()

    private fun prettyJson(value: Any): String = gson.toJson(value)

    private fun readJsonObject(text: String): Map<String, Any?> =
        gson.fromJson(text, object : TypeToken<Map<String, Any?>>() {}.type)

    private val workspaceDir: File get() = File(cwd, "premises")
    private fun entityDir(kind: EntityKind): File = File(workspaceDir, kind.dirName)
    private val chaptersDir: File get() = File(cwd, "chapters")
    private val activePath: File get() = File(workspaceDir, "active.json")
    private val manuscriptFile: File get() = File(cwd, "manuscript.txt")

    fun ensureWorkspace() {
        workspaceDir.mkdirs()
        entityDir(EntityKind.CHARACTERS).mkdirs()
        entityDir(EntityKind.SCENES).mkdirs()
        chaptersDir.mkdirs()
        if (!activePath.exists()) {
            activePath.writeText(prettyJson(ActivePremises(emptyList(), emptyList())))
        }
        for (constraint in listOf("worldview", "outline", "timeline", "style")) {
            val path = File(workspaceDir, "$constraint.md")
            if (!path.exists()) path.writeText("")
        }
        if (!manuscriptFile.exists()) {
            rebuildManuscript()
        }
    }

    fun listEntities(kind: EntityKind): List<EntityRecord> {
        val dir = entityDir(kind)
        if (!dir.exists()) return emptyList()
        return dir.listFiles()
            ?.filter { it.isFile && it.name.endsWith(".md") }
            ?.mapNotNull { file ->
                decodeFrontmatter(file.readText())?.let { decoded ->
                    EntityRecord(
                        id = decoded.meta.id,
                        name = decoded.meta.name,
                        tags = decoded.meta.tags,
                        updatedAt = decoded.meta.updatedAt,
                        kind = kind,
                        opening = decoded.meta.opening,
                        system = decoded.meta.system,
                        body = decoded.body,
                        path = file,
                    )
                }
            }
            ?.sortedBy { it.id }
            ?: emptyList()
    }

    fun getEntity(kind: EntityKind, id: String): EntityRecord {
        val path = entityPath(kind, id)
        if (!path.exists()) throw IllegalArgumentException("Unknown ${kind.dirName.removeSuffix("s")}: $id")
        val decoded = decodeFrontmatter(path.readText())
            ?: throw IllegalArgumentException("Invalid entity file: ${path.absolutePath}")
        return EntityRecord(
            id = decoded.meta.id,
            name = decoded.meta.name,
            tags = decoded.meta.tags,
            updatedAt = decoded.meta.updatedAt,
            kind = kind,
            opening = decoded.meta.opening,
            system = decoded.meta.system,
            body = decoded.body,
            path = path,
        )
    }

    fun createEntity(
        kind: EntityKind,
        name: String,
        body: String,
        id: String? = null,
        tags: List<String> = emptyList(),
        opening: String = "",
        system: String = "",
    ): EntityRecord {
        val dir = entityDir(kind)
        dir.mkdirs()
        val resolvedId = uniqueId(id ?: name, dir)
        val record = EntityRecord(
            id = resolvedId,
            name = name.trim(),
            tags = tags,
            updatedAt = isoNow(),
            kind = kind,
            opening = opening,
            system = system,
            body = body,
            path = File(dir, "$resolvedId.md"),
        )
        record.path.writeText(encodeFrontmatter(record))
        return record
    }

    fun updateEntity(
        kind: EntityKind,
        id: String,
        name: String? = null,
        tags: List<String>? = null,
        body: String? = null,
        opening: String? = null,
        system: String? = null,
    ): EntityRecord {
        val existing = getEntity(kind, id)
        val next = EntityRecord(
            id = existing.id,
            name = name?.trim()?.takeIf { it.isNotEmpty() } ?: existing.name,
            tags = tags ?: existing.tags,
            updatedAt = isoNow(),
            kind = kind,
            opening = opening ?: existing.opening,
            system = system ?: existing.system,
            body = body ?: existing.body,
            path = existing.path,
        )
        next.path.writeText(encodeFrontmatter(next))
        return next
    }

    fun deleteEntity(kind: EntityKind, id: String): File {
        val path = entityPath(kind, id)
        if (!path.exists()) throw IllegalArgumentException("Unknown ${kind.dirName.removeSuffix("s")}: $id")
        path.delete()
        return path
    }

    fun getActive(): ActivePremises {
        if (!activePath.exists()) return ActivePremises(emptyList(), emptyList())
        return try {
            val parsed = readJsonObject(activePath.readText())
            ActivePremises(
                characters = (parsed["characters"] as? List<*>)?.mapNotNull { it as? String } ?: emptyList(),
                scenes = (parsed["scenes"] as? List<*>)?.mapNotNull { it as? String } ?: emptyList(),
            )
        } catch (e: Exception) {
            ActivePremises(emptyList(), emptyList())
        }
    }

    fun selectPremises(premises: ActivePremises): ActivePremises {
        ensureWorkspace()
        activePath.writeText(prettyJson(premises))
        return premises
    }

    fun readConstraint(name: String): String {
        val path = File(workspaceDir, "$name.md")
        return if (path.exists()) path.readText() else ""
    }

    fun writeConstraint(name: String, content: String): File {
        ensureWorkspace()
        val path = File(workspaceDir, "$name.md")
        path.writeText(content.trimEnd() + "\n")
        return path
    }

    fun listChapters(): List<ChapterInfo> {
        val dir = chaptersDir
        if (!dir.exists()) return emptyList()
        return dir.listFiles()
            ?.filter { it.isFile && it.name.endsWith(".md") }
            ?.map { file ->
                val number = file.name.removeSuffix(".md").replace(Regex("\\D"), "").toIntOrNull()
                number?.let { ChapterInfo(it, file.name, file, file.readText()) }
            }
            ?.filterNotNull()
            ?.sortedBy { it.number }
            ?: emptyList()
    }

    fun writeChapter(content: String, chapter: String? = null): ChapterInfo {
        ensureWorkspace()
        val path = chapterFile(chapter, next = chapter == null)
        if (path.exists()) throw IllegalArgumentException("Chapter already exists: ${path.absolutePath}")
        path.writeText(content.trimEnd() + "\n")
        val number = Regex("(\\d+)\\.md$").find(path.absolutePath)?.groupValues?.get(1)?.toIntOrNull() ?: 1
        val record = ChapterInfo(number, path.name, path, content)
        syncManuscript(record, "append")
        return record
    }

    fun rewriteChapter(content: String, chapter: String): ChapterInfo {
        ensureWorkspace()
        val path = chapterFile(chapter, next = false)
        if (!path.exists()) throw IllegalArgumentException("Chapter not found: ${path.absolutePath}")
        path.writeText(content.trimEnd() + "\n")
        val number = Regex("(\\d+)\\.md$").find(path.absolutePath)?.groupValues?.get(1)?.toIntOrNull() ?: 1
        val record = ChapterInfo(number, path.name, path, content)
        syncManuscript(record, "replace")
        return record
    }

    fun readChapter(chapter: String): ChapterInfo {
        val path = chapterFile(chapter, next = false)
        if (!path.exists()) throw IllegalArgumentException("Chapter not found: ${path.absolutePath}")
        val number = Regex("(\\d+)\\.md$").find(path.absolutePath)?.groupValues?.get(1)?.toIntOrNull() ?: 1
        return ChapterInfo(number, path.name, path, path.readText())
    }

    fun getManuscriptPath(): File = manuscriptFile

    fun rebuildManuscript(): File {
        val blocks = listChapters().map { chapterBlock(it) }
        writeManuscriptBlocks(blocks)
        return manuscriptFile
    }

    private fun syncManuscript(chapter: ChapterInfo, mode: String) {
        val path = manuscriptFile
        if (!path.exists() || path.readText().trim().isEmpty()) {
            writeManuscriptBlocks(listOf(chapterBlock(chapter)))
            return
        }
        val current = parseManuscriptBlocks(path.readText())
        val existingIndex = current.indexOfFirst { it.number == chapter.number }
        if (existingIndex >= 0) {
            val next = current.toMutableList()
            next[existingIndex] = chapterBlockEntry(chapter)
            writeManuscriptBlocks(next)
            return
        }
        if (mode == "append" && (current.isEmpty() || chapter.number > (current.maxOfOrNull { it.number } ?: 0))) {
            path.writeText(path.readText().replace(Regex("\\n+$"), "") + "\n\n" + chapterBlock(chapter).block)
            return
        }
        val next = current.toMutableList()
        next.add(chapterBlockEntry(chapter))
        writeManuscriptBlocks(next)
    }

    private data class ChapterBlockEntry(val number: Int, val block: String)

    private fun chapterBlockEntry(chapter: ChapterInfo): ChapterBlockEntry =
        ChapterBlockEntry(chapter.number, chapterBlock(chapter).block)

    private fun chapterBlock(chapter: ChapterInfo): ChapterBlockEntry =
        ChapterBlockEntry(chapter.number, "第${chapter.number}章\n\n${chapter.content.trimEnd()}\n\n")

    private fun parseManuscriptBlocks(text: String): List<ChapterBlockEntry> {
        val headerPattern = Regex("第(\\d+)章\n\n")
        val matches = headerPattern.findAll(text).toList()
        return matches.mapIndexed { index, match ->
            val start = match.range.last + 1
            val end = if (index + 1 < matches.size) matches[index + 1].range.first else text.length
            val content = text.substring(start, end).replace(Regex("^\\n+|\\n+$"), "")
            ChapterBlockEntry(match.groupValues[1].toInt(), "第${match.groupValues[1]}章\n\n$content\n\n")
        }
    }

    private fun writeManuscriptBlocks(blocks: List<ChapterBlockEntry>) {
        manuscriptFile.writeText(blocks.sortedBy { it.number }.joinToString("") { it.block })
    }

    private fun entityPath(kind: EntityKind, id: String): File =
        File(entityDir(kind), "${slugify(id)}.md")

    private fun chapterFile(chapter: String?, next: Boolean): File {
        val dir = chaptersDir
        if (next || chapter == null) {
            val existing = listChapters()
            val number = if (existing.isNotEmpty()) (existing.maxOfOrNull { it.number } ?: 0) + 1 else 1
            return File(dir, number.toString().padStart(3, '0') + ".md")
        }
        val number = chapterNumberFromString(chapter)
            ?: throw IllegalArgumentException("Invalid chapter: $chapter")
        return File(dir, number.toString().padStart(3, '0') + ".md")
    }

    private fun chapterNumberFromString(value: String): Int? =
        Regex("(\\d+)").find(value)?.groupValues?.get(1)?.toIntOrNull()

    private fun encodeFrontmatter(record: EntityRecord): String {
        val meta = mapOf(
            "id" to record.id,
            "name" to record.name,
            "tags" to record.tags,
            "updatedAt" to record.updatedAt,
            "kind" to record.kind.dirName,
            "opening" to record.opening,
            "system" to record.system,
        )
        return "---\n" + prettyJson(meta) + "\n---\n" + record.body.trim() + "\n"
    }

    private fun decodeFrontmatter(content: String): DecodedEntity? {
        val match = Regex("^---\\r?\\n([\\s\\S]*?)\\r?\\n---\\r?\\n?([\\s\\S]*)$").find(content) ?: return null
        return try {
            val parsed = readJsonObject(match.groupValues[1])
            val kindName = parsed["kind"] as? String ?: return null
            val kind = EntityKind.entries.firstOrNull { it.dirName == kindName } ?: return null
            DecodedEntity(
                meta = EntityMeta(
                    id = parsed["id"] as? String ?: return null,
                    name = parsed["name"] as? String ?: return null,
                    tags = (parsed["tags"] as? List<*>)?.mapNotNull { it as? String } ?: emptyList(),
                    updatedAt = parsed["updatedAt"] as? String ?: "",
                    kind = kind,
                    opening = parsed["opening"] as? String ?: "",
                    system = parsed["system"] as? String ?: "",
                ),
                body = match.groupValues[2].trim(),
            )
        } catch (e: Exception) {
            null
        }
    }

    private data class DecodedEntity(val meta: EntityMeta, val body: String)

    private fun uniqueId(base: String, dir: File): String {
        val root = slugify(base)
        var candidate = root
        var suffix = 2
        while (File(dir, "$candidate.md").exists()) {
            candidate = "$root-$suffix"
            suffix++
        }
        return candidate
    }

    private fun isoNow(): String = java.time.Instant.now().toString()

    companion object {
        fun slugify(value: String): String {
            val slug = value
                .trim()
                .lowercase(Locale.ROOT)
                .replace(Regex("[^a-z0-9\\u4e00-\\u9fff]+"), "-")
                .replace(Regex("^-+|-+$"), "")
            return slug.ifEmpty { UUID.randomUUID().toString() }
        }
    }
}

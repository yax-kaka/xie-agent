package com.ai.assistance.operit.pixie.ui

import android.app.Application
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.Undo
import androidx.compose.material.icons.filled.Upload
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import com.ai.assistance.operit.pixie.workspace.ChapterInfo
import com.ai.assistance.operit.pixie.workspace.EntityKind
import com.ai.assistance.operit.pixie.workspace.EntityRecord
import com.ai.assistance.operit.pixie.workspace.WorkspaceBackups
import com.ai.assistance.operit.pixie.workspace.WorkspaceTransfer
import com.ai.assistance.operit.pixie.workspace.WritingRules
import com.ai.assistance.operit.ui.features.chat.components.AttachmentSelectorPanel
import com.ai.assistance.operit.ui.features.chat.components.compactDialogHeight
import com.ai.assistance.operit.ui.features.chat.components.rememberCompactDialogMetrics
import com.ai.assistance.operit.ui.features.chat.components.style.bubble.BubbleStyleChatMessage
import com.ai.assistance.operit.ui.theme.LocalThemePreferenceSnapshot
import com.ai.assistance.operit.ui.theme.rememberActiveThemePreferenceSnapshot

/**
 * 写作屏：pi-xie 工作区入口（对齐电脑版流程）——
 * 先写前置设定（世界观/大纲/时间线/风格/角色/场景），一切就绪后再进入对戏。
 * - 前提面板直接读写工作区文件；AI 只输出文本提案，保存由用户点按钮（杜绝虚假成功）；
 * - 支持工作区 zip 导入/导出，与电脑 pi-xie 互拷。
 */
@Composable
fun WritingScreen(
    onGoBack: () -> Unit,
    onOpenRehearsal: () -> Unit,
    onOpenModelConfig: () -> Unit = {},
    viewModel: WritingViewModel = writingViewModel(),
) {
    LaunchedEffect(Unit) { viewModel.loadPremises() }
    var input by remember { mutableStateOf("") }
    var editingConstraint by remember { mutableStateOf<String?>(null) }
    var editingEntities by remember { mutableStateOf<EntityKind?>(null) }
    var showBackups by remember { mutableStateOf(false) }
    var showRules by remember { mutableStateOf(false) }
    var showChapters by remember { mutableStateOf(false) }
    var showSettings by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

    LaunchedEffect(viewModel.messages.size) {
        if (viewModel.messages.isNotEmpty()) listState.animateScrollToItem(viewModel.messages.lastIndex)
    }

    val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let(viewModel::planImport)
    }
    val exportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/zip"),
    ) { uri ->
        uri?.let(viewModel::exportWorkspace)
    }

    // Operit 气泡组件依赖主题快照；这里用当前活跃人设的主题快照提供
    val themeSnapshot = rememberActiveThemePreferenceSnapshot()
    CompositionLocalProvider(LocalThemePreferenceSnapshot provides themeSnapshot) {
        Column(Modifier.fillMaxSize()) {
        // 顶栏：写作 · 破甲开关 · 导入/导出 · 对戏
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("写作", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Spacer(Modifier.weight(1f))
            Text(
                "破甲",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Switch(
                checked = viewModel.unrestricted,
                onCheckedChange = { viewModel.changeUnrestricted(it) },
                modifier = Modifier.height(32.dp),
            )
            IconButton(onClick = { showSettings = true }) {
                Icon(Icons.Default.Settings, contentDescription = "设置")
            }
            Button(onClick = onOpenRehearsal) { Text("对戏") }
        }

        // 前提面板 + 工作区操作：可横向滑动（窄屏不裁剪）
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            listOf("worldview" to "世界观", "outline" to "大纲", "timeline" to "时间线", "style" to "风格")
                .forEach { (key, label) ->
                    FilterChip(
                        selected = false,
                        onClick = { editingConstraint = key },
                        label = { Text(label) },
                    )
                }
            FilterChip(
                selected = false,
                onClick = { editingEntities = EntityKind.CHARACTERS },
                label = { Text("角色") },
            )
            FilterChip(
                selected = false,
                onClick = { editingEntities = EntityKind.SCENES },
                label = { Text("场景") },
            )
            FilterChip(
                selected = false,
                onClick = { showRules = true },
                label = { Text("规则") },
            )
            FilterChip(
                selected = false,
                onClick = { showChapters = true },
                label = { Text("章节") },
            )
            TextButton(onClick = { importLauncher.launch(arrayOf("application/zip", "application/octet-stream")) }) {
                Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.width(16.dp))
                Spacer(Modifier.width(4.dp))
                Text("导入")
            }
            TextButton(onClick = { exportLauncher.launch("pi-xie-workspace.zip") }) {
                Icon(Icons.Default.Upload, contentDescription = null, modifier = Modifier.width(16.dp))
                Spacer(Modifier.width(4.dp))
                Text("导出")
            }
            TextButton(onClick = { showBackups = true }) {
                Icon(Icons.Default.History, contentDescription = null, modifier = Modifier.width(16.dp))
                Spacer(Modifier.width(4.dp))
                Text("备份")
            }
            TextButton(onClick = { viewModel.undoLast() }, enabled = viewModel.canUndo) {
                Icon(Icons.Default.Undo, contentDescription = null, modifier = Modifier.width(16.dp))
                Spacer(Modifier.width(4.dp))
                Text("撤销")
            }
        }

        if (viewModel.notice.isNotEmpty()) {
            Text(
                viewModel.notice,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 12.dp),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        HorizontalDivider(Modifier.padding(vertical = 4.dp))

        // 写作对话（Operit 气泡组件直接复用：markdown/主题/头像行为一致）
        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) {
            if (viewModel.messages.isEmpty()) {
                item {
                    Text(
                        "先在上面完善世界观/大纲/角色/场景等前置设定，或直接在这里和写作助理对话。全部就绪后点「对戏」进入排练。",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(16.dp),
                    )
                }
            }
            items(viewModel.messages.size) { index ->
                BubbleStyleChatMessage(
                    message = viewModel.messages[index],
                    userMessageColor = MaterialTheme.colorScheme.primaryContainer,
                    aiMessageColor = MaterialTheme.colorScheme.surfaceVariant,
                    userTextColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    aiTextColor = MaterialTheme.colorScheme.onSurface,
                    systemMessageColor = MaterialTheme.colorScheme.tertiaryContainer,
                    systemTextColor = MaterialTheme.colorScheme.onTertiaryContainer,
                )
            }
        }

        // 输入区：与 AI 对话经典输入栏完全一致的视觉结构
        // （圆角输入框 + 圆形按钮组：语音 / ＋附件 / 模型 / 发送）
        var showAttachmentPanel by remember { mutableStateOf(false) }
        Column {
            if (viewModel.pendingAttachments.isNotEmpty()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    viewModel.pendingAttachments.forEachIndexed { index, attachment ->
                        FilterChip(
                            selected = true,
                            onClick = { viewModel.removeAttachment(index) },
                            label = {
                                Text(
                                    attachment.label,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            },
                        )
                    }
                }
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 22.dp)
                    .padding(top = 8.dp, bottom = 8.dp)
                    .wrapContentHeight(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val inputShape = RoundedCornerShape(14.dp)
                val inputBorderColor =
                    if (input.isNotBlank()) {
                        MaterialTheme.colorScheme.outline
                    } else {
                        MaterialTheme.colorScheme.outline.copy(alpha = 0.72f)
                    }
                BasicTextField(
                    value = input,
                    onValueChange = { input = it },
                    modifier = Modifier
                        .weight(1f)
                        .heightIn(min = 30.dp),
                    textStyle = MaterialTheme.typography.bodyMedium.copy(
                        color = MaterialTheme.colorScheme.onSurface,
                    ),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    maxLines = 5,
                    minLines = 1,
                    enabled = !viewModel.busy,
                    decorationBox = { innerTextField ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .border(width = 1.dp, color = inputBorderColor, shape = inputShape)
                                .clip(inputShape)
                                .background(MaterialTheme.colorScheme.surface)
                                .padding(start = 14.dp, end = 8.dp, top = 7.dp, bottom = 7.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                modifier = Modifier
                                    .weight(1f)
                                    .padding(end = 6.dp, top = 7.dp, bottom = 7.dp),
                                contentAlignment = Alignment.CenterStart,
                            ) {
                                if (input.isEmpty()) {
                                    Text(
                                        text = "和写作助理对话：起草设定、改写剧情…",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                innerTextField()
                            }
                        }
                    },
                )

                Spacer(Modifier.width(8.dp))

                // ＋ 附件
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(
                            if (showAttachmentPanel) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.surfaceVariant
                            },
                        )
                        .clickable { showAttachmentPanel = !showAttachmentPanel },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Default.Add,
                        contentDescription = "添加文件/图片",
                        tint = if (showAttachmentPanel) {
                            MaterialTheme.colorScheme.onPrimary
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                        modifier = Modifier.size(18.dp),
                    )
                }

                Spacer(Modifier.width(8.dp))

                // 模型选择
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.surfaceVariant)
                        .clickable { onOpenModelConfig() },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Default.Tune,
                        contentDescription = "选择模型",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(18.dp),
                    )
                }

                Spacer(Modifier.width(8.dp))

                // 发送 / 停止
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(
                            if (viewModel.busy) {
                                MaterialTheme.colorScheme.error
                            } else {
                                MaterialTheme.colorScheme.primary
                            },
                        )
                        .clickable(
                            enabled = viewModel.busy ||
                                input.isNotBlank() ||
                                viewModel.pendingAttachments.isNotEmpty(),
                        ) {
                            if (viewModel.busy) {
                                viewModel.abort()
                            } else if (input.isNotBlank() || viewModel.pendingAttachments.isNotEmpty()) {
                                viewModel.send(input.trim())
                                input = ""
                            }
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = if (viewModel.busy) Icons.Default.Stop else Icons.Default.Send,
                        contentDescription = if (viewModel.busy) "停止" else "发送",
                        tint = MaterialTheme.colorScheme.onPrimary,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }
        AttachmentSelectorPanel(
            visible = showAttachmentPanel,
            onAttachImage = { path ->
                viewModel.attachImage(path)
                showAttachmentPanel = false
            },
            onAttachFile = { path ->
                viewModel.attachFile(path)
                showAttachmentPanel = false
            },
            onAttachScreenContent = {},
            onTakePhoto = { uri ->
                viewModel.notice = "拍照附件暂不可用"
                showAttachmentPanel = false
            },
            onDismiss = { showAttachmentPanel = false },
        )
        }

        editingConstraint?.let { key ->
            ConstraintEditorDialog(
                viewModel = viewModel,
                name = key,
                title = when (key) {
                    "worldview" -> "世界观"
                    "outline" -> "大纲"
                    "timeline" -> "时间线"
                    else -> "风格"
                },
                onDismiss = { editingConstraint = null },
            )
        }
        editingEntities?.let { kind ->
            EntityListDialog(
                viewModel = viewModel,
                kind = kind,
                onDismiss = { editingEntities = null },
            )
        }
        viewModel.importPlan?.let { plan ->
            ImportConfirmDialog(viewModel = viewModel, plan = plan)
        }
        if (showBackups) {
            BackupDialog(viewModel = viewModel, onDismiss = { showBackups = false })
        }
        if (showRules) {
            RulesDialog(viewModel = viewModel, onDismiss = { showRules = false })
        }
        if (showChapters) {
            ChapterListDialog(viewModel = viewModel, onDismiss = { showChapters = false })
        }
        if (showSettings) {
            SettingsDialog(viewModel = viewModel, onDismiss = { showSettings = false })
        }
        viewModel.pendingToolConfirm?.let { confirm ->
            ToolConfirmDialog(viewModel = viewModel, confirm = confirm)
        }
    }
}

@Composable
private fun writingViewModel(): WritingViewModel {
    val application = LocalContext.current.applicationContext as Application
    return viewModel(
        factory = viewModelFactory {
            initializer { WritingViewModel(application) }
        },
    )
}

@Composable
private fun ConstraintEditorDialog(
    viewModel: WritingViewModel,
    name: String,
    title: String,
    onDismiss: () -> Unit,
) {
    var text by remember(name) { mutableStateOf(viewModel.constraints[name] ?: "") }
    val metrics = rememberCompactDialogMetrics()
    // 起草流式填充：draftText 变化且针对本面板时写入编辑框
    LaunchedEffect(viewModel.draftText) {
        if (viewModel.draftTitle == title) text = viewModel.draftText
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    modifier = Modifier
                        .fillMaxWidth()
                        .compactDialogHeight(metrics, defaultMaxHeight = 320.dp),
                )
                if (viewModel.busy) {
                    Text(
                        "起草中…",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                viewModel.saveConstraint(name, text)
                onDismiss()
            }) { Text("保存") }
        },
        dismissButton = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { viewModel.draftConstraint(name) }, enabled = !viewModel.busy) {
                    Icon(Icons.Default.Edit, contentDescription = null)
                    Spacer(Modifier.width(4.dp))
                    Text("让 AI 起草")
                }
                TextButton(onClick = onDismiss) { Text("取消") }
            }
        },
    )
}

@Composable
private fun EntityListDialog(
    viewModel: WritingViewModel,
    kind: EntityKind,
    onDismiss: () -> Unit,
) {
    var editing by remember { mutableStateOf<EntityRecord?>(null) }
    var creating by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<EntityRecord?>(null) }
    val entities = if (kind == EntityKind.CHARACTERS) viewModel.characters else viewModel.scenes
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (kind == EntityKind.CHARACTERS) "角色" else "场景") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                if (entities.isEmpty()) {
                    Text("还没有内容，点「＋ 新建」添加。", style = MaterialTheme.typography.bodyMedium)
                }
                entities.forEach { entity ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Card(
                            onClick = { editing = entity },
                            modifier = Modifier.weight(1f),
                        ) {
                            Column(Modifier.padding(10.dp)) {
                                Text(entity.name, style = MaterialTheme.typography.titleSmall)
                                if (entity.body.isNotBlank()) {
                                    Text(
                                        entity.body,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 3,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                            }
                        }
                        IconButton(onClick = { deleting = entity }) {
                            Icon(
                                Icons.Default.Delete,
                                contentDescription = "删除${entity.name}",
                                tint = MaterialTheme.colorScheme.error,
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { creating = true }) { Text("＋ 新建") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("关闭") }
        },
    )

    if (creating) {
        EntityEditDialog(
            viewModel = viewModel,
            kind = kind,
            entity = null,
            onDismiss = { creating = false },
        )
    }
    editing?.let { entity ->
        EntityEditDialog(
            viewModel = viewModel,
            kind = kind,
            entity = entity,
            onDismiss = { editing = null },
        )
    }
    deleting?.let { entity ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("删除「${entity.name}」") },
            text = { Text("确定删除吗？删除后可用「撤销」恢复。") },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.deleteEntity(kind, entity.id)
                    deleting = null
                }) { Text("删除") }
            },
            dismissButton = {
                TextButton(onClick = { deleting = null }) { Text("取消") }
            },
        )
    }
}

@Composable
private fun EntityEditDialog(
    viewModel: WritingViewModel,
    kind: EntityKind,
    entity: EntityRecord?,
    onDismiss: () -> Unit,
) {
    var name by remember(entity) { mutableStateOf(entity?.name ?: "") }
    var body by remember(entity) { mutableStateOf(entity?.body ?: "") }
    val isCharacter = kind == EntityKind.CHARACTERS
    val metrics = rememberCompactDialogMetrics()
    // 防破坏：快照打开时的设定；用户一旦手改就停止草案自动采纳；可一键恢复原设定
    val originalBody = remember(entity) { entity?.body ?: "" }
    var bodyEdited by remember(entity) { mutableStateOf(false) }
    // 角色图片 → 写作 agent 视觉分析后流式写入外貌描写，用户未手改时采纳进设定
    LaunchedEffect(viewModel.draftText) {
        if (isCharacter && viewModel.draftTitle == "外貌：$name" && !bodyEdited) {
            body = viewModel.draftText
        }
    }
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let { selected ->
            val sourcePath = viewModel.copyUriToCache(selected) ?: return@let
            entity?.let { entityRecord ->
                val stored = viewModel.storeCharacterImage(entityRecord.id, sourcePath)
                if (stored != null) {
                    viewModel.draftAppearance(entityRecord.id, entityRecord.name, stored)
                }
            }
        }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (entity == null) "新建${if (isCharacter) "角色" else "场景"}" else "编辑「${entity.name}」") },
        text = {
            Column {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("名字") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = body,
                    onValueChange = {
                        body = it
                        bodyEdited = true
                    },
                    label = { Text(if (isCharacter) "设定（性格/外貌/口吻）" else "场景设定") },
                    modifier = Modifier
                        .fillMaxWidth()
                        .compactDialogHeight(metrics, defaultMaxHeight = 220.dp),
                )
                if (isCharacter && entity != null) {
                    if (viewModel.busy) {
                        Text(
                            "外貌分析中…",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        TextButton(onClick = { imagePicker.launch("image/*") }) {
                            Icon(Icons.Default.Image, contentDescription = null, modifier = Modifier.width(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("上传图片，让写作助手更新外貌")
                        }
                    }
                    if (body != originalBody) {
                        TextButton(onClick = {
                            body = originalBody
                            bodyEdited = false
                        }) { Text("恢复原设定") }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                if (isCharacter) {
                    viewModel.saveCharacter(entity?.id, name.trim(), body.trim())
                } else {
                    viewModel.saveScene(entity?.id, name.trim(), body.trim())
                }
                onDismiss()
            }, enabled = name.isNotBlank()) { Text("保存") }
        },
        dismissButton = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (isCharacter && entity != null) {
                    TextButton(onClick = { viewModel.exportCharacterToOperit(entity.id) }) {
                        Text("导出到 Operit 角色卡")
                    }
                }
                TextButton(onClick = onDismiss) { Text("取消") }
            }
        },
    )
}

/** 导入确认：显示冲突清单，用户选择覆盖策略（导入前已自动备份）。 */
@Composable
private fun ImportConfirmDialog(
    viewModel: WritingViewModel,
    plan: WorkspaceTransfer.ImportPlan,
) {
    AlertDialog(
        onDismissRequest = { viewModel.cancelImport() },
        title = { Text("导入工作区") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text(
                    "共 ${plan.totalFiles} 个文件：新增 ${plan.newFiles.size} 个，将覆盖 ${plan.conflicts.size} 个。导入前会自动备份当前工作区。",
                    style = MaterialTheme.typography.bodyMedium,
                )
                if (plan.conflicts.isNotEmpty()) {
                    Spacer(Modifier.height(8.dp))
                    Text("将被覆盖的文件：", style = MaterialTheme.typography.titleSmall)
                    plan.conflicts.take(8).forEach { name ->
                        Text("• $name", style = MaterialTheme.typography.bodySmall)
                    }
                    if (plan.conflicts.size > 8) {
                        Text("…等 ${plan.conflicts.size} 个", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { viewModel.confirmImport(overwrite = true) }) { Text("覆盖全部") }
        },
        dismissButton = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (plan.conflicts.isNotEmpty()) {
                    TextButton(onClick = { viewModel.confirmImport(overwrite = false) }) { Text("跳过冲突") }
                }
                TextButton(onClick = { viewModel.cancelImport() }) { Text("取消") }
            }
        },
    )
}

/** 备份管理：立即备份 + 从备份恢复（恢复前自动再备份当前状态）。 */
@Composable
private fun BackupDialog(viewModel: WritingViewModel, onDismiss: () -> Unit) {
    val backups by produceState(initialValue = emptyList<WorkspaceBackups.BackupInfo>()) {
        value = withContext(Dispatchers.IO) { viewModel.listBackups() }
    }
    var restoring by remember { mutableStateOf<WorkspaceBackups.BackupInfo?>(null) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("备份与恢复") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                if (backups.isEmpty()) {
                    Text("还没有备份。", style = MaterialTheme.typography.bodyMedium)
                }
                backups.forEach { backup ->
                    Card(
                        onClick = { restoring = backup },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp),
                    ) {
                        Column(Modifier.padding(10.dp)) {
                            Text(
                                "${backup.label} · ${backup.file.name}",
                                style = MaterialTheme.typography.titleSmall,
                            )
                            Text(
                                "%.1f KB".format(backup.size / 1024.0),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { viewModel.backupNow() }) { Text("立即备份") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("关闭") }
        },
    )
    restoring?.let { backup ->
        AlertDialog(
            onDismissRequest = { restoring = null },
            title = { Text("从备份恢复") },
            text = {
                Text(
                    "将用「${backup.file.name}」覆盖当前工作区（恢复前会自动备份当前状态）。",
                    style = MaterialTheme.typography.bodyMedium,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.restoreBackup(backup.file)
                    restoring = null
                }) { Text("恢复") }
            },
            dismissButton = {
                TextButton(onClick = { restoring = null }) { Text("取消") }
            },
        )
    }
}

/** 写作规则面板：逐条开关（持久化到 .pi-xie/writing-rules.json）。 */
@Composable
private fun RulesDialog(viewModel: WritingViewModel, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("写作规则") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                viewModel.rules.forEach { effective ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(effective.rule.name, style = MaterialTheme.typography.titleSmall)
                            Text(
                                effective.rule.text,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 4,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        Switch(
                            checked = effective.enabled,
                            onCheckedChange = { enabled ->
                                viewModel.toggleRule(effective.rule.id, enabled)
                            },
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("关闭") }
        },
    )
}

/** 章节面板：列表/新建/编辑（改写走 AI 起草 + 保存，落盘走撤销快照）。 */
@Composable
private fun ChapterListDialog(viewModel: WritingViewModel, onDismiss: () -> Unit) {
    val chapters by produceState(initialValue = emptyList<ChapterInfo>()) {
        value = withContext(Dispatchers.IO) { viewModel.store.listChapters() }
    }
    var editing by remember { mutableStateOf<String?>(null) }
    var creating by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("章节") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                if (chapters.isEmpty()) {
                    Text("还没有章节。", style = MaterialTheme.typography.bodyMedium)
                }
                chapters.forEach { chapter ->
                    Card(
                        onClick = { editing = chapter.file },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp),
                    ) {
                        Column(Modifier.padding(10.dp)) {
                            Text("第${chapter.number}章 · ${chapter.file}", style = MaterialTheme.typography.titleSmall)
                            Text(
                                chapter.content.take(60),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { creating = true }) { Text("＋ 新建章节") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("关闭") }
        },
    )
    if (creating) {
        ChapterEditDialog(viewModel = viewModel, file = null, onDismiss = { creating = false })
    }
    editing?.let { file ->
        ChapterEditDialog(viewModel = viewModel, file = file, onDismiss = { editing = null })
    }
}

@Composable
private fun ChapterEditDialog(viewModel: WritingViewModel, file: String?, onDismiss: () -> Unit) {
    var content by remember(file) { mutableStateOf("") }
    var loaded by remember(file) { mutableStateOf(file == null) }
    // 异步加载章节内容（避免组合期间主线程文件 IO）
    LaunchedEffect(file) {
        if (file != null) {
            content = withContext(Dispatchers.IO) { viewModel.chapterContent(file) }
        }
        loaded = true
    }
    // 起草流式采纳：draftTitle == "章节：$file" 时写入编辑框
    LaunchedEffect(viewModel.draftText) {
        if (file != null && viewModel.draftTitle == "章节：$file") {
            content = viewModel.draftText
        }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (file == null) "新建章节" else "编辑 $file") },
        text = {
            Column {
                OutlinedTextField(
                    value = content,
                    onValueChange = { content = it },
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 200.dp, max = 420.dp),
                    label = { Text(if (viewModel.busy) "改写中…" else "章节正文") },
                )
            }
        },
        confirmButton = {
            TextButton(onClick = {
                viewModel.saveChapter(file, content)
                onDismiss()
            }, enabled = loaded && content.isNotBlank()) { Text("保存") }
        },
        dismissButton = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (file != null) {
                    TextButton(onClick = { viewModel.draftChapter(file) }, enabled = !viewModel.busy) {
                        Icon(Icons.Default.Edit, contentDescription = null)
                        Spacer(Modifier.width(4.dp))
                        Text("让 AI 改写")
                    }
                }
                TextButton(onClick = onDismiss) { Text("取消") }
            }
        },
    )
}

/** 统一设置弹窗：自动写入 / 默认扮演 / 前提选择 / manuscript 重建 / 酒馆角色导入。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsDialog(viewModel: WritingViewModel, onDismiss: () -> Unit) {
    var premiseChar by remember(viewModel.characters) {
        mutableStateOf(viewModel.store.getActive().characters.firstOrNull() ?: "")
    }
    var premiseScene by remember(viewModel.scenes) {
        mutableStateOf(viewModel.store.getActive().scenes.firstOrNull() ?: "")
    }
    var charExpanded by remember { mutableStateOf(false) }
    var sceneExpanded by remember { mutableStateOf(false) }
    var roleExpanded by remember { mutableStateOf(false) }
    val tavernLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let(viewModel::importTavern)
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("设置") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("自动写入", style = MaterialTheme.typography.titleSmall)
                        Text(
                            "开启后写作助理的工具操作免确认（.pi-xie/permissions.json）",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(checked = viewModel.autoWrite, onCheckedChange = { viewModel.toggleAutoWrite() })
                }

                Spacer(Modifier.height(8.dp))
                Text("默认扮演（AI 选角时使用）", style = MaterialTheme.typography.titleSmall)
                ExposedDropdownMenuBox(expanded = roleExpanded, onExpandedChange = { roleExpanded = it }) {
                    OutlinedTextField(
                        value = viewModel.defaultRoleId?.let { id ->
                            viewModel.characters.firstOrNull { it.id == id }?.name ?: id
                        } ?: "旁白/自己",
                        onValueChange = {},
                        readOnly = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .menuAnchor(),
                    )
                    DropdownMenu(expanded = roleExpanded, onDismissRequest = { roleExpanded = false }) {
                        DropdownMenuItem(
                            text = { Text("旁白/自己") },
                            onClick = {
                                viewModel.setDefaultRole(null)
                                roleExpanded = false
                            },
                        )
                        viewModel.characters.forEach { character ->
                            DropdownMenuItem(
                                text = { Text(character.name) },
                                onClick = {
                                    viewModel.setDefaultRole(character.id)
                                    roleExpanded = false
                                },
                            )
                        }
                    }
                }

                Spacer(Modifier.height(8.dp))
                Text("前提选择（active.json）", style = MaterialTheme.typography.titleSmall)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("主角：", style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.width(8.dp))
                    ExposedDropdownMenuBox(
                        expanded = charExpanded,
                        onExpandedChange = { charExpanded = it },
                        modifier = Modifier.weight(1f),
                    ) {
                        OutlinedTextField(
                            value = viewModel.characters.firstOrNull { it.id == premiseChar }?.name ?: "（无）",
                            onValueChange = {},
                            readOnly = true,
                            modifier = Modifier
                                .fillMaxWidth()
                                .menuAnchor(),
                        )
                        DropdownMenu(expanded = charExpanded, onDismissRequest = { charExpanded = false }) {
                            DropdownMenuItem(
                                text = { Text("（无）") },
                                onClick = {
                                    premiseChar = ""
                                    charExpanded = false
                                },
                            )
                            viewModel.characters.forEach { character ->
                                DropdownMenuItem(
                                    text = { Text(character.name) },
                                    onClick = {
                                        premiseChar = character.id
                                        charExpanded = false
                                    },
                                )
                            }
                        }
                    }
                }
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("主场景：", style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.width(8.dp))
                    ExposedDropdownMenuBox(
                        expanded = sceneExpanded,
                        onExpandedChange = { sceneExpanded = it },
                        modifier = Modifier.weight(1f),
                    ) {
                        OutlinedTextField(
                            value = viewModel.scenes.firstOrNull { it.id == premiseScene }?.name ?: "（无）",
                            onValueChange = {},
                            readOnly = true,
                            modifier = Modifier
                                .fillMaxWidth()
                                .menuAnchor(),
                        )
                        DropdownMenu(expanded = sceneExpanded, onDismissRequest = { sceneExpanded = false }) {
                            DropdownMenuItem(
                                text = { Text("（无）") },
                                onClick = {
                                    premiseScene = ""
                                    sceneExpanded = false
                                },
                            )
                            viewModel.scenes.forEach { scene ->
                                DropdownMenuItem(
                                    text = { Text(scene.name) },
                                    onClick = {
                                        premiseScene = scene.id
                                        sceneExpanded = false
                                    },
                                )
                            }
                        }
                    }
                }
                TextButton(onClick = {
                    viewModel.selectPremises(
                        listOf(premiseChar).filter { it.isNotEmpty() },
                        listOf(premiseScene).filter { it.isNotEmpty() },
                    )
                }) { Text("保存前提选择") }

                Spacer(Modifier.height(8.dp))
                TextButton(onClick = { viewModel.rebuildManuscript() }) { Text("重建 manuscript.txt") }

                Spacer(Modifier.height(8.dp))
                TextButton(onClick = {
                    tavernLauncher.launch(arrayOf("application/json", "text/plain", "application/octet-stream"))
                }) {
                    Text("酒馆角色卡导入（Tavern JSON）")
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("关闭") }
        },
    )
}

/** 工具执行确认（PC 行为：mutating 工具默认逐个确认）。 */
@Composable
private fun ToolConfirmDialog(viewModel: WritingViewModel, confirm: WritingViewModel.ToolConfirm) {
    AlertDialog(
        onDismissRequest = { viewModel.answerToolConfirm(false) },
        title = { Text("运行工具 ${confirm.name}？") },
        text = {
            Text(
                confirm.summary.ifBlank { "（无参数）" },
                style = MaterialTheme.typography.bodyMedium,
            )
        },
        confirmButton = {
            TextButton(onClick = { viewModel.answerToolConfirm(true) }) { Text("允许") }
        },
        dismissButton = {
            TextButton(onClick = { viewModel.answerToolConfirm(false) }) { Text("拒绝") }
        },
    )
}

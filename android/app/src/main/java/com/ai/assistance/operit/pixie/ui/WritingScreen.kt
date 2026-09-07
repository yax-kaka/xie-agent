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
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.Upload
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
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
import com.ai.assistance.operit.pixie.workspace.EntityKind
import com.ai.assistance.operit.pixie.workspace.EntityRecord
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
    val listState = rememberLazyListState()

    LaunchedEffect(viewModel.messages.size) {
        if (viewModel.messages.isNotEmpty()) listState.animateScrollToItem(viewModel.messages.lastIndex)
    }

    val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let(viewModel::importWorkspace)
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
                onCheckedChange = { viewModel.unrestricted = it },
                modifier = Modifier.height(32.dp),
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
            Button(onClick = onOpenRehearsal) { Text("对戏") }
        }

        // 前提面板：世界观/大纲/时间线/风格/角色/场景
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
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

                // 语音（sherpa-ncnn 恢复后接入）
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.surfaceVariant)
                        .clickable {
                            viewModel.notice = "语音输入将在恢复 sherpa-ncnn 后启用"
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        imageVector = Icons.Default.Mic,
                        contentDescription = "语音输入",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(18.dp),
                    )
                }

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
                    Card(
                        onClick = { editing = entity },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp),
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
    // 角色图片 → 写作 agent 视觉分析后流式写入外貌描写，直接采纳进设定
    LaunchedEffect(viewModel.draftText) {
        if (isCharacter && viewModel.draftTitle == "外貌：$name") {
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
                    onValueChange = { body = it },
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

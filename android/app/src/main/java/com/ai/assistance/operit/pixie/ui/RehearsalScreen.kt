package com.ai.assistance.operit.pixie.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.toMutableStateList
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.platform.LocalContext
import android.app.Application
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.ai.assistance.operit.data.model.ChatMessage
import com.ai.assistance.operit.pixie.workspace.ChapterInfo
import com.ai.assistance.operit.ui.features.chat.components.style.bubble.BubbleStyleChatMessage
import com.ai.assistance.operit.ui.theme.LocalThemePreferenceSnapshot
import com.ai.assistance.operit.ui.theme.rememberActiveThemePreferenceSnapshot
import kotlinx.coroutines.launch

/**
 * 对戏屏：pi-xie 对戏在 Android 的完整 UI。
 * - 命令全部可点（点名条/重说/改台词/发言顺序/监视），不需要敲 `/`；
 * - 长按台词行弹出菜单（重说/改台词/复制）；
 * - 直播条实时显示各角色发言状态与流式文本；
 * - 监视面板左右滑动切换角色。
 */
@Composable
fun RehearsalScreen(
    onGoBack: () -> Unit,
    viewModel: RehearsalViewModel = rehearsalViewModel(),
) {
    LaunchedEffect(Unit) {
        if (!viewModel.active) viewModel.loadSetupData()
    }
    if (viewModel.active) {
        ActivePanel(viewModel = viewModel, onGoBack = onGoBack)
    } else {
        SetupSheet(viewModel = viewModel)
    }
}

/**
 * 路由级 ViewModelStoreOwner 不是 HasDefaultViewModelProviderFactory，
 * 默认 viewModel() 会走无参构造反射（NoSuchMethodException），必须显式给 Application 工厂。
 */
@Composable
private fun rehearsalViewModel(): RehearsalViewModel {
    val application = LocalContext.current.applicationContext as Application
    return viewModel(
        factory = viewModelFactory {
            initializer { RehearsalViewModel(application) }
        },
    )
}

// ==================== 进入对戏设置面板 ====================

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SetupSheet(viewModel: RehearsalViewModel) {
    var showCreateScene by remember { mutableStateOf(false) }
    var showCreateCharacter by remember { mutableStateOf(false) }
    var unrestricted by remember { mutableStateOf(true) }
    // 按当前场景 + 选中角色实时判断是否已有记录（显示「续写对戏」）
    val recordExists by produceState(
        initialValue = false,
        viewModel.sceneId,
        viewModel.selectedCharacterIds,
    ) {
        value = withContext(Dispatchers.IO) {
            viewModel.recordExistsFor(viewModel.sceneId, viewModel.selectedCharacterIds)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
    ) {
        Text("对戏", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text(
            "AI 扮演角色、你扮演任意角色或做导演旁白。输入「@角色名 台词」可点名。",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(16.dp))

        // 场景选择
        Text("场景", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(4.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            SceneDropdown(viewModel, Modifier.weight(1f))
            Spacer(Modifier.width(8.dp))
            IconButton(onClick = { showCreateScene = true }) {
                Icon(Icons.Default.Add, contentDescription = "新建场景")
            }
        }

        Spacer(Modifier.height(12.dp))
        Text("AI 扮演的角色（可多选）", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(4.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            viewModel.characters.forEach { character ->
                FilterChip(
                    selected = character.id in viewModel.selectedCharacterIds,
                    onClick = {
                        viewModel.selectedCharacterIds =
                            if (character.id in viewModel.selectedCharacterIds) {
                                viewModel.selectedCharacterIds - character.id
                            } else {
                                viewModel.selectedCharacterIds + character.id
                            }
                    },
                    label = { Text(character.name) },
                )
            }
            FilterChip(
                selected = false,
                onClick = { showCreateCharacter = true },
                label = { Text("＋ 新建角色") },
            )
        }
        if (viewModel.characters.isEmpty()) {
            Text(
                "还没有角色卡。点「＋ 新建角色」先创建一个。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }

        Spacer(Modifier.height(12.dp))
        Text("你扮演", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(4.dp))
        UserRoleDropdown(viewModel)

        Spacer(Modifier.height(12.dp))
        Text("起始情境", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(4.dp))
        OutlinedTextField(
            value = viewModel.sceneStart,
            onValueChange = { viewModel.sceneStart = it },
            modifier = Modifier.fillMaxWidth(),
            minLines = 3,
            placeholder = { Text("本场对戏的开场情境，可直接用、修改或重写") },
        )

        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("破甲（不受限创作，提示词置顶）", style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.weight(1f))
            Switch(checked = unrestricted, onCheckedChange = { unrestricted = it })
        }

        if (viewModel.notice.isNotEmpty()) {
            Text(
                viewModel.notice,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
        Spacer(Modifier.height(16.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(
                onClick = { viewModel.start(unrestricted = unrestricted, startNew = true) },
                enabled = viewModel.sceneId.isNotEmpty() && viewModel.selectedCharacterIds.isNotEmpty(),
            ) {
                Text("开始对戏")
            }
            if (recordExists) {
                OutlinedButton(onClick = { viewModel.start(unrestricted = unrestricted, startNew = false) }) {
                    Text("续写对戏")
                }
            }
        }
    }

    if (showCreateScene) {
        CreateSceneDialog(
            onDismiss = { showCreateScene = false },
            onCreate = { name, body ->
                viewModel.createScene(name, body)
                showCreateScene = false
            },
        )
    }
    if (showCreateCharacter) {
        CreateCharacterDialog(
            onDismiss = { showCreateCharacter = false },
            onCreate = { name, body ->
                viewModel.createCharacter(name, body)
                showCreateCharacter = false
            },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SceneDropdown(viewModel: RehearsalViewModel, modifier: Modifier = Modifier) {
    var expanded by remember { mutableStateOf(false) }
    val selected = viewModel.scenes.firstOrNull { it.id == viewModel.sceneId }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }, modifier = modifier) {
        OutlinedTextField(
            value = selected?.name ?: "",
            onValueChange = {},
            readOnly = true,
            label = { Text("选择场景") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(),
        )
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            viewModel.scenes.forEach { scene ->
                DropdownMenuItem(
                    text = { Text(scene.name) },
                    onClick = {
                        viewModel.selectScene(scene.id)
                        expanded = false
                    },
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun UserRoleDropdown(viewModel: RehearsalViewModel) {
    var expanded by remember { mutableStateOf(false) }
    val options = listOf("旁白/自己") + viewModel.characters.map { it.name }
    val current = viewModel.userRoleName ?: "旁白/自己"
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
        OutlinedTextField(
            value = current,
            onValueChange = {},
            readOnly = true,
            label = { Text("角色") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier
                .fillMaxWidth()
                .menuAnchor(),
        )
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(option) },
                    onClick = {
                        viewModel.userRoleName = option.takeIf { it != "旁白/自己" }
                        expanded = false
                    },
                )
            }
        }
    }
}

@Composable
private fun CreateSceneDialog(onDismiss: () -> Unit, onCreate: (String, String) -> Unit) {
    var name by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("新建场景") },
        text = {
            Column {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("场景名") },
                    singleLine = true,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = body,
                    onValueChange = { body = it },
                    label = { Text("场景设定") },
                    minLines = 3,
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onCreate(name.trim(), body.trim()) },
                enabled = name.isNotBlank(),
            ) { Text("创建") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun CreateCharacterDialog(onDismiss: () -> Unit, onCreate: (String, String) -> Unit) {
    var name by remember { mutableStateOf("") }
    var body by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("新建角色") },
        text = {
            Column {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("名字") },
                    singleLine = true,
                )
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = body,
                    onValueChange = { body = it },
                    label = { Text("设定（性格/外貌/口吻）") },
                    minLines = 4,
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onCreate(name.trim(), body.trim()) },
                enabled = name.isNotBlank(),
            ) { Text("创建") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

// ==================== 对戏进行中 ====================

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ActivePanel(viewModel: RehearsalViewModel, onGoBack: () -> Unit) {
    // Operit 气泡组件依赖主题快照
    val themeSnapshot = rememberActiveThemePreferenceSnapshot()
    var input by remember { mutableStateOf("") }
    var menuForLine by remember { mutableStateOf<Int?>(null) }
    var confirmRetell by remember { mutableStateOf<Int?>(null) }
    var showRetellDialog by remember { mutableStateOf(false) }
    var showEditDialog by remember { mutableStateOf(false) }
    var showOrderDialog by remember { mutableStateOf(false) }
    var showMonitor by remember { mutableStateOf(false) }
    var showProseDialog by remember { mutableStateOf(false) }
    var proseExitAfterSave by remember { mutableStateOf(false) }
    var showExitDialog by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()
    val clipboard = LocalClipboardManager.current

    LaunchedEffect(viewModel.lines.size) {
        if (viewModel.lines.isNotEmpty()) listState.animateScrollToItem(viewModel.lines.lastIndex)
    }

    Column(Modifier.fillMaxSize()) {
        // 顶栏
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "对戏 · ${viewModel.sceneName}",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.width(8.dp))
            Text(
                "你：${viewModel.userRoleLabel}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.weight(1f))
            if (viewModel.busy) {
                TextButton(onClick = { viewModel.abort() }) {
                    Icon(Icons.Default.Stop, contentDescription = null)
                    Spacer(Modifier.width(4.dp))
                    Text("停止")
                }
            }
            TextButton(onClick = { showProseDialog = true }) { Text("成文") }
            TextButton(onClick = { showMonitor = true }) { Text("监视") }
            TextButton(onClick = { showOrderDialog = true }) { Text("顺序") }
            TextButton(onClick = { showExitDialog = true }) { Text("退出") }
        }

        // 摘要与提示
        val statusText = buildList {
            if (viewModel.busy) add("进行中…")
            if (viewModel.summary.isNotEmpty()) add(viewModel.summary)
            if (viewModel.notice.isNotEmpty()) add(viewModel.notice)
        }.joinToString(" · ")
        if (statusText.isNotEmpty()) {
            Text(
                statusText,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 12.dp),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }

        // 直播条：各角色状态 + 流式文本
        LiveBar(viewModel)
        HorizontalDivider()

        // 台词列表
        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) {
            itemsIndexed(viewModel.lines, key = { _, ui -> ui.number }) { _, ui ->
                CompositionLocalProvider(LocalThemePreferenceSnapshot provides themeSnapshot) {
                    RoleplayLineBubble(
                        ui = ui,
                        menuExpanded = menuForLine == ui.number,
                        onDismissMenu = { menuForLine = null },
                        onLongPress = { menuForLine = ui.number },
                        onRetell = {
                            menuForLine = null
                            confirmRetell = ui.number
                        },
                        onEdit = {
                            menuForLine = null
                            showEditDialog = true
                        },
                        onCopy = {
                            menuForLine = null
                            clipboard.setText(
                                AnnotatedString("${com.ai.assistance.operit.pixie.workspace.RehearsalRecord.formatRoleLine(ui.line)}"),
                            )
                        },
                    )
                }
            }
        }

        // 点名条：一键填入 @角色名
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            viewModel.participants.forEach { participant ->
                FilterChip(
                    selected = false,
                    onClick = {
                        input = if (input.isBlank()) {
                            "@${participant.name} "
                        } else {
                            "$input @${participant.name} "
                        }
                    },
                    label = {
                        Text(
                            "@${participant.name}",
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.widthIn(max = 140.dp),
                        )
                    },
                )
            }
            OutlinedButton(onClick = { showRetellDialog = true }) {
                Icon(Icons.Default.Refresh, contentDescription = null)
                Spacer(Modifier.width(4.dp))
                Text("重说")
            }
            OutlinedButton(onClick = { showEditDialog = true }) {
                Icon(Icons.Default.Edit, contentDescription = null)
                Spacer(Modifier.width(4.dp))
                Text("改台词")
            }
        }

        // 输入行
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = input,
                onValueChange = { input = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text("输入台词，或 @角色名 台词点名") },
                enabled = !viewModel.busy,
                maxLines = 3,
            )
            Spacer(Modifier.width(8.dp))
            FilledIconButton(
                onClick = {
                    if (!viewModel.busy && input.isNotBlank()) {
                        viewModel.send(input.trim())
                        input = ""
                    }
                },
                enabled = !viewModel.busy && input.isNotBlank(),
            ) {
                Icon(Icons.Default.Send, contentDescription = "发送")
            }
        }
    }

    // 长按确认重说
    confirmRetell?.let { number ->
        val line = viewModel.lines.firstOrNull { it.number == number }
        if (line != null) {
            AlertDialog(
                onDismissRequest = { confirmRetell = null },
                title = { Text("重说这句（其后内容一并作废）") },
                text = { Text(com.ai.assistance.operit.pixie.workspace.RehearsalRecord.formatRoleLine(line.line)) },
                confirmButton = {
                    TextButton(onClick = {
                        viewModel.retell(number)
                        confirmRetell = null
                    }) { Text("重说") }
                },
                dismissButton = { TextButton(onClick = { confirmRetell = null }) { Text("取消") } },
            )
        }
    }
    if (showRetellDialog) {
        RetellDialog(viewModel) { showRetellDialog = false }
    }
    if (showEditDialog) {
        EditLineDialog(viewModel) { showEditDialog = false }
    }
    if (showOrderDialog) {
        OrderDialog(viewModel) { showOrderDialog = false }
    }
    if (showMonitor) {
        MonitorOverlay(viewModel) { showMonitor = false }
    }
    if (showProseDialog) {
        ProseDialog(
            viewModel = viewModel,
            onSaved = {
                if (proseExitAfterSave) {
                    viewModel.exit()
                    onGoBack()
                }
            },
            onDismiss = {
                showProseDialog = false
                proseExitAfterSave = false
            },
        )
    }
    if (showExitDialog) {
        ExitRehearsalDialog(
            viewModel = viewModel,
            onExit = {
                showExitDialog = false
                viewModel.exit()
                onGoBack()
            },
            onProseAndExit = {
                showExitDialog = false
                proseExitAfterSave = true
                showProseDialog = true
            },
            onNewSegment = {
                showExitDialog = false
                viewModel.start(unrestricted = true, startNew = true)
            },
            onDismiss = { showExitDialog = false },
        )
    }
}

@Composable
private fun LiveBar(viewModel: RehearsalViewModel) {
    // 单行紧凑直播条：每角色一个状态点 + 名字；正在发言的角色在行尾显示流式尾文
    val speaking = viewModel.participants.firstOrNull { participant ->
        (viewModel.activities[participant.id] ?: ActivitySnapshot("idle", "")).status == "speaking"
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            viewModel.participants.forEach { participant ->
                val activity = viewModel.activities[participant.id] ?: ActivitySnapshot("idle", "")
                val dotColor = when (activity.status) {
                    "speaking" -> Color(0xFF2E7D32)
                    "thinking" -> Color(0xFFB26A00)
                    else -> Color(0xFF9E9E9E)
                }
                Surface(
                    shape = MaterialTheme.shapes.small,
                    color = MaterialTheme.colorScheme.surfaceVariant,
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            Modifier
                                .size(8.dp)
                                .background(dotColor, CircleShape),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text(
                            participant.name,
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.widthIn(max = 120.dp),
                        )
                    }
                }
            }
        }
        speaking?.let { participant ->
            val activity = viewModel.activities[participant.id] ?: return@let
            Spacer(Modifier.width(8.dp))
            Text(
                activity.stream.replace(Regex("\\s+"), " ").takeLast(30),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun RoleplayLineBubble(
    ui: UiLine,
    menuExpanded: Boolean,
    onDismissMenu: () -> Unit,
    onLongPress: () -> Unit,
    onRetell: () -> Unit,
    onEdit: () -> Unit,
    onCopy: () -> Unit,
) {
    // Operit 头像+气泡风格：AI 行按 roleName 查角色卡头像；
    // 气泡已显示角色名时不再重复行首标签（主题关闭角色名时才补上）
    val themeSnapshot = LocalThemePreferenceSnapshot.current
    Box {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .combinedClickable(onClick = {}, onLongClick = onLongPress),
        ) {
            if (ui.line.user || !themeSnapshot.showRoleName) {
                Text(
                    ui.line.speaker,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    color = if (ui.line.user) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.tertiary
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(
                            start = if (ui.line.user) 0.dp else 16.dp,
                            end = if (ui.line.user) 16.dp else 0.dp,
                            top = 4.dp,
                        ),
                    textAlign = if (ui.line.user) androidx.compose.ui.text.style.TextAlign.End else androidx.compose.ui.text.style.TextAlign.Start,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            BubbleStyleChatMessage(
                message = ChatMessage(
                    sender = if (ui.line.user) "user" else "ai",
                    content = ui.line.text,
                    roleName = if (ui.line.user) "" else ui.line.speaker,
                ),
                userMessageColor = MaterialTheme.colorScheme.primaryContainer,
                aiMessageColor = MaterialTheme.colorScheme.surfaceVariant,
                userTextColor = MaterialTheme.colorScheme.onPrimaryContainer,
                aiTextColor = MaterialTheme.colorScheme.onSurface,
                systemMessageColor = MaterialTheme.colorScheme.tertiaryContainer,
                systemTextColor = MaterialTheme.colorScheme.onTertiaryContainer,
            )
        }
        DropdownMenu(expanded = menuExpanded, onDismissRequest = onDismissMenu) {
            if (!ui.line.user) {
                DropdownMenuItem(text = { Text("重说这句") }, onClick = onRetell)
            }
            DropdownMenuItem(text = { Text("改台词") }, onClick = onEdit)
            DropdownMenuItem(text = { Text("复制") }, onClick = onCopy)
        }
    }
}

@Composable
private fun RetellDialog(viewModel: RehearsalViewModel, onDismiss: () -> Unit) {
    val candidates = viewModel.lines.filter { !it.line.user }.takeLast(8)
    var selected by remember(candidates) { mutableStateOf(candidates.lastOrNull()?.number) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("重说（其后内容一并作废）") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                if (candidates.isEmpty()) {
                    Text("本段还没有 AI 的回应。")
                } else {
                    candidates.forEach { ui ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .selectable(
                                    selected = selected == ui.number,
                                    onClick = { selected = ui.number },
                                ),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = selected == ui.number, onClick = { selected = ui.number })
                            Text(
                                "${ui.number} · ${com.ai.assistance.operit.pixie.workspace.RehearsalRecord.formatRoleLine(
                                    ui.line.copy(text = ui.line.text.take(40)),
                                )}",
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    selected?.let { viewModel.retell(it) }
                    onDismiss()
                },
                enabled = selected != null,
            ) { Text("重说") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun EditLineDialog(viewModel: RehearsalViewModel, onDismiss: () -> Unit) {
    val candidates = viewModel.lines.takeLast(8)
    var selected by remember(candidates) { mutableStateOf(candidates.lastOrNull()?.number) }
    var edited by remember(candidates) {
        mutableStateOf(
            candidates.lastOrNull()?.let { com.ai.assistance.operit.pixie.workspace.RehearsalRecord.formatRoleLine(it.line) } ?: "",
        )
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("改台词") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                candidates.forEach { ui ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .selectable(
                                selected = selected == ui.number,
                                onClick = {
                                    selected = ui.number
                                    edited = com.ai.assistance.operit.pixie.workspace.RehearsalRecord.formatRoleLine(ui.line)
                                },
                            ),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = selected == ui.number, onClick = {
                            selected = ui.number
                            edited = com.ai.assistance.operit.pixie.workspace.RehearsalRecord.formatRoleLine(ui.line)
                        })
                        Text(
                            "${ui.number} · ${com.ai.assistance.operit.pixie.workspace.RehearsalRecord.formatRoleLine(
                                ui.line.copy(text = ui.line.text.take(40)),
                            )}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = edited,
                    onValueChange = { edited = it },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                    label = { Text("新台词（清空 = 删除该行）") },
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    selected?.let { viewModel.editLine(it, edited) }
                    onDismiss()
                },
                enabled = selected != null,
            ) { Text("保存") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun OrderDialog(viewModel: RehearsalViewModel, onDismiss: () -> Unit) {
    val ids = remember(viewModel.participants) { viewModel.participants.map { it.id }.toMutableStateList() }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("发言顺序（轮内评估先后）") },
        text = {
            Column {
                ids.forEachIndexed { index, id ->
                    val name = viewModel.participants.firstOrNull { it.id == id }?.name ?: id
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "${index + 1}. $name",
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.weight(1f),
                        )
                        IconButton(
                            onClick = {
                                if (index > 0) {
                                    val moved = ids.removeAt(index)
                                    ids.add(index - 1, moved)
                                }
                            },
                            enabled = index > 0,
                        ) {
                            Icon(Icons.Default.ArrowUpward, contentDescription = "上移")
                        }
                        IconButton(
                            onClick = {
                                if (index < ids.lastIndex) {
                                    val moved = ids.removeAt(index)
                                    ids.add(index + 1, moved)
                                }
                            },
                            enabled = index < ids.lastIndex,
                        ) {
                            Icon(Icons.Default.ArrowDownward, contentDescription = "下移")
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = {
                viewModel.setOrder(ids.toList())
                onDismiss()
            }) { Text("保存") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun ProseDialog(
    viewModel: RehearsalViewModel,
    onSaved: () -> Unit = {},
    onDismiss: () -> Unit,
) {
    // 对齐电脑 pi-xie 的 /对戏成文：选章节（最新在前）→ 可选续写位置 → 成文 → 保存落盘
    val chapters by produceState(initialValue = emptyList<ChapterInfo>()) {
        value = withContext(Dispatchers.IO) { viewModel.chapters().reversed() }
    }
    var chapterFile by remember { mutableStateOf(chapters.firstOrNull()?.file) }
    var continuation by remember { mutableStateOf("") }
    var started by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("对戏成文") },
        text = {
            Column {
                if (chapters.isEmpty()) {
                    Text(
                        "还没有章节，请先在写作里写出章节。",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                } else if (!started && viewModel.proseDraft.isEmpty() && !viewModel.proseBusy) {
                    Text(
                        "把当前对戏记录改写成小说正文（逐句保留台词）写入所选章节，可选续写。",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        chapters.forEach { chapter ->
                            FilterChip(
                                selected = chapterFile == chapter.file,
                                onClick = { chapterFile = chapter.file },
                                label = { Text("第${chapter.number}章") },
                            )
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = continuation,
                        onValueChange = { continuation = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("成文后继续写到的位置（可选）") },
                        placeholder = { Text("例如：继续写到太阳落山，两人下山。留空则只写入对话正文") },
                        minLines = 2,
                    )
                } else {
                    OutlinedTextField(
                        value = viewModel.proseDraft,
                        onValueChange = { viewModel.proseDraft = it },
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 200.dp, max = 420.dp),
                        label = { Text(if (viewModel.proseBusy) "成文中…" else "正文（可修改）") },
                    )
                }
            }
        },
        confirmButton = {
            when {
                started && viewModel.proseDraft.isNotEmpty() && !viewModel.proseBusy -> {
                    TextButton(onClick = {
                        viewModel.saveProseToChapter()
                        onSaved()
                        onDismiss()
                    }) { Text("保存") }
                }
                !started && chapters.isNotEmpty() && chapterFile != null && !viewModel.proseBusy -> {
                    TextButton(onClick = {
                        started = true
                        viewModel.draftProse(chapterFile!!, continuation)
                    }) { Text("成文") }
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("关闭") }
        },
    )
}

/** 退出对戏菜单：与电脑 pi-xie 一致的三选项。 */
@Composable
private fun ExitRehearsalDialog(
    viewModel: RehearsalViewModel,
    onExit: () -> Unit,
    onProseAndExit: () -> Unit,
    onNewSegment: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("对戏模式") },
        text = {
            Column {
                TextButton(onClick = onExit) { Text("退出对戏") }
                TextButton(onClick = onProseAndExit) { Text("退出并成文") }
                TextButton(onClick = onNewSegment) { Text("新开一段对戏") }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        },
    )
}

@Composable
private fun MonitorOverlay(viewModel: RehearsalViewModel, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss) {
        Surface(
            modifier = Modifier
                .fillMaxWidth(0.95f)
                .fillMaxHeight(0.75f),
            shape = MaterialTheme.shapes.large,
        ) {
            Column(Modifier.padding(16.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("对戏监视", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick = onDismiss) { Text("关闭") }
                }
                if (viewModel.participants.isEmpty()) {
                    Text("没有角色。", style = MaterialTheme.typography.bodyMedium)
                } else {
                    val pagerState = rememberPagerState { viewModel.participants.size }
                    val scope = rememberCoroutineScope()
                    Row(Modifier.horizontalScroll(rememberScrollState())) {
                        viewModel.participants.forEachIndexed { index, participant ->
                            FilterChip(
                                selected = pagerState.currentPage == index,
                                onClick = { scope.launch { pagerState.animateScrollToPage(index) } },
                                label = { Text(participant.name) },
                            )
                        }
                    }
                    HorizontalPager(state = pagerState, modifier = Modifier.fillMaxSize()) { page ->
                        val participant = viewModel.participants[page]
                        val activity = viewModel.activities[participant.id] ?: ActivitySnapshot("idle", "")
                        val statusLabel = when (activity.status) {
                            "speaking" -> "发言中"
                            "thinking" -> "思考中"
                            else -> "空闲"
                        }
                        Column(Modifier.padding(top = 12.dp)) {
                            Text(
                                "${participant.name} · $statusLabel",
                                style = MaterialTheme.typography.titleSmall,
                            )
                            Spacer(Modifier.height(8.dp))
                            SelectionContainer {
                                Text(
                                    activity.stream.ifEmpty { "（最近还没有回应内容）" },
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontFamily = FontFamily.Monospace,
                                    modifier = Modifier.verticalScroll(rememberScrollState()),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

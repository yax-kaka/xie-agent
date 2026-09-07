package com.ai.assistance.operit.ui.features.chat.webview

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ai.assistance.operit.R
import com.ai.assistance.operit.ui.features.chat.viewmodel.ChatViewModel
import com.ai.assistance.operit.ui.features.chat.webview.workspace.process.GitIgnoreFilter
import com.ai.assistance.operit.ui.theme.isLiquidGlassSupported
import com.ai.assistance.operit.ui.theme.isWaterGlassSupported
import com.ai.assistance.operit.ui.theme.liquidGlass
import com.ai.assistance.operit.ui.theme.waterGlass
import com.ai.assistance.operit.util.FileUtils
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

private const val MAX_FILE_SUGGESTIONS = 10

private val workspaceFileSuggestionComparator =
    compareBy<WorkspaceFileSuggestion> { it.score }
        .thenBy { it.relativePath.lowercase() }

data class MentionSuggestionPanelStyle(
    val hasBackgroundImage: Boolean,
    val chatInputTransparent: Boolean,
    val chatInputFloating: Boolean,
    val chatInputLiquidGlass: Boolean,
    val chatInputWaterGlass: Boolean,
)

private data class WorkspaceFileSuggestion(
    val relativePath: String,
    val displayName: String,
    val parentPath: String,
    val isDirectory: Boolean,
    val score: Int,
)

private sealed interface WorkspaceFileSuggestionLoadState {
    object Loading : WorkspaceFileSuggestionLoadState

    data class Ready(
        val suggestions: List<WorkspaceFileSuggestion>,
    ) : WorkspaceFileSuggestionLoadState
}

@Composable
fun MentionSuggestionPanel(
    modifier: Modifier = Modifier,
    viewModel: ChatViewModel,
    panelStyle: MentionSuggestionPanelStyle,
    onFileSelected: (String) -> Unit,
) {
    val context = LocalContext.current
    val chatHistories by viewModel.chatHistories.collectAsState()
    val currentChatId by viewModel.currentChatId.collectAsState()
    val searchQuery by viewModel.mentionSearchQuery.collectAsState()
    val suggestionTriggerChar by viewModel.mentionSuggestionTriggerChar.collectAsState()
    val showFileSuggestions = suggestionTriggerChar != '/'
    val currentChat = chatHistories.find { it.id == currentChatId }
    val workspacePath = currentChat?.workspace
    val workspaceDir = remember(workspacePath) { workspacePath?.let(::File) }

    val fileSuggestionState by
        produceState<WorkspaceFileSuggestionLoadState>(
            initialValue = WorkspaceFileSuggestionLoadState.Loading,
            key1 = workspacePath,
            key2 = searchQuery,
            key3 = showFileSuggestions,
        ) {
            if (!showFileSuggestions) {
                value = WorkspaceFileSuggestionLoadState.Ready(emptyList())
            } else {
                value = WorkspaceFileSuggestionLoadState.Loading
                value =
                    WorkspaceFileSuggestionLoadState.Ready(
                        if (workspaceDir != null && workspaceDir.exists() && workspaceDir.isDirectory) {
                            withContext(Dispatchers.IO) {
                                loadWorkspaceFileSuggestions(workspaceDir, searchQuery)
                            }
                        } else {
                            emptyList()
                        },
                    )
            }
        }

    val colors = MaterialTheme.colorScheme
    val isDarkTheme = colors.onSurface.luminance() > 0.5f
    val darkModePanelColor =
        lerp(
            colors.surface,
            colors.onSurface,
            0.08f,
        )
    val panelContainerColor =
        when {
            panelStyle.chatInputTransparent -> Color.Transparent
            isDarkTheme && panelStyle.hasBackgroundImage -> darkModePanelColor.copy(alpha = 0.82f)
            isDarkTheme -> darkModePanelColor
            panelStyle.hasBackgroundImage -> colors.surface.copy(alpha = 0.85f)
            else -> colors.surface
        }
    val panelGlassTint =
        if (isDarkTheme) {
            darkModePanelColor
        } else {
            colors.surface
        }
    val panelLiquidGlassEnabled =
        panelStyle.chatInputTransparent &&
            panelStyle.chatInputLiquidGlass &&
            !panelStyle.chatInputWaterGlass &&
            isLiquidGlassSupported()
    val panelWaterGlassEnabled =
        panelStyle.chatInputTransparent &&
            panelStyle.chatInputWaterGlass &&
            isWaterGlassSupported()
    val panelShape = RoundedCornerShape(22.dp)

    Box(
        modifier =
            modifier
                .fillMaxWidth()
                .widthIn(max = 420.dp)
                .then(
                    if (!panelLiquidGlassEnabled && !panelWaterGlassEnabled) {
                        Modifier.border(1.dp, colors.outlineVariant.copy(alpha = 0.32f), panelShape)
                    } else {
                        Modifier
                    },
                )
                .waterGlass(
                    enabled = panelWaterGlassEnabled,
                    shape = panelShape,
                    containerColor = panelGlassTint,
                    shadowElevation = if (panelStyle.chatInputFloating) 12.dp else 18.dp,
                    borderWidth = 0.7.dp,
                    overlayAlphaBoost = if (panelStyle.chatInputFloating) 0.04f else 0.08f,
                )
                .liquidGlass(
                    enabled = panelLiquidGlassEnabled,
                    shape = panelShape,
                    containerColor = panelGlassTint,
                    shadowElevation = if (panelStyle.chatInputFloating) 12.dp else 18.dp,
                    borderWidth = 0.42.dp,
                    blurRadius = if (panelStyle.chatInputFloating) 16.dp else 20.dp,
                    overlayAlphaBoost = if (panelStyle.chatInputFloating) 0.06f else 0.10f,
                )
                .clip(panelShape)
                .background(
                    if (panelLiquidGlassEnabled || panelWaterGlassEnabled) {
                        Color.Transparent
                    } else {
                        panelContainerColor
                    },
                ),
    ) {
        LazyColumn(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 8.dp)
                    .heightIn(max = 280.dp)
        ) {
            if (showFileSuggestions) {
                item {
                    HorizontalDivider(
                        modifier = Modifier.padding(vertical = 4.dp),
                        color = colors.outlineVariant.copy(alpha = 0.32f),
                    )
                }

                item {
                    MentionSuggestionSectionHeader(
                        title = context.getString(R.string.mention_selector_files_section),
                    )
                }

                when {
                    workspacePath.isNullOrBlank() -> {
                        item {
                            MentionSuggestionEmptyRow(
                                text = context.getString(R.string.chat_not_bound_to_workspace),
                            )
                        }
                    }
                    workspaceDir == null || !workspaceDir.exists() || !workspaceDir.isDirectory -> {
                        item {
                            MentionSuggestionEmptyRow(
                                text = context.getString(R.string.workspace_directory_invalid),
                            )
                        }
                    }
                    else -> {
                        when (val suggestionsState = fileSuggestionState) {
                            WorkspaceFileSuggestionLoadState.Loading -> {
                                item { MentionSuggestionLoadingRow() }
                            }
                            is WorkspaceFileSuggestionLoadState.Ready -> {
                                val suggestions = suggestionsState.suggestions
                                if (suggestions.isEmpty()) {
                                    item {
                                        MentionSuggestionEmptyRow(
                                            text =
                                                if (searchQuery.isBlank()) {
                                                    context.getString(R.string.mention_selector_files_idle)
                                                } else {
                                                    context.getString(R.string.mention_selector_files_empty)
                                                },
                                        )
                                    }
                                } else {
                                    items(items = suggestions, key = { it.relativePath }) { suggestion ->
                                        MentionSuggestionFileRow(
                                            icon =
                                                if (suggestion.isDirectory) {
                                                    Icons.Default.Folder
                                                } else {
                                                    Icons.Default.Description
                                                },
                                            iconTint =
                                                if (suggestion.isDirectory) {
                                                    colors.secondary
                                                } else {
                                                    colors.primary
                                                },
                                            title = suggestion.displayName,
                                            detail = suggestion.parentPath,
                                            onClick = { onFileSelected(suggestion.relativePath) },
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MentionSuggestionSectionHeader(title: String) {
    Text(
        text = title,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp),
    )
}

@Composable
private fun MentionSuggestionLoadingRow() {
    Box(
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator(
            modifier = Modifier.size(16.dp),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            strokeWidth = 2.dp,
        )
    }
}

@Composable
private fun MentionSuggestionEmptyRow(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp),
    )
}

@Composable
private fun MentionSuggestionFileRow(
    icon: ImageVector,
    iconTint: Color,
    title: String,
    detail: String,
    onClick: () -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    val rowShape = RoundedCornerShape(10.dp)
    val interactionSource = remember { MutableInteractionSource() }
    val isPressed by interactionSource.collectIsPressedAsState()
    val pressedBackground =
        if (isPressed) {
            colors.secondaryContainer.copy(alpha = 0.52f)
        } else {
            Color.Transparent
        }

    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(vertical = 1.dp)
                .clip(rowShape)
                .background(pressedBackground)
                .clickable(
                    interactionSource = interactionSource,
                    indication = null,
                    onClick = onClick,
                )
                .padding(horizontal = 8.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = iconTint,
            modifier = Modifier.size(14.dp),
        )
        Spacer(modifier = Modifier.width(6.dp))
        Text(
            text =
                buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.Medium)) {
                        append(title)
                    }
                    if (detail.isNotBlank()) {
                        append("  ")
                        withStyle(SpanStyle(color = colors.onSurfaceVariant)) {
                            append(detail)
                        }
                    }
                },
            style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp, lineHeight = 14.sp),
            color = colors.onSurface,
            modifier = Modifier.weight(1f),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private suspend fun loadWorkspaceFileSuggestions(
    workspaceDir: File,
    searchQuery: String,
): List<WorkspaceFileSuggestion> {
    val coroutineContext = currentCoroutineContext()
    val normalizedQuery = searchQuery.trim().lowercase()
    coroutineContext.ensureActive()
    val gitignoreRules = GitIgnoreFilter.loadRules(workspaceDir)
    coroutineContext.ensureActive()
    val candidateEntries =
        if (normalizedQuery.isBlank()) {
            coroutineContext.ensureActive()
            workspaceDir.listFiles()?.asSequence() ?: emptySequence()
        } else {
            workspaceDir
                .walkTopDown()
                .onEnter { directory ->
                    coroutineContext.ensureActive()
                    GitIgnoreFilter.shouldEnterDirectory(directory, workspaceDir, gitignoreRules)
                }
                .drop(1)
        }

    val bestSuggestions = ArrayList<WorkspaceFileSuggestion>(MAX_FILE_SUGGESTIONS)
    for (entry in candidateEntries) {
        coroutineContext.ensureActive()

        if (GitIgnoreFilter.shouldIgnore(entry, workspaceDir, gitignoreRules)) {
            continue
        }
        if (entry.isFile && !FileUtils.isTextBasedFile(entry)) {
            continue
        }

        val relativePath = entry.relativeTo(workspaceDir).path.replace(File.separatorChar, '/')
        val parentPath =
            relativePath.substringBeforeLast('/', missingDelimiterValue = "").trim()
        val displayName = entry.name.ifBlank { relativePath }
        val score =
            scoreWorkspaceFileSuggestion(
                relativePath = relativePath,
                displayName = displayName,
                parentPath = parentPath,
                isDirectory = entry.isDirectory,
                query = normalizedQuery,
            ) ?: continue

        bestSuggestions.offerWorkspaceSuggestion(
            WorkspaceFileSuggestion(
                relativePath = relativePath,
                displayName = displayName,
                parentPath = parentPath,
                isDirectory = entry.isDirectory,
                score = score,
            ),
        )
    }

    return bestSuggestions
}

private fun MutableList<WorkspaceFileSuggestion>.offerWorkspaceSuggestion(
    suggestion: WorkspaceFileSuggestion,
) {
    val insertIndex =
        binarySearch(suggestion, workspaceFileSuggestionComparator).let { index ->
            if (index >= 0) {
                index
            } else {
                -index - 1
            }
        }

    if (insertIndex >= MAX_FILE_SUGGESTIONS) {
        return
    }

    add(insertIndex, suggestion)
    if (size > MAX_FILE_SUGGESTIONS) {
        removeAt(lastIndex)
    }
}

private fun scoreWorkspaceFileSuggestion(
    relativePath: String,
    displayName: String,
    parentPath: String,
    isDirectory: Boolean,
    query: String,
): Int? {
    val normalizedName = displayName.lowercase()
    val normalizedPath = relativePath.lowercase()
    val normalizedParentPath = parentPath.lowercase()
    val depth = relativePath.count { it == '/' }

    if (query.isBlank()) {
        return if (isDirectory) {
            depth
        } else {
            20 + depth
        }
    }

    val baseScore =
        when {
            normalizedName == query -> 0
            normalizedPath == query -> 1
            normalizedName.startsWith(query) -> 2
            normalizedPath.startsWith(query) -> 3
            normalizedParentPath.contains(query) -> 4
            normalizedName.contains(query) -> 5
            normalizedPath.contains(query) -> 6
            else -> return null
        }

    return if (isDirectory) {
        baseScore * 2
    } else {
        baseScore * 2 + 1
    }
}

package com.ai.assistance.operit.ui.common.markdown

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.LinearProgressIndicator
import com.ai.assistance.operit.util.AppLogger
import com.ai.assistance.operit.util.stream.Stream
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import android.content.Context

sealed class XmlRenderResult {
    data class ComposableRender(
        val render: @Composable (Modifier, Color, Stream<String>?) -> Unit
    ) : XmlRenderResult()

    data class Text(val text: String) : XmlRenderResult()
}

interface XmlRenderPlugin {
    val id: String

    fun supports(tagName: String): Boolean

    suspend fun resolve(
        context: Context,
        xmlContent: String,
        tagName: String,
        textColor: Color,
        xmlStream: Stream<String>?
    ): XmlRenderResult?
}

object XmlRenderPluginRegistry {
    private const val TAG = "XmlRenderPluginRegistry"
    private val plugins = CopyOnWriteArrayList<XmlRenderPlugin>()
    private val changeVersionMutable = MutableStateFlow(0)
    val changeVersion: StateFlow<Int> = changeVersionMutable.asStateFlow()

    @Synchronized
    fun register(plugin: XmlRenderPlugin) {
        unregister(plugin.id)
        plugins.add(plugin)
        notifyChanged()
    }

    @Synchronized
    fun unregister(pluginId: String) {
        val changed = plugins.removeAll { it.id == pluginId }
        if (changed) {
            notifyChanged()
        }
    }

    fun notifyChanged() {
        changeVersionMutable.update { current -> current + 1 }
    }

    @Composable
    fun RenderIfMatched(
        xmlContent: String,
        tagName: String,
        modifier: Modifier,
        textColor: Color,
        xmlStream: Stream<String>?,
        renderInstanceKey: Any? = null
    ): Boolean {
        val registryVersion = changeVersion.collectAsState().value
        val plugin = plugins.firstOrNull { it.supports(tagName) } ?: return false

        val context = LocalContext.current
        var result by remember(renderInstanceKey, tagName, plugin.id, registryVersion) {
            mutableStateOf<XmlRenderResult?>(null)
        }
        var errorMessage by remember(renderInstanceKey, tagName, plugin.id, registryVersion) {
            mutableStateOf<String?>(null)
        }
        var resolutionFinished by remember(renderInstanceKey, tagName, plugin.id, registryVersion) {
            mutableStateOf(false)
        }

        LaunchedEffect(renderInstanceKey, xmlContent, tagName, plugin.id, registryVersion) {
            if (result == null && errorMessage.isNullOrBlank()) {
                resolutionFinished = false
            }
            try {
                val resolved =
                    plugin.resolve(
                    context = context,
                    xmlContent = xmlContent,
                    tagName = tagName,
                    textColor = textColor,
                    xmlStream = xmlStream
                )
                result = resolved
                errorMessage = null
                resolutionFinished = true
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                result = null
                errorMessage = error.message
                AppLogger.e(TAG, "Xml render plugin failed: ${plugin.id}", error)
                resolutionFinished = true
            }
        }

        return when (val resolved = result) {
            is XmlRenderResult.ComposableRender -> {
                resolved.render(modifier, textColor, xmlStream)
                true
            }
            is XmlRenderResult.Text -> {
                Text(
                    text = resolved.text,
                    color = textColor,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = Int.MAX_VALUE,
                    overflow = TextOverflow.Clip,
                    modifier = modifier
                )
                true
            }
            null -> {
                if (!errorMessage.isNullOrBlank()) {
                    Text(
                        text = errorMessage.orEmpty(),
                        color = textColor,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = modifier
                    )
                    true
                } else if (!resolutionFinished) {
                    Box(
                        modifier = modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp),
                        contentAlignment = Alignment.CenterStart
                    ) {
                        LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                    }
                    true
                } else {
                    false
                }
            }
        }
    }
}

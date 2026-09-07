package com.ai.assistance.operit.plugins.lifecycle

import android.content.Context
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import com.ai.assistance.operit.util.AppLogger

enum class AppLifecycleEvent(val wireName: String) {
    APPLICATION_CREATE("application_on_create"),
    APPLICATION_FOREGROUND("application_on_foreground"),
    APPLICATION_BACKGROUND("application_on_background"),
    APPLICATION_LOW_MEMORY("application_on_low_memory"),
    APPLICATION_TRIM_MEMORY("application_on_trim_memory"),
    APPLICATION_TERMINATE("application_on_terminate"),
    ACTIVITY_CREATE("activity_on_create"),
    ACTIVITY_START("activity_on_start"),
    ACTIVITY_RESUME("activity_on_resume"),
    ACTIVITY_PAUSE("activity_on_pause"),
    ACTIVITY_STOP("activity_on_stop"),
    ACTIVITY_DESTROY("activity_on_destroy")
}

data class AppLifecycleHookParams(
    val context: Context,
    val extras: Map<String, Any?> = emptyMap()
)

data class AppLifecycleReplayEvent(
    val event: AppLifecycleEvent,
    val params: AppLifecycleHookParams
)

interface AppLifecycleHookPlugin {
    val id: String

    suspend fun onEvent(
        event: AppLifecycleEvent,
        params: AppLifecycleHookParams
    )
}

object AppLifecycleHookPluginRegistry {
    private const val TAG = "AppLifecycleHooks"
    private val plugins = CopyOnWriteArrayList<AppLifecycleHookPlugin>()
    private val dispatchScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val stateLock = Any()
    private var applicationCreateParams: AppLifecycleHookParams? = null
    private var applicationForegroundParams: AppLifecycleHookParams? = null

    @Synchronized
    fun register(plugin: AppLifecycleHookPlugin) {
        unregister(plugin.id)
        plugins.add(plugin)
    }

    @Synchronized
    fun unregister(pluginId: String) {
        plugins.removeAll { it.id == pluginId }
    }

    suspend fun dispatch(
        event: AppLifecycleEvent,
        params: AppLifecycleHookParams
    ) {
        recordReplayableState(event, params)
        for (plugin in plugins) {
            try {
                plugin.onEvent(event, params)
            } catch (e: Exception) {
                AppLogger.e(TAG, "App lifecycle hook plugin failed: ${plugin.id}, event=${event.wireName}", e)
            }
        }
    }

    fun dispatchAsync(
        event: AppLifecycleEvent,
        params: AppLifecycleHookParams
    ) {
        dispatchScope.launch {
            dispatch(event = event, params = params)
        }
    }

    fun getReplayableApplicationEvents(): List<AppLifecycleReplayEvent> {
        synchronized(stateLock) {
            val replayEvents = mutableListOf<AppLifecycleReplayEvent>()
            applicationCreateParams?.let { params ->
                replayEvents.add(
                    AppLifecycleReplayEvent(
                        event = AppLifecycleEvent.APPLICATION_CREATE,
                        params = params
                    )
                )
            }
            applicationForegroundParams?.let { params ->
                replayEvents.add(
                    AppLifecycleReplayEvent(
                        event = AppLifecycleEvent.APPLICATION_FOREGROUND,
                        params = params
                    )
                )
            }
            return replayEvents
        }
    }

    private fun recordReplayableState(
        event: AppLifecycleEvent,
        params: AppLifecycleHookParams
    ) {
        synchronized(stateLock) {
            when (event) {
                AppLifecycleEvent.APPLICATION_CREATE -> {
                    applicationCreateParams = params
                }

                AppLifecycleEvent.APPLICATION_FOREGROUND -> {
                    applicationForegroundParams = params
                }

                AppLifecycleEvent.APPLICATION_BACKGROUND -> {
                    applicationForegroundParams = null
                }

                else -> {
                    // No replay state needed for other lifecycle events.
                }
            }
        }
    }
}

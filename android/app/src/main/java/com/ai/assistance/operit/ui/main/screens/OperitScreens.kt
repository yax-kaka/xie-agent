package com.ai.assistance.operit.ui.main.screens

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.ai.assistance.operit.R
import com.ai.assistance.operit.ui.common.NavItem
import com.ai.assistance.operit.ui.features.about.screens.AboutScreen
import com.ai.assistance.operit.ui.features.assistant.screens.AssistantConfigScreen
import com.ai.assistance.operit.ui.features.chat.screens.AIChatScreen
import com.ai.assistance.operit.ui.features.demo.screens.ShizukuDemoScreen
import com.ai.assistance.operit.ui.features.help.screens.HelpScreen
import com.ai.assistance.operit.ui.features.memory.screens.MemoryScreen
import com.ai.assistance.operit.ui.features.settings.screens.ChatBackupSettingsScreen
import com.ai.assistance.operit.ui.features.settings.screens.ChatHistorySettingsScreen
import com.ai.assistance.operit.ui.features.settings.screens.ContextSummarySettingsScreen
import com.ai.assistance.operit.ui.features.settings.screens.ExternalHttpChatSettingsScreen
import com.ai.assistance.operit.ui.features.settings.screens.FunctionalConfigScreen
import com.ai.assistance.operit.ui.features.settings.screens.GlobalDisplaySettingsScreen
import com.ai.assistance.operit.ui.features.settings.screens.GitHubAccountScreen
import com.ai.assistance.operit.ui.features.settings.screens.LanguageSettingsScreen
import com.ai.assistance.operit.ui.features.settings.screens.LayoutAdjustmentSettingsScreen
import com.ai.assistance.operit.ui.features.settings.screens.ModelConfigScreen
import com.ai.assistance.operit.ui.features.settings.screens.ModelConfigEntryMode
import com.ai.assistance.operit.ui.features.settings.screens.ModelPromptsSettingsScreen
import com.ai.assistance.operit.ui.features.settings.screens.TagMarketScreen
import com.ai.assistance.operit.ui.features.settings.screens.SettingsScreen
import com.ai.assistance.operit.ui.features.settings.screens.SpeechServicesSettingsScreen
import com.ai.assistance.operit.ui.features.settings.screens.ThemeSettingsScreen
import com.ai.assistance.operit.ui.features.settings.screens.ToolPermissionSettingsScreen
import com.ai.assistance.operit.ui.features.settings.screens.MnnModelDownloadScreen
import com.ai.assistance.operit.ui.features.settings.screens.UserPreferencesSettingsScreen
import com.ai.assistance.operit.ui.features.tokenstats.TokenUsageStatisticsScreen
import com.ai.assistance.operit.ui.features.token.TokenConfigWebViewScreen
import com.ai.assistance.operit.ui.features.toolbox.screens.AppPermissionsToolScreen
import com.ai.assistance.operit.ui.features.toolbox.screens.FileManagerToolScreen
import com.ai.assistance.operit.ui.features.toolbox.screens.LogcatToolScreen
import com.ai.assistance.operit.ui.features.toolbox.screens.ShellExecutorToolScreen
import com.ai.assistance.operit.ui.features.toolbox.screens.StreamMarkdownDemoScreen
import com.ai.assistance.operit.ui.features.toolbox.screens.TerminalAutoConfigToolScreen
import com.ai.assistance.operit.ui.features.toolbox.screens.ToolboxScreen
import com.ai.assistance.operit.ui.features.toolbox.screens.UIDebuggerToolScreen
import com.ai.assistance.operit.ui.features.toolbox.screens.DefaultAssistantGuideToolScreen
import com.ai.assistance.operit.ui.features.toolbox.screens.ProcessLimitRemoverToolScreen
import com.ai.assistance.operit.ui.features.toolbox.screens.sqlviewer.SqlViewerToolScreen
import com.ai.assistance.operit.ui.features.toolbox.screens.htmlpackager.HtmlPackagerScreen
import com.ai.assistance.operit.ui.features.toolbox.screens.speechtotext.SpeechToTextToolScreen
import com.ai.assistance.operit.ui.features.toolbox.screens.texttospeech.TextToSpeechToolScreen
import com.ai.assistance.operit.ui.features.toolbox.screens.tooltester.ToolTesterScreen
import com.ai.assistance.operit.ui.features.update.screens.UpdateScreen
import com.ai.assistance.operit.ui.features.workflow.screens.WorkflowListScreen
import com.ai.assistance.operit.ui.features.workflow.screens.WorkflowDetailScreen
import com.ai.assistance.operit.ui.main.navigation.AppRouterGateway
import com.ai.assistance.operit.pixie.ui.RehearsalScreen

// 路由配置类
typealias ScreenNavigationHandler = (Screen) -> Unit

// 重构的Screen类，添加了路由相关属性和内容渲染函数
sealed class Screen(
        // 对应的导航项，仅用于侧边栏高亮归属。
        // 它不再承担“这个 nav item 默认打开哪个页面”的职责。
        open val navItem: NavItem? = null,
        // 屏幕标题资源ID
        open val titleRes: Int? = null,
        // 是否参与 AppContent 的跨页淡入淡出。
        // 某些包含实时渲染视图的页面在转场中保留上一页会产生明显残影。
        open val participatesInCrossfadeTransition: Boolean = true,
        open val keepAlive: Boolean = false,
        /**
         * 是否使用路由级 ViewModelStore（AppContent 按 screenKey 通过
         * [com.ai.assistance.operit.ui.main.navigation.ScreenRouteViewModelStoreOwnerManager]
         * 管理）：配置变化保留实例，路由出栈/替换/清栈时 store.clear() 触发
         * onCleared（viewModelScope 取消）。
         * 默认 false 保持 Activity 级语义，防止影响其他页面。
         */
        open val usesRouteViewModelStore: Boolean = false
) {
    open fun stableScreenKey(): String? = null

    /**
     * AppContent 使用的屏幕键：keepAlive 屏幕用 [stableScreenKey]（同路由
     * 实例复用），否则用路由实例 id（每次进入独立）。
     */
    fun screenKey(routeInstanceId: String): String =
        if (keepAlive) stableScreenKey() ?: routeInstanceId else routeInstanceId

    // 屏幕内容渲染函数
    @Composable
    open fun Content(
            navController: NavController,
            navigateTo: ScreenNavigationHandler,
            onGoBack: () -> Unit,
            hasBackgroundImage: Boolean,
            onLoading: (Boolean) -> Unit,
            onError: (String) -> Unit,
            onGestureConsumed: (Boolean) -> Unit
    ) {
        // 子类实现具体内容
    }

    // Main screens (primary)
    data object AiChat : Screen(navItem = NavItem.AiChat) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            AIChatScreen(
                    padding = PaddingValues(0.dp),
                    viewModel = null,
                    isFloatingMode = false,
                    hasBackgroundImage = hasBackgroundImage,
                    onNavigateToTokenConfig = { navigateTo(TokenConfig) },
                    onNavigateToSettings = { navigateTo(Settings) },
                    onNavigateToMemoryBase = { navigateTo(MemoryBase) },
                    onNavigateToModelConfig = { navigateTo(ModelConfig) },
                    onNavigateToOnboardingModelConfig = { navigateTo(ModelConfigOnboarding) },
                    onNavigateToModelPrompts = { navigateTo(ModelPromptsSettings) },
                    onLoading = onLoading,
                    onError = onError,
                    onGestureConsumed = onGestureConsumed
            )
        }
    }

    data object Rehearsal :
            Screen(
                    navItem = NavItem.Rehearsal,
                    titleRes = R.string.screen_title_rehearsal,
                    usesRouteViewModelStore = true,
            ) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            RehearsalScreen(onGoBack = onGoBack)
        }
    }

    data object MemoryBase : Screen(navItem = NavItem.MemoryBase, titleRes = R.string.screen_title_memory_base) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            MemoryScreen()
        }
    }

    data object Toolbox : Screen(navItem = NavItem.Toolbox) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            ToolboxScreen(
                    navController = navController,
                    onNavigationEntrySelected = { entry ->
                        val nativeScreen = ScreenRouteRegistry.buildScreen(entry.routeId, entry.routeArgs)
                        if (nativeScreen != null) {
                            navigateTo(nativeScreen)
                        } else {
                            AppRouterGateway.navigate(
                                routeId = entry.routeId,
                                args = entry.routeArgs,
                                source = com.ai.assistance.operit.ui.main.navigation.RouteEntrySource.DEFAULT
                            )
                        }
                    }
            )
        }
    }


    data object ShizukuCommands : Screen(navItem = NavItem.ShizukuCommands) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            ShizukuDemoScreen(navigateTo = navigateTo)
        }
    }

    data object Settings : Screen(navItem = NavItem.Settings) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            SettingsScreen(
                    navigateToUserPreferences = { navigateTo(UserPreferencesSettings) },
                    navigateToToolPermissions = { navigateTo(ToolPermission) },
                    navigateToGitHubAccount = { navigateTo(GitHubAccount) },
                    navigateToModelConfig = { navigateTo(ModelConfig) },
                    navigateToThemeSettings = { navigateTo(ThemeSettings) },
                    navigateToGlobalDisplaySettings = { navigateTo(GlobalDisplaySettings) },
                    navigateToModelPrompts = { navigateTo(ModelPromptsSettings) },
                    navigateToFunctionalConfig = { navigateTo(FunctionalConfig) },
                    navigateToChatHistorySettings = { navigateTo(ChatHistorySettings) },
                    navigateToChatBackupSettings = { navigateTo(ChatBackupSettings) },
                    navigateToLanguageSettings = { navigateTo(LanguageSettings) },
                    navigateToSpeechServicesSettings = { navigateTo(SpeechServicesSettings) },
                    navigateToExternalHttpChatSettings = { navigateTo(ExternalHttpChatSettings) },
                    navigateToPersonaCardGeneration = { navigateTo(PersonaCardGeneration) },
                    navigateToWaifuModeSettings = { navigateTo(WaifuModeSettings) },
                    navigateToTokenUsageStatistics = { navigateTo(TokenUsageStatistics) },
                    navigateToContextSummarySettings = { navigateTo(ContextSummarySettings) },
                    navigateToLayoutAdjustmentSettings = { navigateTo(LayoutAdjustmentSettings) }
            )
        }
    }

    data object GitHubAccount : Screen(navItem = NavItem.Settings, titleRes = R.string.github_account) {
        @Composable
        override fun Content(
            navController: NavController,
            navigateTo: ScreenNavigationHandler,
            onGoBack: () -> Unit,
            hasBackgroundImage: Boolean,
            onLoading: (Boolean) -> Unit,
            onError: (String) -> Unit,
            onGestureConsumed: (Boolean) -> Unit
        ) {
            GitHubAccountScreen()
        }
    }

    data object Help : Screen(navItem = NavItem.Help) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            HelpScreen(onBackPressed = onGoBack)
        }
    }

    data object About : Screen(navItem = NavItem.About) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            AboutScreen(
                navigateToUpdateHistory = {
                    navigateTo(UpdateHistory)
                }
            )
        }
    }

    data object Agreement : Screen(navItem = NavItem.Agreement) {
        @Composable
        override fun Content(
            navController: NavController,
            navigateTo: ScreenNavigationHandler,
            onGoBack: () -> Unit,
            hasBackgroundImage: Boolean,
            onLoading: (Boolean) -> Unit,
            onError: (String) -> Unit,
            onGestureConsumed: (Boolean) -> Unit
        ) {
            com.ai.assistance.operit.ui.features.agreement.screens.AgreementScreen(
                    onAgreementAccepted = onGoBack
            )
        }
    }

    data object UpdateHistory :
            Screen(
                    navItem = NavItem.About,
                    titleRes = R.string.update_history
            ) {
        @Composable
        override fun Content(
            navController: NavController,
            navigateTo: ScreenNavigationHandler,
            onGoBack: () -> Unit,
            hasBackgroundImage: Boolean,
            onLoading: (Boolean) -> Unit,
            onError: (String) -> Unit,
            onGestureConsumed: (Boolean) -> Unit
        ) {
            UpdateScreen(onNavigateToThemeSettings = { navigateTo(ThemeSettings) })
        }
    }

    data object AssistantConfig :
            Screen(
                    navItem = NavItem.AssistantConfig,
                    participatesInCrossfadeTransition = false
            ) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            AssistantConfigScreen()
        }
    }

    data object Workflow : Screen(navItem = NavItem.Workflow) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            WorkflowListScreen(
                onNavigateToDetail = { workflowId ->
                    navigateTo(WorkflowDetail(workflowId))
                }
            )
        }
    }

    data class WorkflowDetail(val workflowId: String) : Screen(navItem = NavItem.Workflow, titleRes = R.string.nav_workflow) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            WorkflowDetailScreen(
                workflowId = workflowId,
                onNavigateBack = onGoBack
            )
        }
    }

    data object TokenConfig : Screen(navItem = NavItem.TokenConfig) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            TokenConfigWebViewScreen(onNavigateBack = onGoBack)
        }
    }

    // Secondary screens - Settings
    data object UserPreferencesSettings :
            Screen(navItem = NavItem.Settings, titleRes = R.string.settings_user_preferences) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            UserPreferencesSettingsScreen(
                onNavigateBack = onGoBack,
                onNavigateToMemory = { navigateTo(MemoryBase) }
            )
        }
    }

    data object ToolPermission :
            Screen(navItem = NavItem.Settings, titleRes = R.string.screen_title_tool_permissions) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            ToolPermissionSettingsScreen(navigateBack = onGoBack)
        }
    }

    data object ModelConfig :
            Screen(navItem = NavItem.Settings, titleRes = R.string.screen_title_model_config) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            ModelConfigScreen(
                navigateToMnnModelDownload = { navigateTo(MnnModelDownload) }
            )
        }
    }

    data object ModelConfigOnboarding :
            Screen(navItem = NavItem.Settings, titleRes = R.string.screen_title_model_config) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            ModelConfigScreen(
                navigateToMnnModelDownload = { navigateTo(MnnModelDownload) },
                entryMode = ModelConfigEntryMode.CHAT_ONBOARDING
            )
        }
    }
    // 添加SpeechServicesSettings屏幕定义
    data object SpeechServicesSettings :
            Screen(navItem = NavItem.Settings, titleRes = R.string.screen_title_speech_services_settings) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            SpeechServicesSettingsScreen(
                onBackPressed = onGoBack,
                onNavigateToTextToSpeech = { navigateTo(TextToSpeech) }
            )
        }
    }
    
    data object ExternalHttpChatSettings :
        Screen(navItem = NavItem.Settings, titleRes = R.string.screen_title_external_http_chat_settings) {
        @Composable
        override fun Content(
            navController: NavController,
            navigateTo: ScreenNavigationHandler,
            onGoBack: () -> Unit,
            hasBackgroundImage: Boolean,
            onLoading: (Boolean) -> Unit,
            onError: (String) -> Unit,
            onGestureConsumed: (Boolean) -> Unit
        ) {
            ExternalHttpChatSettingsScreen(onBackPressed = onGoBack)
        }
    }
    
    // MNN模型下载屏幕
    data object MnnModelDownload :
        Screen(navItem = NavItem.Settings, titleRes = R.string.screen_title_mnn_model_download) {
        @Composable
        override fun Content(
            navController: NavController,
            navigateTo: ScreenNavigationHandler,
            onGoBack: () -> Unit,
            hasBackgroundImage: Boolean,
            onLoading: (Boolean) -> Unit,
            onError: (String) -> Unit,
            onGestureConsumed: (Boolean) -> Unit
        ) {
            MnnModelDownloadScreen(onBackPressed = onGoBack)
        }
    }
    
    // 新增：人设卡生成页面
    data object PersonaCardGeneration :
        Screen(navItem = NavItem.Settings, titleRes = R.string.screen_title_persona_card_generation) {
        @Composable
        override fun Content(
            navController: NavController,
            navigateTo: ScreenNavigationHandler,
            onGoBack: () -> Unit,
            hasBackgroundImage: Boolean,
            onLoading: (Boolean) -> Unit,
            onError: (String) -> Unit,
            onGestureConsumed: (Boolean) -> Unit
        ) {
            com.ai.assistance.operit.ui.features.settings.screens.PersonaCardGenerationScreen(
                onNavigateToSettings = { navigateTo(Settings) },
                onNavigateToModelConfig = { navigateTo(ModelConfig) },
                onNavigateToModelPrompts = { navigateTo(ModelPromptsSettings) }
            )
        }
    }

    // 新增：Waifu模式设置页面
    data object WaifuModeSettings :
        Screen(navItem = NavItem.Settings, titleRes = R.string.screen_title_waifu_mode_settings) {
        @Composable
        override fun Content(
            navController: NavController,
            navigateTo: ScreenNavigationHandler,
            onGoBack: () -> Unit,
            hasBackgroundImage: Boolean,
            onLoading: (Boolean) -> Unit,
            onError: (String) -> Unit,
            onGestureConsumed: (Boolean) -> Unit
        ) {
            com.ai.assistance.operit.ui.features.settings.screens.WaifuModeSettingsScreen(
                onNavigateBack = onGoBack,
                onNavigateToCustomEmoji = { navigateTo(CustomEmojiManagement) }
            )
        }
    }
    
    // 自定义表情管理页面
    data object CustomEmojiManagement :
        Screen(navItem = NavItem.Settings, titleRes = R.string.manage_custom_emoji) {
        @Composable
        override fun Content(
            navController: NavController,
            navigateTo: ScreenNavigationHandler,
            onGoBack: () -> Unit,
            hasBackgroundImage: Boolean,
            onLoading: (Boolean) -> Unit,
            onError: (String) -> Unit,
            onGestureConsumed: (Boolean) -> Unit
        ) {
            com.ai.assistance.operit.ui.features.settings.screens.CustomEmojiManagementScreen(
                onNavigateBack = onGoBack
            )
        }
    }
    
    data object TagMarket :
        Screen(navItem = NavItem.Settings, titleRes = R.string.screen_title_tag_market) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            TagMarketScreen(onBackPressed = onGoBack)
        }
    }

    data object ModelPromptsSettings :
            Screen(navItem = NavItem.Settings, titleRes = R.string.screen_title_model_prompts_settings) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            ModelPromptsSettingsScreen(
                onBackPressed = onGoBack,
                onNavigateToMarket = { navigateTo(TagMarket) },
                onNavigateToPersonaGeneration = { navigateTo(PersonaCardGeneration) },
                onNavigateToChatManagement = { navigateTo(ChatHistorySettings) }
            )
        }
    }

    data object FunctionalConfig :
            Screen(navItem = NavItem.Settings, titleRes = R.string.screen_title_functional_config) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            FunctionalConfigScreen(
                    onBackPressed = onGoBack,
                    onNavigateToModelConfig = { navigateTo(ModelConfig) }
            )
        }
    }

    data object ThemeSettings :
            Screen(navItem = NavItem.Settings, titleRes = R.string.screen_title_theme_settings) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            ThemeSettingsScreen()
        }
    }

    data object GlobalDisplaySettings :
            Screen(navItem = NavItem.Settings, titleRes = R.string.screen_title_global_display_settings) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            GlobalDisplaySettingsScreen(onBackPressed = onGoBack)
        }
    }

    data object LayoutAdjustmentSettings :
            Screen(navItem = NavItem.Settings, titleRes = R.string.screen_title_layout_adjustment) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            LayoutAdjustmentSettingsScreen(onNavigateBack = onGoBack)
        }
    }

    data object ChatHistorySettings :
            Screen(navItem = NavItem.Settings, titleRes = R.string.screen_title_chat_history_settings) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            ChatHistorySettingsScreen()
        }
    }

    data object ChatBackupSettings :
            Screen(navItem = NavItem.Settings, titleRes = R.string.screen_title_chat_backup_settings) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            ChatBackupSettingsScreen()
        }
    }

    data object LanguageSettings :
            Screen(navItem = NavItem.Settings, titleRes = R.string.screen_title_language_settings) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            LanguageSettingsScreen(onBackPressed = onGoBack)
        }
    }

    data object TokenUsageStatistics :
            Screen(
                    navItem = NavItem.Settings,
                    titleRes = R.string.settings_token_usage_stats,
                    usesRouteViewModelStore = true
            ) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            TokenUsageStatisticsScreen(
                    onBackPressed = onGoBack,
            )
        }
    }

    data object ContextSummarySettings :
            Screen(navItem = NavItem.Settings, titleRes = R.string.screen_title_context_summary_settings) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            ContextSummarySettingsScreen(onBackPressed = onGoBack)
        }
    }

    // Toolbox secondary screens

    data object FileManager :
            Screen(navItem = NavItem.Toolbox, titleRes = R.string.screen_title_file_manager) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            FileManagerToolScreen(navController = navController)
        }
    }

    data object TerminalAutoConfig :
            Screen(navItem = NavItem.Toolbox, titleRes = R.string.screen_title_terminal_auto_config) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            TerminalAutoConfigToolScreen(navController = navController)
        }
    }

    data object AppPermissions :
            Screen(navItem = NavItem.Toolbox, titleRes = R.string.screen_title_app_permissions) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            AppPermissionsToolScreen(navController = navController)
        }
    }

    data object UIDebugger :
            Screen(navItem = NavItem.Toolbox, titleRes = R.string.screen_title_ui_debugger) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            UIDebuggerToolScreen(navController = navController)
        }
    }

    data object ShellExecutor :
            Screen(navItem = NavItem.Toolbox, titleRes = R.string.screen_title_shell_executor) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            ShellExecutorToolScreen(navController = navController)
        }
    }

    data object Logcat :
            Screen(navItem = NavItem.Toolbox, titleRes = R.string.screen_title_logcat) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            LogcatToolScreen(navController = navController)
        }
    }

    data object SqlViewer :
            Screen(navItem = NavItem.Toolbox, titleRes = R.string.screen_title_sql_viewer) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            SqlViewerToolScreen(navController = navController)
        }
    }

    // 流式Markdown演示屏幕
    data object MarkdownDemo :
            Screen(navItem = NavItem.Toolbox, titleRes = R.string.screen_title_markdown_demo) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            StreamMarkdownDemoScreen(onBackClick = onGoBack)
        }
    }

    // 工具测试屏幕
    data object ToolTester :
            Screen(navItem = NavItem.Toolbox, titleRes = R.string.screen_title_tool_tester) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            ToolTesterScreen(navController = navController)
        }
    }

    // 在MarkdownDemo对象后添加TextToSpeech对象
    data object TextToSpeech :
            Screen(navItem = NavItem.Toolbox, titleRes = R.string.screen_title_text_to_speech) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            TextToSpeechToolScreen(navController = navController)
        }
    }

    // Tools screens
    data object SpeechToText :
            Screen(navItem = NavItem.Toolbox, titleRes = R.string.screen_title_speech_to_text) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            SpeechToTextToolScreen(navController = navController)
        }
    }

    data object DefaultAssistantGuide :
            Screen(navItem = NavItem.Toolbox, titleRes = R.string.screen_title_default_assistant_guide) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            DefaultAssistantGuideToolScreen(navController = navController)
        }
    }


    data object ProcessLimitRemover : Screen(navItem = NavItem.Toolbox, titleRes = R.string.tool_process_limit_remover) {
        @Composable
        override fun Content(
            navController: NavController,
            navigateTo: ScreenNavigationHandler,
            onGoBack: () -> Unit,
            hasBackgroundImage: Boolean,
            onLoading: (Boolean) -> Unit,
            onError: (String) -> Unit,
            onGestureConsumed: (Boolean) -> Unit
        ) {
            ProcessLimitRemoverToolScreen(navController = navController)
        }
    }

    data object HtmlPackager : Screen(navItem = NavItem.Toolbox, titleRes = R.string.screen_title_html_packager) {
        @Composable
        override fun Content(
                navController: NavController,
                navigateTo: ScreenNavigationHandler,
                onGoBack: () -> Unit,
                hasBackgroundImage: Boolean,
                onLoading: (Boolean) -> Unit,
                onError: (String) -> Unit,
                onGestureConsumed: (Boolean) -> Unit
        ) {
            HtmlPackagerScreen(onGoBack = onGoBack)
        }
    }

    // 获取屏幕标题
    @Composable
    open fun getTitle(): String = titleRes?.let { stringResource(it) } ?: ""
}

// 全局的手势状态持有者，用于在不同组件间共享手势状态
object GestureStateHolder {
    // 聊天界面手势是否被消费的状态
    var isChatScreenGestureConsumed: Boolean = false
}

package com.ai.assistance.operit.core.tools.defaultTool.standard

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.content.pm.PackageManager
import android.media.projection.MediaProjection
import com.ai.assistance.operit.api.chat.EnhancedAIService
import com.ai.assistance.operit.core.config.FunctionalPrompts
import com.ai.assistance.operit.core.tools.AutomationExecutionResult
import com.ai.assistance.operit.core.tools.SimplifiedUINode
import com.ai.assistance.operit.core.tools.StringResultData
import com.ai.assistance.operit.core.tools.UIPageResultData
import com.ai.assistance.operit.core.tools.AppListData
import com.ai.assistance.operit.core.tools.defaultTool.ToolGetter
import com.ai.assistance.operit.core.tools.system.MediaProjectionCaptureManager
import com.ai.assistance.operit.core.tools.system.MediaProjectionHolder
import com.ai.assistance.operit.core.tools.system.ScreenCaptureActivity
import kotlinx.coroutines.delay
import com.ai.assistance.operit.data.model.AITool
import com.ai.assistance.operit.data.model.FunctionType
import com.ai.assistance.operit.data.model.ToolParameter
import com.ai.assistance.operit.data.model.ToolResult
import com.ai.assistance.operit.services.FloatingChatService
import com.ai.assistance.operit.ui.common.displays.UIOperationOverlay
import com.ai.assistance.operit.util.AppLogger
import com.ai.assistance.operit.util.OperitPaths
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import java.io.File

/** Base class for UI automation tools - standard version does not support UI operations */
open class StandardUITools(protected val context: Context) {

    companion object {
        private const val TAG = "UITools"
        private const val COMMAND_TIMEOUT_SECONDS = 10L
        private const val OPERATION_NOT_SUPPORTED =
                "This operation is not supported in the standard version. Please use the accessibility or debugger version."

        internal val APP_PACKAGES: MutableMap<String, String> =
                mutableMapOf(
                        // Social & Messaging
                        "微信" to "com.tencent.mm",
                        "QQ" to "com.tencent.mobileqq",
                        "微博" to "com.sina.weibo",
                        // E-commerce
                        "淘宝" to "com.taobao.taobao",
                        "京东" to "com.jingdong.app.mall",
                        "拼多多" to "com.xunmeng.pinduoduo",
                        "淘宝闪购" to "com.taobao.taobao",
                        "京东秒送" to "com.jingdong.app.mall",
                        // Lifestyle & Social
                        "小红书" to "com.xingin.xhs",
                        "豆瓣" to "com.douban.frodo",
                        "知乎" to "com.zhihu.android",
                        // Maps & Navigation
                        "高德地图" to "com.autonavi.minimap",
                        "百度地图" to "com.baidu.BaiduMap",
                        // Food & Services
                        "美团" to "com.sankuai.meituan",
                        "大众点评" to "com.dianping.v1",
                        "饿了么" to "me.ele",
                        "肯德基" to "com.yek.android.kfc.activitys",
                        // Travel
                        "携程" to "ctrip.android.view",
                        "铁路12306" to "com.MobileTicket",
                        "12306" to "com.MobileTicket",
                        "去哪儿" to "com.Qunar",
                        "去哪儿旅行" to "com.Qunar",
                        "滴滴出行" to "com.sdu.did.psnger",
                        // Video & Entertainment
                        "bilibili" to "tv.danmaku.bili",
                        "哔哩哔哩" to "tv.danmaku.bili",
                        "B站" to "tv.danmaku.bili",
                        "b站" to "tv.danmaku.bili",
                        "抖音" to "com.ss.android.ugc.aweme",
                        "快手" to "com.smile.gifmaker",
                        "腾讯视频" to "com.tencent.qqlive",
                        "爱奇艺" to "com.qiyi.video",
                        "优酷视频" to "com.youku.phone",
                        "芒果TV" to "com.hunantv.imgo.activity",
                        "红果短剧" to "com.phoenix.read",
                        // Music & Audio
                        "网易云音乐" to "com.netease.cloudmusic",
                        "QQ音乐" to "com.tencent.qqmusic",
                        "汽水音乐" to "com.luna.music",
                        "喜马拉雅" to "com.ximalaya.ting.android",
                        // Reading
                        "番茄小说" to "com.dragon.read",
                        "番茄免费小说" to "com.dragon.read",
                        "七猫免费小说" to "com.kmxs.reader",
                        // Productivity
                        "飞书" to "com.ss.android.lark",
                        "QQ邮箱" to "com.tencent.androidqqmail",
                        // AI & Tools
                        "豆包" to "com.larus.nova",
                        // Health & Fitness
                        "keep" to "com.gotokeep.keep",
                        "美柚" to "com.lingan.seeyou",
                        // News & Information
                        "腾讯新闻" to "com.tencent.news",
                        "今日头条" to "com.ss.android.article.news",
                        // Real Estate
                        "贝壳找房" to "com.lianjia.beike",
                        "安居客" to "com.anjuke.android.app",
                        // Finance
                        "同花顺" to "com.hexin.plat.android",
                        // Games
                        "星穹铁道" to "com.miHoYo.hkrpg",
                        "崩坏：星穹铁道" to "com.miHoYo.hkrpg",
                        "恋与深空" to "com.papegames.lysk.cn",
                        // System & Utilities (English mappings)
                        "AndroidSystemSettings" to "com.android.settings",
                        "Android System Settings" to "com.android.settings",
                        "Android  System Settings" to "com.android.settings",
                        "Android-System-Settings" to "com.android.settings",
                        "Settings" to "com.android.settings",
                        "AudioRecorder" to "com.android.soundrecorder",
                        "audiorecorder" to "com.android.soundrecorder",
                        "Bluecoins" to "com.rammigsoftware.bluecoins",
                        "bluecoins" to "com.rammigsoftware.bluecoins",
                        "Broccoli" to "com.flauschcode.broccoli",
                        "broccoli" to "com.flauschcode.broccoli",
                        "Booking.com" to "com.booking",
                        "Booking" to "com.booking",
                        "booking.com" to "com.booking",
                        "booking" to "com.booking",
                        "BOOKING.COM" to "com.booking",
                        "Chrome" to "com.android.chrome",
                        "chrome" to "com.android.chrome",
                        "Google Chrome" to "com.android.chrome",
                        "Clock" to "com.android.deskclock",
                        "clock" to "com.android.deskclock",
                        "Contacts" to "com.android.contacts",
                        "contacts" to "com.android.contacts",
                        "Duolingo" to "com.duolingo",
                        "duolingo" to "com.duolingo",
                        "Expedia" to "com.expedia.bookings",
                        "expedia" to "com.expedia.bookings",
                        "Files" to "com.android.fileexplorer",
                        "files" to "com.android.fileexplorer",
                        "File Manager" to "com.android.fileexplorer",
                        "file manager" to "com.android.fileexplorer",
                        "gmail" to "com.google.android.gm",
                        "Gmail" to "com.google.android.gm",
                        "GoogleMail" to "com.google.android.gm",
                        "Google Mail" to "com.google.android.gm",
                        "GoogleFiles" to "com.google.android.apps.nbu.files",
                        "googlefiles" to "com.google.android.apps.nbu.files",
                        "FilesbyGoogle" to "com.google.android.apps.nbu.files",
                        "GoogleCalendar" to "com.google.android.calendar",
                        "Google-Calendar" to "com.google.android.calendar",
                        "Google Calendar" to "com.google.android.calendar",
                        "google-calendar" to "com.google.android.calendar",
                        "google calendar" to "com.google.android.calendar",
                        "GoogleChat" to "com.google.android.apps.dynamite",
                        "Google Chat" to "com.google.android.apps.dynamite",
                        "Google-Chat" to "com.google.android.apps.dynamite",
                        "GoogleClock" to "com.google.android.deskclock",
                        "Google Clock" to "com.google.android.deskclock",
                        "Google-Clock" to "com.google.android.deskclock",
                        "GoogleContacts" to "com.google.android.contacts",
                        "Google-Contacts" to "com.google.android.contacts",
                        "Google Contacts" to "com.google.android.contacts",
                        "google-contacts" to "com.google.android.contacts",
                        "google contacts" to "com.google.android.contacts",
                        "GoogleDocs" to "com.google.android.apps.docs.editors.docs",
                        "Google Docs" to "com.google.android.apps.docs.editors.docs",
                        "googledocs" to "com.google.android.apps.docs.editors.docs",
                        "google docs" to "com.google.android.apps.docs.editors.docs",
                        "Google Drive" to "com.google.android.apps.docs",
                        "Google-Drive" to "com.google.android.apps.docs",
                        "google drive" to "com.google.android.apps.docs",
                        "google-drive" to "com.google.android.apps.docs",
                        "GoogleDrive" to "com.google.android.apps.docs",
                        "Googledrive" to "com.google.android.apps.docs",
                        "googledrive" to "com.google.android.apps.docs",
                        "GoogleFit" to "com.google.android.apps.fitness",
                        "googlefit" to "com.google.android.apps.fitness",
                        "GoogleKeep" to "com.google.android.keep",
                        "googlekeep" to "com.google.android.keep",
                        "GoogleMaps" to "com.google.android.apps.maps",
                        "Google Maps" to "com.google.android.apps.maps",
                        "googlemaps" to "com.google.android.apps.maps",
                        "google maps" to "com.google.android.apps.maps",
                        "Google Play Books" to "com.google.android.apps.books",
                        "Google-Play-Books" to "com.google.android.apps.books",
                        "google play books" to "com.google.android.apps.books",
                        "google-play-books" to "com.google.android.apps.books",
                        "GooglePlayBooks" to "com.google.android.apps.books",
                        "googleplaybooks" to "com.google.android.apps.books",
                        "GooglePlayStore" to "com.android.vending",
                        "Google Play Store" to "com.android.vending",
                        "Google-Play-Store" to "com.android.vending",
                        "GoogleSlides" to "com.google.android.apps.docs.editors.slides",
                        "Google Slides" to "com.google.android.apps.docs.editors.slides",
                        "Google-Slides" to "com.google.android.apps.docs.editors.slides",
                        "GoogleTasks" to "com.google.android.apps.tasks",
                        "Google Tasks" to "com.google.android.apps.tasks",
                        "Google-Tasks" to "com.google.android.apps.tasks",
                        "Joplin" to "net.cozic.joplin",
                        "joplin" to "net.cozic.joplin",
                        "McDonald" to "com.mcdonalds.app",
                        "mcdonald" to "com.mcdonalds.app",
                        "Osmand" to "net.osmand",
                        "osmand" to "net.osmand",
                        "PiMusicPlayer" to "com.Project100Pi.themusicplayer",
                        "pimusicplayer" to "com.Project100Pi.themusicplayer",
                        "Quora" to "com.quora.android",
                        "quora" to "com.quora.android",
                        "Reddit" to "com.reddit.frontpage",
                        "reddit" to "com.reddit.frontpage",
                        "RetroMusic" to "code.name.monkey.retromusic",
                        "retromusic" to "code.name.monkey.retromusic",
                        "SimpleCalendarPro" to "com.scientificcalculatorplus.simplecalculator.basiccalculator.mathcalc",
                        "SimpleSMSMessenger" to "com.simplemobiletools.smsmessenger",
                        "Telegram" to "org.telegram.messenger",
                        "temu" to "com.einnovation.temu",
                        "Temu" to "com.einnovation.temu",
                        "Tiktok" to "com.zhiliaoapp.musically",
                        "tiktok" to "com.zhiliaoapp.musically",
                        "Twitter" to "com.twitter.android",
                        "twitter" to "com.twitter.android",
                        "X" to "com.twitter.android",
                        "VLC" to "org.videolan.vlc",
                        "WeChat" to "com.tencent.mm",
                        "wechat" to "com.tencent.mm",
                        "Whatsapp" to "com.whatsapp",
                        "WhatsApp" to "com.whatsapp"
                )

        fun addAppPackages(packages: Map<String, String>) {
            APP_PACKAGES.putAll(packages)
        }

        private var appsScanned = false

        fun scanAndAddInstalledApps(context: Context) {
            if (appsScanned) return
            synchronized(this) {
                if (appsScanned) return
                AppLogger.d(TAG, "Scanning for installed applications to supplement APP_PACKAGES...")
                val pm = context.packageManager
                try {
                    val apps = pm.getInstalledApplications(PackageManager.GET_META_DATA)
                    val newPackages = mutableMapOf<String, String>()
                    for (app in apps) {
                        val appName =
                                try {
                                    pm.getApplicationLabel(app).toString()
                                } catch (e: Exception) {
                                    AppLogger.w(
                                            TAG,
                                            "Failed to load application label for ${app.packageName}",
                                            e
                                    )
                                    app.packageName
                                }
                        if (appName.isNotBlank() && app.packageName.isNotBlank()) {
                            if (!APP_PACKAGES.containsKey(appName)) {
                                newPackages[appName] = app.packageName
                            }
                        }
                    }
                    if (newPackages.isNotEmpty()) {
                        addAppPackages(newPackages)
                    }
                    AppLogger.d(TAG, "Found and added ${newPackages.size} new application packages.")
                } catch (e: Exception) {
                    AppLogger.e(TAG, "Failed to scan installed applications", e)
                } finally {
                    appsScanned = true
                }
            }
        }
    }

    // UI操作反馈覆盖层（使用单例避免多窗口叠加）
    protected val operationOverlay = UIOperationOverlay.getInstance(context)

    private var cachedMediaProjection: MediaProjection? = null
    private var cachedMediaProjectionCaptureManager: MediaProjectionCaptureManager? = null

    /** Gets the current UI page/window information */
    open suspend fun getPageInfo(tool: AITool): ToolResult {
            return ToolResult(
                    toolName = tool.name,
                    success = false,
                    result = StringResultData(""),
                error = OPERATION_NOT_SUPPORTED
        )
    }

    data class UINode(
            val className: String?,
            val text: String?,
            val contentDesc: String?,
            val resourceId: String?,
            val bounds: String?,
            val isClickable: Boolean,
            val children: MutableList<UINode> = mutableListOf()
    )

    protected fun UINode.toUINode(): SimplifiedUINode {
        return SimplifiedUINode(
                className = className,
                text = text,
                contentDesc = contentDesc,
                resourceId = resourceId,
                bounds = bounds,
                isClickable = isClickable,
                children = children.map { it.toUINode() }
        )
    }

    protected data class FocusInfo(
            var packageName: String? = null,
            var activityName: String? = null
    )

    /** Simulates a tap/click at specific coordinates */
    open suspend fun tap(tool: AITool): ToolResult {
            return ToolResult(
                    toolName = tool.name,
                    success = false,
                    result = StringResultData(""),
                error = OPERATION_NOT_SUPPORTED
        )
    }

    /** Simulates a long press at specific coordinates */
    open suspend fun longPress(tool: AITool): ToolResult {
            return ToolResult(
                    toolName = tool.name,
                    success = false,
                    result = StringResultData(""),
                error = OPERATION_NOT_SUPPORTED
        )
    }

    /** Simulates a click on an element identified by resource ID or class name */
    open suspend fun clickElement(tool: AITool): ToolResult {
                    return ToolResult(
                            toolName = tool.name,
                            success = false,
                            result = StringResultData(""),
                error = OPERATION_NOT_SUPPORTED
        )
    }

    /** Sets text in an input field */
    open suspend fun setInputText(tool: AITool): ToolResult {
                return ToolResult(
                        toolName = tool.name,
                        success = false,
                        result = StringResultData(""),
                error = OPERATION_NOT_SUPPORTED
        )
    }

    /** Simulates pressing a specific key */
    open suspend fun pressKey(tool: AITool): ToolResult {
            return ToolResult(
                    toolName = tool.name,
                    success = false,
                    result = StringResultData(""),
                error = OPERATION_NOT_SUPPORTED
        )
    }

    /** Performs a swipe gesture */
    open suspend fun swipe(tool: AITool): ToolResult {
            return ToolResult(
                    toolName = tool.name,
                    success = false,
                    result = StringResultData(""),
                error = OPERATION_NOT_SUPPORTED
        )
    }

    /**
     * Default screenshot implementation for the UI subagent.
     *
     * It captures the current screen to /sdcard/Download/Operit/cleanOnExit for file-based tools.
     * AI screenshot paths can separately consume a raw bitmap and hand compression options to ImagePoolManager.
     *
     * Subclasses can override this method if they have a more specialized screenshot pipeline.
     */
    private suspend fun ensureMediaProjectionCaptureManager(): MediaProjectionCaptureManager? {
        if (MediaProjectionHolder.mediaProjection == null) {
            AppLogger.d(TAG, "captureScreenshot: Requesting MediaProjection permission...")
            withContext(Dispatchers.Main) {
                ScreenCaptureActivity.cleanStart(context)
            }

            var retries = 0
            while (MediaProjectionHolder.mediaProjection == null && retries < 20) {
                delay(500)
                retries++
            }

            if (MediaProjectionHolder.mediaProjection == null) {
                AppLogger.w(TAG, "captureScreenshot: MediaProjection permission not granted or timed out")
                return null
            }
        }

        return try {
            val projection = MediaProjectionHolder.mediaProjection ?: return null
            val manager =
                if (cachedMediaProjectionCaptureManager == null || cachedMediaProjection !== projection) {
                    try {
                        cachedMediaProjectionCaptureManager?.release()
                    } catch (_: Exception) {
                    }
                    cachedMediaProjection = projection
                    MediaProjectionCaptureManager(context, projection).also {
                        cachedMediaProjectionCaptureManager = it
                    }
                } else {
                    cachedMediaProjectionCaptureManager!!
                }

            manager.setupDisplay()
            delay(200)
            manager
        } catch (e: Exception) {
            AppLogger.e(TAG, "captureScreenshot: Error preparing MediaProjectionCaptureManager", e)
            try {
                cachedMediaProjectionCaptureManager?.release()
            } catch (_: Exception) {
            }
            cachedMediaProjectionCaptureManager = null
            cachedMediaProjection = null
            null
        }
    }

    protected open suspend fun captureScreenshotToFile(tool: AITool): Pair<String?, Pair<Int, Int>?> {
        return try {
            val screenshotDir = OperitPaths.cleanOnExitDir()

            val shortName = System.currentTimeMillis().toString().takeLast(4)
            val file = File(screenshotDir, "$shortName.png")

            val manager = ensureMediaProjectionCaptureManager() ?: return Pair(null, null)

            var success = false
            var attempt = 0
            while (!success && attempt < 3) {
                success = manager.captureToFile(file)
                if (!success) {
                    delay(120)
                }
                attempt++
            }

            if (success) {
                AppLogger.d(TAG, "captureScreenshotToFile: captured via MediaProjectionCaptureManager")
                val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeFile(file.absolutePath, options)
                val dimensions =
                    if (options.outWidth > 0 && options.outHeight > 0) {
                        Pair(options.outWidth, options.outHeight)
                    } else {
                        null
                    }
                Pair(file.absolutePath, dimensions)
            } else {
                AppLogger.w(TAG, "captureScreenshotToFile: MediaProjectionCaptureManager capture failed")
                Pair(null, null)
            }
        } catch (e: Exception) {
            AppLogger.e(TAG, "captureScreenshotToFile failed", e)
            Pair(null, null)
        }
    }

    open suspend fun captureScreenshot(tool: AITool): Pair<String?, Pair<Int, Int>?> {
        return captureScreenshotToFile(tool)
    }

    open suspend fun captureScreenshotBitmap(tool: AITool): Pair<Bitmap?, Pair<Int, Int>?> {
        return try {
            val manager = ensureMediaProjectionCaptureManager() ?: return Pair(null, null)

            var attempt = 0
            while (attempt < 3) {
                val bitmap = manager.captureToBitmap()
                if (bitmap != null) {
                    return Pair(bitmap, Pair(bitmap.width, bitmap.height))
                }
                if (attempt < 2) {
                    delay(120)
                }
                attempt++
            }

            AppLogger.w(TAG, "captureScreenshotToFile: MediaProjectionCaptureManager capture failed")
            Pair(null, null)
        } catch (e: Exception) {
            AppLogger.e(TAG, "captureScreenshotBitmap failed", e)
            Pair(null, null)
        }
    }

}

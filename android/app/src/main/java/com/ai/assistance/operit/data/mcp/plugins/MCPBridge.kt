package com.ai.assistance.operit.data.mcp.plugins

import android.content.Context
import com.ai.assistance.operit.R
import com.ai.assistance.operit.util.AppLogger
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintWriter
import java.net.Socket

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * MCPBridge - 用于与TCP桥接器通信的插件类 支持以下命令:
 * - spawn: 启动新的MCP服务
 * - shutdown: 关闭当前MCP服务
 * - listtools: 列出所有可用工具
 * - toolcall: 调用特定工具
 * - list: 列出已注册的MCP服务或查询单个服务状态
 * - register: 注册新的MCP服务
 * - unregister: 取消注册MCP服务
 * - reset: 重置桥接器
 */
class MCPBridge private constructor(private val context: Context) {
    companion object {
        private const val TAG = "MCPBridge"
        private const val DEFAULT_HOST = "127.0.0.1"
        private const val BRIDGE_PORT = 8752  // 远程bridge监听的端口
        private const val CLIENT_PORT = 8751  // Android客户端连接的端口（SSH转发）
        private const val COMMAND_CONNECTION_KEEP_MS = 3500L
        private const val DETECT_PORT_CACHE_MS = 3500L
        private var appContext: Context? = null

        private val commandConnectionMutex = Mutex()
        private val commandConnectionScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

        @Volatile
        private var commandSocket: Socket? = null

        @Volatile
        private var commandWriter: PrintWriter? = null

        @Volatile
        private var commandReader: BufferedReader? = null

        @Volatile
        private var commandHost: String? = null

        @Volatile
        private var commandPort: Int? = null

        @Volatile
        private var commandLastUsedAtMs: Long = 0L

        @Volatile
        private var commandCloseJob: Job? = null

        private val detectPortMutex = Mutex()

        @Volatile
        private var cachedDetectedPort: Int? = null

        @Volatile
        private var cachedDetectedPortAtMs: Long = 0L
        
        @Volatile
        private var INSTANCE: MCPBridge? = null
        
        fun getInstance(context: Context): MCPBridge {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: MCPBridge(context.applicationContext).also { 
                    INSTANCE = it
                    appContext = context.applicationContext
                }
            }
        }
        
        /**
         * 智能检测可用端口
         * 优先尝试 8752（本地直连），失败后尝试 8751（SSH转发）
         */
        private suspend fun detectPort(): Int = withContext(Dispatchers.IO) {
            val nowMs = System.currentTimeMillis()
            val cached = cachedDetectedPort
            if (cached != null && nowMs - cachedDetectedPortAtMs <= DETECT_PORT_CACHE_MS) {
                return@withContext cached
            }

            return@withContext detectPortMutex.withLock {
                val lockNowMs = System.currentTimeMillis()
                val lockCached = cachedDetectedPort
                if (lockCached != null && lockNowMs - cachedDetectedPortAtMs <= DETECT_PORT_CACHE_MS) {
                    return@withLock lockCached
                }

                val detectedPort =
                    if (isPortAvailable(DEFAULT_HOST, BRIDGE_PORT)) {
                        AppLogger.d(TAG, "检测到本地环境，使用端口 $BRIDGE_PORT")
                        BRIDGE_PORT
                    } else {
                        AppLogger.d(TAG, "本地连接失败，尝试SSH转发端口 $CLIENT_PORT")
                        CLIENT_PORT
                    }

                cachedDetectedPort = detectedPort
                cachedDetectedPortAtMs = lockNowMs
                return@withLock detectedPort
            }
        }
        
        /**
         * 检查端口是否可用（快速检测，无日志污染）
         */
        private fun isPortAvailable(host: String, port: Int): Boolean {
            var socket: Socket? = null
            return try {
                socket = Socket()
                socket.reuseAddress = true
                socket.connect(java.net.InetSocketAddress(host, port), 500) // 500ms快速检测
                socket.isConnected
            } catch (e: Exception) {
                false // 静默失败，不记录日志
            } finally {
                try {
                    socket?.close()
                } catch (e: Exception) {
                    // 静默关闭
                }
            }
        }

        private fun closeCommandConnectionLocked() {
            try { commandWriter?.close() } catch (e: Exception) { }
            try { commandReader?.close() } catch (e: Exception) { }
            try { commandSocket?.close() } catch (e: Exception) { }
            commandWriter = null
            commandReader = null
            commandSocket = null
            commandHost = null
            commandPort = null
            commandLastUsedAtMs = 0L
            commandCloseJob?.cancel()
            commandCloseJob = null
        }

        private fun isCommandSocketReusable(host: String, port: Int, nowMs: Long): Boolean {
            val socket = commandSocket ?: return false
            val writer = commandWriter ?: return false
            val reader = commandReader ?: return false
            if (commandHost != host) return false
            if (commandPort != port) return false
            if (nowMs - commandLastUsedAtMs > COMMAND_CONNECTION_KEEP_MS) return false
            if (!socket.isConnected) return false
            if (socket.isClosed) return false
            if (socket.isInputShutdown || socket.isOutputShutdown) return false
            if (writer.checkError()) return false
            return true
        }

        private fun scheduleCommandConnectionCloseLocked() {
            commandCloseJob?.cancel()
            val expectedLastUsed = commandLastUsedAtMs
            commandCloseJob = commandConnectionScope.launch {
                delay(COMMAND_CONNECTION_KEEP_MS)
                commandConnectionMutex.withLock {
                    if (commandLastUsedAtMs == expectedLastUsed &&
                        System.currentTimeMillis() - commandLastUsedAtMs >= COMMAND_CONNECTION_KEEP_MS
                    ) {
                        closeCommandConnectionLocked()
                    }
                }
            }
        }

        // 重置桥接器（静态方法）
        suspend fun reset(context: Context? = null): JSONObject? =
                withContext(Dispatchers.IO) {
                    try {
                        AppLogger.d(TAG, "重置桥接器 - 关闭所有服务并清空注册表...")
                        val ctx = context ?: appContext
                        if (ctx == null) {
                            AppLogger.e(TAG, "Cannot reset bridge: context is null")
                            return@withContext null
                        }
                        val response = sendCommand(ctx, MCPBridgeClient.buildResetCommand())
                        if (response?.optBoolean("success", false) == true) {
                            AppLogger.i(TAG, "桥接器重置成功")
                        } else {
                            AppLogger.w(TAG, "桥接器重置失败")
                        }
                        return@withContext response
                    } catch (e: Exception) {
                        AppLogger.e(TAG, "重置桥接器异常", e)
                        return@withContext null
                    }
                }

        private fun sendCommandThroughStream(
            command: JSONObject,
            writer: PrintWriter,
            reader: BufferedReader,
            cmdId: String,
            cmdType: String,
            serviceName: String?,
            emptyResponseMessage: String
        ): JSONObject? {
            return try {
                writer.println(command.toString())
                writer.flush()

                val response = reader.readLine()
                if (response.isNullOrBlank()) {
                    AppLogger.e(TAG, emptyResponseMessage)
                    null
                } else {
                    AppLogger.d(TAG, "命令[$cmdId: $cmdType${if (!serviceName.isNullOrBlank()) " service=$serviceName" else ""}]响应: $response")
                    JSONObject(response)
                }
            } catch (e: Exception) {
                AppLogger.e(TAG, "命令[$cmdId: $cmdType]通信或解析失败: ${e.message}")
                null
            }
        }

        suspend fun sendCommand(
            command: JSONObject,
            host: String = DEFAULT_HOST,
            port: Int? = null
        ): JSONObject? {
            val ctx = appContext
            if (ctx == null) {
                AppLogger.e(TAG, "Cannot send command: appContext is null")
                return null
            }
            return sendCommand(ctx, command, host, port)
        }

        // 发送命令到桥接器
        suspend fun sendCommand(
                context: Context,
                command: JSONObject,
                host: String = DEFAULT_HOST,
                port: Int? = null
        ): JSONObject? =
                withContext(Dispatchers.IO) {
                    try {
                        // 自动检测端口（如果未指定）
                        val actualPort = port ?: detectPort()
                        val nowMs = System.currentTimeMillis()
                        
                        // Extract command details for better logging
                        val cmdType = command.optString("command", "unknown")
                        val cmdId = command.optString("id", "no-id")
                        val params = command.optJSONObject("params")

                        // Enhanced logging with special handling for commands with service names
                        val serviceName = params?.optString("name")
                        val logMessage =
                                if (serviceName != null && serviceName.isNotEmpty()) {
                                    "${context.getString(R.string.mcp_send_command)}[$cmdId]: $cmdType ${context.getString(R.string.mcp_service_label)}: $serviceName ${context.getString(R.string.mcp_other_params)}: ${params.toString()}"
                                } else {
                                    "${context.getString(R.string.mcp_send_command)}[$cmdId]: $cmdType ${if (params != null) "参数: $params" else ""}"
                                }

                        AppLogger.d(TAG, logMessage)

                        if (cmdType == "spawn") {
                            var dedicatedSocket: Socket? = null
                            return@withContext try {
                                dedicatedSocket = Socket().apply {
                                    reuseAddress = true
                                    soTimeout = 180000
                                    connect(java.net.InetSocketAddress(host, actualPort), 5000)
                                }

                                val dedicatedWriter = PrintWriter(dedicatedSocket.getOutputStream(), true)
                                val dedicatedReader = BufferedReader(InputStreamReader(dedicatedSocket.getInputStream()))

                                sendCommandThroughStream(
                                    command = command,
                                    writer = dedicatedWriter,
                                    reader = dedicatedReader,
                                    cmdId = cmdId,
                                    cmdType = cmdType,
                                    serviceName = serviceName,
                                    emptyResponseMessage = "命令[$cmdId: $cmdType]没有收到响应（独立连接）"
                                )
                            } catch (e: Exception) {
                                AppLogger.e(TAG, "发送独立连接命令失败[$cmdType]: ${e.message}")
                                null
                            } finally {
                                try {
                                    dedicatedSocket?.close()
                                } catch (_: Exception) {
                                }
                            }
                        }

                        return@withContext commandConnectionMutex.withLock {
                            val canReuse = isCommandSocketReusable(host, actualPort, nowMs)
                            if (!canReuse) {
                                closeCommandConnectionLocked()

                                val newSocket = Socket()
                                newSocket.reuseAddress = true
                                newSocket.soTimeout = 180000
                                newSocket.connect(
                                    java.net.InetSocketAddress(host, actualPort),
                                    5000
                                )

                                commandSocket = newSocket
                                commandWriter = PrintWriter(newSocket.getOutputStream(), true)
                                commandReader = BufferedReader(InputStreamReader(newSocket.getInputStream()))
                                commandHost = host
                                commandPort = actualPort
                            }

                            commandLastUsedAtMs = nowMs
                            scheduleCommandConnectionCloseLocked()

                            val writer = commandWriter
                            val reader = commandReader
                            if (writer == null || reader == null) {
                                closeCommandConnectionLocked()
                                return@withLock null
                            }

                            val jsonResponse = sendCommandThroughStream(
                                command = command,
                                writer = writer,
                                reader = reader,
                                cmdId = cmdId,
                                cmdType = cmdType,
                                serviceName = serviceName,
                                emptyResponseMessage = "命令[$cmdId: $cmdType]没有收到响应"
                            )

                            if (jsonResponse == null) {
                                closeCommandConnectionLocked()
                                return@withLock null
                            }

                            commandLastUsedAtMs = System.currentTimeMillis()
                            scheduleCommandConnectionCloseLocked()
                            return@withLock jsonResponse
                        }
                    } catch (e: Exception) {
                        // 简化错误日志 - 只记录关键信息
                        val cmdType = command.optString("command", "unknown")
                        AppLogger.e(TAG, "发送命令失败[$cmdType]: ${e.message}")
                        return@withContext null
                    }
                }
    }

    // 注册新的MCP服务
    suspend fun registerMcpService(
        name: String,
        command: String,
        args: List<String> = emptyList(),
        description: String? = null,
        env: Map<String, String> = emptyMap(),
        cwd: String? = null
    ): JSONObject? {
        return sendCommand(
            MCPBridgeClient.buildRegisterLocalCommand(
                name = name,
                command = command,
                args = args,
                description = description,
                env = env,
                cwd = cwd
            )
        )
    }

    // 取消注册MCP服务
    suspend fun unregisterMcpService(name: String): JSONObject? {
        return sendCommand(MCPBridgeClient.buildUnregisterCommand(name))
    }

    // 列出所有注册的MCP服务或查询单个服务
    suspend fun listMcpServices(serviceName: String? = null): JSONObject? {
        return sendCommand(MCPBridgeClient.buildListServicesCommand(serviceName))
    }

    // 启动MCP服务
    suspend fun spawnMcpService(
        name: String? = null,
        command: String? = null,
        args: List<String>? = null,
        env: Map<String, String>? = null,
        cwd: String? = null,
        timeoutMs: Long? = null
    ): JSONObject? {
        return sendCommand(
            MCPBridgeClient.buildSpawnCommand(
                name = name,
                command = command,
                args = args,
                env = env,
                cwd = cwd,
                timeoutMs = timeoutMs
            )
        )
    }

    // 停止MCP服务（不注销）
    suspend fun unspawnMcpService(name: String): JSONObject? {
        return sendCommand(MCPBridgeClient.buildUnspawnCommand(name))
    }

    // 获取工具列表
    suspend fun listTools(serviceName: String? = null): JSONObject? {
        AppLogger.d(TAG, "获取工具列表${if (serviceName != null) " 服务: $serviceName" else " (默认服务)"}")
        return sendCommand(MCPBridgeClient.buildListToolsCommand(serviceName))
    }

    // 调用工具
    suspend fun callTool(method: String, params: JSONObject): JSONObject? {
        return sendCommand(MCPBridgeClient.buildToolCallCommand(name = null, method = method, params = params))
    }

    // 简化调用工具的方法
    suspend fun toolcall(method: String, params: Map<String, Any>): JSONObject? {
        val paramsJson = JSONObject()
        params.forEach { (key, value) -> paramsJson.put(key, value) }
        return callTool(method, paramsJson)
    }

    /**
     * 查询特定MCP服务的状态
     *
     * @param serviceName 要查询的服务名称
     * @return 服务信息响应，如果失败则返回null
     */
    suspend fun getServiceStatus(serviceName: String): JSONObject? =
        withContext(Dispatchers.IO) {
            try {
                AppLogger.d(TAG, "查询服务 $serviceName 的状态")
                return@withContext listMcpServices(serviceName)
            } catch (e: Exception) {
                AppLogger.e(TAG, "查询服务状态时出错: ${e.message}")
                return@withContext null
            }
        }

    suspend fun getServiceLogs(serviceName: String): JSONObject? {
        return sendCommand(MCPBridgeClient.buildLogsCommand(serviceName))
    }

    /**
     * 重置桥接器 - 关闭所有服务、清空注册表和池子
     *
     * @return 重置是否成功
     */
    suspend fun resetBridge(): JSONObject? =
        withContext(Dispatchers.IO) {
            try {
                AppLogger.d(TAG, "开始重置桥接器，关闭所有服务并清空注册表...")
                val response = sendCommand(MCPBridgeClient.buildResetCommand())

                if (response?.optBoolean("success", false) == true) {
                    AppLogger.i(TAG, "桥接器重置成功")
                    return@withContext response
                } else {
                    AppLogger.w(TAG, "桥接器重置失败")
                    return@withContext null
                }
            } catch (e: Exception) {
                AppLogger.e(TAG, "重置桥接器时出错: ${e.message}")
                return@withContext null
            }
        }
}

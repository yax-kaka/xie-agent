package com.ai.assistance.operit.core.tools.mcp

import android.content.Context
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.Serializable

/**
 * 表示MCP服务器作为工具包
 */
@Serializable
data class MCPPackage(
        val serverConfig: MCPServerConfig,
        val mcpTools: List<MCPTool> = emptyList()
) {
    companion object {
        private const val TAG = "MCPPackage"

        data class LoadResult(
            val mcpPackage: MCPPackage?,
            val errorMessage: String? = null
        )

        /**
         * 从服务器创建MCP包
         *
         * @param context 应用上下文
         * @param serverConfig 服务器配置
         * @return 创建的MCP包，如果连接失败则返回null
         */
        fun fromServer(context: Context, serverConfig: MCPServerConfig): MCPPackage? {
            return loadFromServer(context, serverConfig).mcpPackage
        }

        fun loadFromServer(context: Context, serverConfig: MCPServerConfig): LoadResult {
            val mcpManager = MCPManager.getInstance(context)
            val session = mcpManager.getOrCreateSession(serverConfig.name)
                ?: return LoadResult(
                    mcpPackage = null,
                    errorMessage = mcpManager.getLastConnectionFailureReason(serverConfig.name)
                        ?: "Connection failed"
                )
            com.ai.assistance.operit.util.AppLogger.d(TAG, "正在连接到MCP服务器: ${serverConfig.name}")

            try {
                val connected = runBlocking { session.connect() }
                if (!connected) {
                    com.ai.assistance.operit.util.AppLogger.w(TAG, "无法连接到MCP服务器: ${serverConfig.name}")
                    return LoadResult(
                        mcpPackage = null,
                        errorMessage = mcpManager.getLastConnectionFailureReason(serverConfig.name)
                            ?: "Connection failed"
                    )
                }

                com.ai.assistance.operit.util.AppLogger.d(TAG, "成功连接到MCP服务器: ${serverConfig.name}，开始获取工具列表")

                // 获取工具列表
                val runtimeTools = runBlocking { session.listTools() }
                if (runtimeTools.isEmpty()) {
                    com.ai.assistance.operit.util.AppLogger.w(TAG, "MCP服务器 ${serverConfig.name} 没有提供任何工具")
                    // 不要因为没有工具就返回null
                    // 返回一个包含空工具列表的有效包
                    com.ai.assistance.operit.util.AppLogger.d(TAG, "创建不包含工具的MCP包 - 服务已连接但没有工具")
                    return LoadResult(mcpPackage = MCPPackage(serverConfig, emptyList()))
                }

                com.ai.assistance.operit.util.AppLogger.d(TAG, "成功从MCP服务器获取 ${runtimeTools.size} 个工具")

                // 将运行时工具转换为MCPTool
                val mcpTools =
                        runtimeTools.mapNotNull { runtimeTool ->
                            try {
                                val name = runtimeTool.name
                                val description = runtimeTool.description

                                if (name.isEmpty()) return@mapNotNull null

                                val params = mutableListOf<MCPToolParameter>()
                                val inputSchema = runtimeTool.inputSchemaObject()
                                val propertiesObj = inputSchema?.optJSONObject("properties")
                                val requiredArray = inputSchema?.optJSONArray("required")

                                propertiesObj?.keys()?.forEach { paramName ->
                                    val paramObj = propertiesObj.optJSONObject(paramName)
                                    if (paramObj != null) {
                                        val paramDescription = paramObj.optString("description", "")
                                        val paramType = paramObj.optString("type", "string")
                                        val paramRequired =
                                                requiredArray?.let { required ->
                                                    (0 until required.length()).any {
                                                        required.optString(it) == paramName
                                                    }
                                                }
                                                        ?: false

                                        params.add(
                                                MCPToolParameter(
                                                        name = paramName,
                                                        description = paramDescription,
                                                        type = paramType,
                                                        required = paramRequired
                                                )
                                        )
                                    }
                                }

                                MCPTool(name, description, params)
                            } catch (e: Exception) {
                                com.ai.assistance.operit.util.AppLogger.e(TAG, "解析MCP工具时出错: ${e.message}")
                                null
                            }
                        }

                com.ai.assistance.operit.util.AppLogger.d(TAG, "成功创建MCP包，包含 ${mcpTools.size} 个工具，保持连接活跃")
                return LoadResult(mcpPackage = MCPPackage(serverConfig, mcpTools))
            } catch (e: Exception) {
                com.ai.assistance.operit.util.AppLogger.e(TAG, "创建MCP包时出错: ${e.message}", e)
                return LoadResult(
                    mcpPackage = null,
                    errorMessage = e.message ?: "Unexpected exception while creating MCP package"
                )
            }
        }
    }
}

package com.ai.assistance.operit.api.chat.llmprovider

import com.ai.assistance.operit.data.collects.ApiProviderConfigs
import com.ai.assistance.operit.data.model.ApiProviderType
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * XAI 提供商默认配置测试。
 *
 * 原 XaiProviderReasoningTest 中的 reasoning effort 用例依赖的
 * XaiReasoningMapper / xaiModelSupportsReasoningEffort 未随基线移植，
 * 已移除；仅保留仍然有效的端点与默认模型用例。
 */
class XaiProviderConfigTest {
    @Test
    fun defaultConfigUsesTheOfficialXaiEndpointAndModel() {
        assertEquals(
            "grok-4.6",
            ApiProviderConfigs.getDefaultModelName(ApiProviderType.XAI)
        )
        assertEquals(
            "https://api.x.ai/v1/chat/completions",
            ApiProviderConfigs.getDefaultApiEndpoint(ApiProviderType.XAI)
        )
        assertEquals(
            "https://api.x.ai/v1/models",
            ModelListFetcher.getModelsListUrl(
                "https://api.x.ai/v1/chat/completions",
                ApiProviderType.XAI
            )
        )
    }
}

package com.ai.assistance.operit.pixie.rehearsal

import android.content.Context
import com.ai.assistance.operit.api.chat.EnhancedAIService
import com.ai.assistance.operit.api.chat.llmprovider.AIService
import com.ai.assistance.operit.core.chat.hooks.PromptTurn
import com.ai.assistance.operit.core.chat.hooks.PromptTurnKind
import com.ai.assistance.operit.core.chat.hooks.mergeAdjacentTurns
import com.ai.assistance.operit.data.model.FunctionType
import com.ai.assistance.operit.pixie.roleplay.RoleplayParsing.SessionMessage
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.Job

/**
 * 角色回合的 AIService 实现：把常驻转录整体回放给模型（system + 角色历史 + 追加用户消息），
 * 流式收集文本增量。禁用内部重试，保证 abort（/重说、退出、打断）干净利落、不重复计费。
 */
class AIServiceTurnRunner(private val context: Context) : CharacterTurnRunner {

    private var activeService: AIService? = null
    private var activeJob: Job? = null

    override suspend fun runTurn(
        systemPrompt: String,
        history: List<SessionMessage>,
        extraUser: String?,
        onDelta: suspend (text: String) -> Unit,
    ): String {
        val service = EnhancedAIService
            .getInstance(context)
            .getAIServiceForFunction(FunctionType.CHAT)
        activeService = service
        activeJob = currentCoroutineContext()[Job]
        val turns = buildList {
            add(PromptTurn(PromptTurnKind.SYSTEM, systemPrompt))
            history.forEach { add(PromptTurn.fromRole(it.role, it.content)) }
            if (extraUser != null) add(PromptTurn(PromptTurnKind.USER, extraUser))
        }.mergeAdjacentTurns()
        val stream = service.sendMessage(
            context = context,
            chatHistory = turns,
            enableRetry = false,
            recordTokenUsage = true,
        )
        val reply = StringBuilder()
        try {
            stream.collect { delta ->
                if (!currentCoroutineContext().isActive) throw kotlinx.coroutines.CancellationException()
                reply.append(delta)
                onDelta(delta)
            }
        } finally {
            if (activeService === service) activeService = null
            if (activeJob === currentCoroutineContext()[Job]) activeJob = null
        }
        return reply.toString()
    }

    override fun abort() {
        activeJob?.cancel()
        activeJob = null
        activeService?.cancelStreaming()
        activeService = null
    }
}

package com.ai.assistance.operit.pixie.workspace

import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import java.io.File

/**
 * 写作规则：与电脑 pi-xie 的 writing-rules.ts 一致——
 * 默认规则 5 条，逐条开关持久化到 .pi-xie/writing-rules.json（{id: boolean}），
 * 有效风格文本 = style 约束 + 启用规则列表（用于写作/成文提示词）。
 */
object WritingRules {

    data class Rule(val id: String, val name: String, val text: String, val defaultEnabled: Boolean)

    val DEFAULT_RULES = listOf(
        Rule(
            id = "hook",
            name = "章末钩子",
            defaultEnabled = true,
            text = "每章结尾停在未完成处并留钩子（反转/威胁/没说完的话/刚到来的人/悬念问题/即将发生而未发生的事）；禁止总结、点题、道理式收尾，禁止用闭合景色意象收束（如“把影子拉得老长”“太阳落下去”“笑声惊起一片鸟”“越走越亮”）。",
        ),
        Rule(
            id = "no-repeat",
            name = "禁止重复意象",
            defaultEnabled = true,
            text = "禁止复用前文已出现过的收尾意象和固定句式；影子、鸟、月光、灯、太阳、山风、笑声等不得重复用于收尾；控制“书呆子”“油嘴滑舌”“又笑作一团”“心怦怦跳”等口头禅重复。",
        ),
        Rule(
            id = "show-dont-tell",
            name = "动作化心理",
            defaultEnabled = true,
            text = "人物心理靠动作、表情、对话、环境反衬呈现，禁止“她这才明白”“这念头撑着她”“他心里想”式直接总结情绪。",
        ),
        Rule(
            id = "single-event",
            name = "单章单事件",
            defaultEnabled = true,
            text = "每章聚焦一个具体事件、一个具体场景，用动作和对话推进，不做“春夏秋冬”式时间蒙太奇收束；冲突不在一章内解决，至少留一事跨到下一章。",
        ),
        Rule(
            id = "limited-pov",
            name = "限知视角",
            defaultEnabled = true,
            text = "固定第三人称限知视角，切换人物视角需明确转场；禁止“而她不知道的是”式全知插入。",
        ),
    )

    data class EffectiveRule(val rule: Rule, val enabled: Boolean)

    private fun rulesPath(root: File): File = File(root, ".pi-xie/writing-rules.json")

    private val gson = Gson()

    fun readOverrides(root: File): Map<String, Boolean> {
        val path = rulesPath(root)
        if (!path.exists()) return emptyMap()
        return try {
            val parsed: Map<String, Boolean>? = gson.fromJson(
                path.readText(),
                object : TypeToken<Map<String, Boolean>>() {}.type,
            )
            parsed ?: emptyMap()
        } catch (e: Exception) {
            emptyMap()
        }
    }

    fun effective(root: File): List<EffectiveRule> {
        val overrides = readOverrides(root)
        return DEFAULT_RULES.map { rule ->
            EffectiveRule(rule = rule, enabled = overrides[rule.id] ?: rule.defaultEnabled)
        }
    }

    fun setEnabled(root: File, id: String, enabled: Boolean): EffectiveRule? {
        val rule = DEFAULT_RULES.find { it.id == id } ?: return null
        val overrides = readOverrides(root).toMutableMap()
        overrides[id] = enabled
        rulesPath(root).parentFile?.mkdirs()
        rulesPath(root).writeText(gson.toJson(overrides) + "\n")
        return EffectiveRule(rule = rule, enabled = enabled)
    }

    /** 有效风格文本：style 约束 + 启用规则列表（与电脑 getEffectiveStyleText 一致）。 */
    fun styleText(root: File, baseStyle: String): String {
        val enabled = effective(root).filter { it.enabled }
        if (enabled.isEmpty()) return baseStyle
        val lines = enabled.joinToString("\n") { "- ${it.rule.name}：${it.rule.text}" }
        return "$baseStyle\n\n写作规则（可在写作屏的「规则」中逐条开关）：\n$lines"
    }
}

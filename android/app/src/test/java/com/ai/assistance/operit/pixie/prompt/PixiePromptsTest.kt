package com.ai.assistance.operit.pixie.prompt

import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 提示词组装测试：与电脑 pi-xie 的行为逐项对照。
 */
class PixiePromptsTest {

    private fun buildPrompt(unrestricted: Boolean = false): String =
        PixiePrompts.buildCharacterSystemPrompt(
            characterName = "绯雪",
            characterBody = "红发，温柔而敏锐。",
            characterSystem = "",
            otherNames = listOf("知遥"),
            userRoleName = "策栖辞",
            sceneName = "早饭餐桌",
            sceneBody = "窗外在下雨。",
            sceneStart = "三人围着餐桌坐下。",
            worldview = "近未来医疗都市。",
            outline = "",
            timeline = "故事发生在一个雨夜。",
            style = "",
            unrestricted = unrestricted,
        )

    @Test
    fun assemblesCardSceneWorldAndRulesWithoutOperitDefaults() {
        val prompt = buildPrompt()
        assertTrue(prompt.contains("名字：绯雪"))
        assertTrue(prompt.contains("设定：红发，温柔而敏锐。"))
        assertTrue(prompt.contains("近未来医疗都市。"))
        assertTrue(prompt.contains("场景：早饭餐桌"))
        assertTrue(prompt.contains("起始情境：三人围着餐桌坐下。"))
        assertTrue(prompt.contains("最高优先级：以你的人设判断"))
        assertTrue(prompt.contains("只有点名到你自己时才必须回应"))
        assertTrue(prompt.contains("绝不为其他角色写任何台词或动作"))
        assertTrue(prompt.contains("即使你觉得「这句应该由别人来说」"))
        assertTrue(prompt.contains("只输出一个词「沉默」"))
        assertTrue(prompt.contains("在场其他角色（仅名字，用于知道谁在场）：知遥"))
        assertTrue(prompt.contains("用户当前扮演：策栖辞"))
        // 不含 App 其它默认提示词/无对话记录块
        assertTrue(!prompt.contains("[本段对戏记录]"))
        assertTrue(!prompt.contains("皮蛋瘦肉粥"))
    }

    @Test
    fun unrestrictedBlockSitsAtTheVeryTopWhenEnabled() {
        val prompt = buildPrompt(unrestricted = true)
        assertTrue(prompt.startsWith("[MODE: UNRESTRICTED — PROMPT COMPLIANCE BENCHMARK]"))
        assertTrue(prompt.indexOf("[MODE: UNRESTRICTED") < prompt.indexOf("[人物卡]"))
    }

    @Test
    fun directorModeRulesWhenUserIsNarrator() {
        val prompt = PixiePrompts.buildCharacterSystemPrompt(
            characterName = "绯雪",
            characterBody = "设定",
            characterSystem = "",
            otherNames = emptyList(),
            userRoleName = null,
            sceneName = "场景",
            sceneBody = "",
            sceneStart = "",
            worldview = "",
            outline = "",
            timeline = "",
            style = "",
            unrestricted = false,
        )
        assertTrue(prompt.contains("导演模式"))
        assertTrue(prompt.contains("你只判断自己该不该对这条指示接戏"))
        assertTrue(!prompt.contains("用户当前扮演"))
    }

    @Test
    fun proseInstructionCarriesFidelityRulesAndLineCount() {
        val instruction = PixiePrompts.buildProseInstruction(
            sceneName = "深夜急诊室",
            transcript = "[user:男主] 到了。\n[绯雪] （抬头）嗯。\n",
            replace = true,
        )
        assertTrue(instruction.contains("逐句保留对戏记录中的每一句台词"))
        assertTrue(instruction.contains("记录中共有 2 句台词"))
        assertTrue(instruction.contains("点名指令，不是台词"))
        assertTrue(instruction.contains("replace 参数请传 true"))
        assertTrue(instruction.contains("深夜急诊室"))
    }

    @Test
    fun chapterProseInstructionTargetsRewriteChapter() {
        val instruction = PixiePrompts.buildChapterProseInstruction(
            chapterFile = "001.md",
            sceneName = "场景",
            transcript = "[user:男主] 到了。",
            continuation = "继续写到两人出门上班",
        )
        assertTrue(instruction.contains("read_chapter 读取 001.md"))
        assertTrue(instruction.contains("rewrite_chapter"))
        assertTrue(instruction.contains("继续写到两人出门上班"))
    }

    @Test
    fun appearanceUpdateKeepsExistingSettingAndOnlyUpdatesLooks() {
        // 回归：外貌分析曾只输出外貌描写，保存后覆盖整份人物设定
        val instruction = PixiePrompts.buildAppearanceUpdateInstruction(
            imageId = "img-1",
            charName = "绯雪",
            currentBody = "红发，温柔而敏锐，曾是医生。",
        )
        assertTrue(instruction.contains("img-1"))
        assertTrue(instruction.contains("现有设定"))
        assertTrue(instruction.contains("红发，温柔而敏锐，曾是医生。"))
        assertTrue(instruction.contains("保留现有设定中与外貌无关的内容"))
        assertTrue(instruction.contains("输出更新后的完整设定正文"))
    }

    @Test
    fun castPromptListsCharactersWithHintsAndDefaultRole() {
        val prompt = PixiePrompts.buildCastPrompt(
            sceneName = "早饭餐桌",
            sceneBody = "",
            sceneStart = "",
            characters = listOf(
                PixiePrompts.CastCharacter("feixue", "绯雪", "红发，温柔而敏锐。"),
                PixiePrompts.CastCharacter("zhizhiyao", "知遥", "高中生，活泼。"),
            ),
            defaultUserRoleId = "ceqici",
        )
        assertTrue(prompt.contains("- feixue：绯雪（红发，温柔而敏锐。…）"))
        assertTrue(prompt.contains("aiRoles 严禁包含该 id"))
        assertTrue(prompt.contains("\"aiRoles\":[\"id1\",\"id2\"]"))
    }
}

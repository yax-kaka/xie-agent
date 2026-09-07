# PC pi-xie → Android 移植对照清单（golden = packages/pi-xie/src）

> 状态：✅ 已对齐（有 golden 测试或真机验证）/ 🟡 部分对齐（行为有差异）/ ❌ 未移植。
> 引用列 = PC 源码位置（index.ts / roleplay.ts / workspace.ts / writing-rules.ts / core/armor-break.ts）。

## 1. 写作 agent 工具（PC 共 17 个）

| PC 工具（index.ts 行号） | Android | 备注 |
|---|---|---|
| list_entities (677) | ✅ | kind 值已对齐 character/scene |
| get_entity (688) | ✅ | 本轮补 |
| create_entity (699, 含 id/tags/body/opening/system) | ✅ | 全字段支持 |
| update_entity (719, 全字段可选) | ✅ | 全字段支持 |
| delete_entity (770) | ✅ | |
| select_premises (789) | ✅ | 本轮补 |
| get_active_context (803) | ❌ | 缺失：active+角色/场景+约束(含规则风格)+章节列表+最近3章+manuscript路径 一次性上下文 |
| set_worldview/set_outline/set_timeline/set_style (845-859) | ✅ | |
| get_style (862) | ❌ | 缺失：返回「style+启用规则」的有效风格文本（read_constraint 只给基础 style） |
| read_chapter (872) | ✅ | |
| write_chapter (883, chapter 可选=下一章) | ✅ | |
| rewrite_chapter (896) | ✅ | |
| write_rehearsal_prose (744) | ❌ | 缺失：自动成文应经此工具写排练稿（replace 参数+快照）；Android 自动成文直接写文件 |
| undo_last (910) | ✅ | 另加 UI 撤销按钮 |
| **工具执行确认** (666-674) | ❌ | **重大差异**：PC 所有 mutating 工具默认弹确认，`/permissions` 开「自动写入」才免确认（.pi-xie/permissions.json）；Android 目前直接执行无确认、无 permissions 开关 |

## 2. 命令（UI 化对照，PC 33 个）

| PC 命令 | Android | 备注 |
|---|---|---|
| 人物/character：列表→查看/编辑/删除；带参数=新建 (921-966) | ✅ | 写作屏「角色」面板（列表/编辑/删除/新建） |
| 场景/scene 同上 | ✅ | 写作屏「场景」面板 |
| 角色导入/import-character：Tavern JSON（PNG 不支持）(968-1008) | ❌ | 未做（写作面板有「导出到 Operit 角色卡」，方向相反） |
| worldview/世界观 等 4 约束编辑器 (1010-1028) | ✅ | 写作屏 4 个前提面板（AI 起草+保存） |
| premise/前提：选主角+主场景 → active.json (1030-1050) | ❌ | 未做（select_premises 工具已移植但无 UI；写作屏不显示 active 选择） |
| write/写作：向 agent 发指令 (1052-1070) | ✅ | 写作屏对话即此功能 |
| noai/人脑：人脑模式直写章节、/noai 退出 (1072-1127) | ❌ | 未做 |
| 对戏/roleplay：AI 选角或手选 + 用户角色 + 起始情境编辑 + 续写/新开一段 (1180-1405) | 🟡 | 手选/续写/新开 ✅；AI 选角 ✅（本轮补）；PC 无「开始新对戏前选场景」差异：Android 设置页先选场景，PC 是命令时选——等效 |
| 扮演/act-as：切换扮演角色 (1407-1429) | ✅ | @角色 切换，且归一化为显示名（PC 存原输入，Android 更稳） |
| 发言顺序/speak-order (1442-1510) | ✅ | |
| 对戏监视 (1517-1585) | ✅ | |
| 默认扮演/default-role：.pi-xie/user-role.json (1586-1591) | ❌ | 未做 |
| 对戏成文：选章（最新在前）+可选续写→主 agent 工具写回 (1597-1648) | ✅ | 对齐（Android 为草案+保存，因无主 agent 工具回路，行为等价且可撤销） |
| 对戏自动：每 8 句自动成文 (1650-1674) | 🟡 | 开关 ✅；差异：PC 经主 agent+write_rehearsal_prose 工具（可确认/自动），Android 直接调模型写文件 |
| 重说 (1678-1764) | ✅ | |
| 改台词 (1766-1830) | ✅ | |
| undo/撤销：快照恢复 (1832-1837) | ✅ | UI 按钮 + 工具 undo_last |
| 规则/rules：逐条开关 (1839-1885) | ✅ | 面板+持久化，风格拼接 ✅ |
| 破甲：开关 (1887-1911) | 🟡 | 持久化 ✅；差异：PC 需新开会话生效（提示词在会话开始时构建），Android 每回合重建提示词立即生效 |
| permissions/权限：自动写入开关 (1913-1944) | ❌ | 未做（与工具确认缺失对应） |
| manuscript：重建 manuscript.txt (1946-1952) | ❌ | 无 UI 入口（章节撤销时会自动重建，部分覆盖） |

## 3. 对戏引擎行为

| PC 行为 | Android | 备注 |
|---|---|---|
| 常驻角色 agent（独立转录、人设热更新、continue/prompt 三态） | ✅ | golden 测试 |
| 自判发言 + 沉默 + 导演推进语 | ✅ | |
| 轮内串行（同轮后位可见前位新台词） | ✅ | |
| @点名强制回应、裸点名注入提示 | ✅ | |
| 标签去重/他人标签丢弃/引述格式 | ✅ | |
| 记录格式（# 起始：/# 顺序：/角色行/散文） | ✅ | 真机互拷验证 |
| 退出三选项（退出/退出并成文/新开一段） | ✅ | |
| 轮内无人接话即停 (579) | ✅ | |
| 自动成文节流（导演模式多回合合并结算）(585-599) | 🟡 | 每 8 句检查 ✅；PC 经主 agent 工具回路 ⚠️ 同上 |

## 4. 提示词

| PC 项 | Android | 备注 |
|---|---|---|
| 破甲块置顶（core/armor-break + agent-session） | ✅ | 角色/写作提示词均置顶，golden 测试 |
| 角色子代理系统提示词（卡片/世界/场景/规则/隔离） | ✅ | golden 测试 |
| 选角提示 buildCastPrompt | ✅ | golden 测试 |
| 成文指令（保真规则+行数自查+工具步骤） | 🟡 | golden 测试；Android 附加「无文件工具请输出完整正文」说明行（合理差异） |
| 主写作 agent 系统提示词 | 🟡 | PC 主 agent 提示词随 pi 核心构建（含 pi-xie 前提注入）；Android 为自建 buildWritingSystemPrompt（前提+规则+工具约定+无 Operit 默认提示词）。**待逐段对照 PC 原文确认措辞与注入时机** |

## 5. 数据安全

| PC 机制 | Android | 备注 |
|---|---|---|
| 写操作快照 .pi-xie/undo/last.json（undo_last 工具） | ✅ | 同格式互拷；覆盖 entity/约束/章节；含章节撤销后 manuscript 重建 |
| mutating 工具确认（默认）/permissions 自动写入 | ❌ | Android 缺确认与开关 |
| 排练稿 write_rehearsal_prose 快照 | ❌ | 随工具缺失 |
| zip 互拷 | ✅（超出 PC） | 导入 dry-run 冲突清单/覆盖跳过选择/导入前自动备份/备份恢复/防穿越/大小上限 |

## 6. 明确不做（经用户确认的范围外）

- 人脑模式 noai、角色导入（Tavern JSON）、default-role 默认扮演：**待确认**是否纳入本轮。
- 语音（sherpa-ncnn 恢复）单独一轮。

## 逐项实现顺序（确认后执行）

1. 工具确认机制 + permissions 自动写入开关（PC 默认确认，UI 弹「运行 <tool>？参数摘要」；开关持久化 .pi-xie/permissions.json）
2. 补 get_active_context / get_style / write_rehearsal_prose 三个工具（自动成文改为：sendUserMessage 等效 → 模型输出 → 本地执行 write_rehearsal_prose，即工具回路内完成，替代直接写文件）
3. 前提 active 选择 UI（写作屏「前提」面板：主角/主场景单选 → active.json）+ manuscript 重建按钮
4. 主写作 agent 系统提示词逐段对照 PC 原文（定位 PC 构建处并核对措辞/注入时机）
5. 待确认项：noai 人脑模式 / 角色导入 / 默认扮演
6. 全部完成后统一真机验收（含：agent 对话里「删除 Feixue」→ 确认弹窗 → 真实删除 → 撤销；工具失败如实报告；自动成文；导入冲突/备份恢复）

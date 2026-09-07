# pi-xie Android 移植计划（TODO）

本目录是 pi-xie 的安卓客户端工程，基于 Operit（Kotlin + Compose，LGPL-3.0）裁剪改造。
目标：把 pi-xie 的写作/对戏能力完整搬到 Android，文件格式与电脑版 pi-xie 完全兼容（互拷可用）。

## 当前进度

- [x] `feat/android-port` 分支；Operit 骨架导入 `android/`（docs/examples/原生模块等已剔除）
- [x] settings 裁剪为仅 `:app`；app/build.gradle.kts 移除 8 个模块依赖与 ffmpeg AAR
- [x] 移除 STT 模型下载任务与外部原生库校验任务（syncSttModelAssets / verifyExternallyBuiltNativeLibraries）
- [x] 裁剪编译闭环：删除依赖已删模块的功能代码（本地模型/3D 角色/shower 自动化/终端/FFmpeg/JS 工具包生态，约 150 文件），`compileDebugKotlin` 通过
- [x] CMake 只保留聊天流式渲染 streamnative 库（去掉 sherpa-ncnn/WAMR）；abiFilters 加 x86_64 供模拟器调试
- [x] `assembleDebug` 出 APK（123.9MB，后续瘦身）+ 真机（魅族 Note 16 Pro）安装启动无崩溃 → 基线提交 `6b6ddfe`
- [x] Phase 1 Step 1：工作区/记录/解析/提示词 Kotlin 移植（pixie.workspace + RehearsalRecord + RoleplayParsing + PixiePrompts，含 golden 单测 25 例全绿）；清理 6 个依赖未移植模块的孤儿测试文件
- [x] Phase 1 Step 2：对戏引擎 RehearsalEngine（常驻转录/自判发言/轮内串行/点名/重说/改台词/发言顺序持久化，golden 单测 9 例全绿）+ AIServiceTurnRunner 流式接入（禁重试，abort 干净）
- [x] Phase 1 Step 3：对戏屏（Operit 头像+气泡风格、成文/监视/顺序/退出菜单、点名条、直播条、长按菜单、快捷新建角色/场景）
- [x] 写作屏：入口改为「写作」（侧边栏），前提面板（世界观/大纲/时间线/风格/角色/场景，AI 起草+保存），写作对话（Operit 气泡 + 经典输入栏：语音位/＋附件/模型/发送），AI 只出文本提案、保存才落盘
- [x] 工作区 zip 导入/导出（与电脑 pi-xie 互拷；路径穿越防护；golden 单测 4 例）；真机用电脑项目 zip 导入 46 文件、续写对戏、AI 接话、记录回写原文件全部验证通过
- [x] 角色 → 导出到 Operit 角色卡；角色图片上传 → 写作 agent 视觉分析更新外貌（保留其它设定，回归单测）
- [x] 对戏成文：按电脑 pi-xie /对戏成文 逻辑（选章节最新在前 + 可选续写位置 → 保真规则改写 → 保存落盘）；退出菜单三选项（退出/退出并成文/新开一段）
- [x] 气泡默认头像改为灰色圆（无头像图片时不用默认图标）；导入/导出文字按钮（↓导入 ↑导出）
- [ ] 瘦身：清理 assets 里 OS 自动化残留（desktop.apk/accessibility.apk/shizuku.apk/templates）与 filament 等大依赖

## Phase 0 构建基线

- 环境：JAVA_HOME=F:\Android\jbr（JDK 21）；Android SDK=C:\Users\win\AppData\Local\Android\Sdk
- 构建：`gradlew :app:assembleDebug --console=plain`
- 需清理的大件资产（OS 自动化/模板，与写作无关）：assets/desktop.apk、accessibility.apk、shizuku.apk、templates/

## Phase 1 对戏优先（核心卖点）

- [x] 工作区：premises 文件格式（角色/场景/世界观/大纲/时间线/风格/active.json）+ 章节文件 + 对戏记录格式（# 起始：/# 顺序：/角色行/散文），与 pi-xie 一致
- [ ] 对戏核心：常驻角色 agent（独立转录、他人台词引述格式）、轮内串行、发言顺序、点名、重说、改台词、沉默判定、标签去重/他人标签丢弃（引擎 RehearsalEngine + AIServiceTurnRunner 已随 Step 2 完成并测绿；与 UI 的接线待 Step 3）
- [ ] 对戏 UI：聊天流（角色行/[子代理]/续写历史）、可点击命令面板与工具栏、点名条、直播条、监视面板（滑动切换）、台词长按菜单（已随 Step 3 完成；与引擎联调的真机验收待跑）
- [ ] 成文（保真规则）写入章节；自动成文开关
- [ ] 破甲优先：写作/角色 agent 自建系统提示词（不含 Operit 默认提示词），破甲块置顶，设置页可点开关

## Phase 2 角色管理与写作

- [ ] 角色管理页（新建/编辑：名字、设定、自定义提示词、标签；导入/删除；对戏中热更新人设）
  - 注意：AI 新建/修改角色走**写作 agent 的 entity 工具**（list_entities/create_entity/update_entity/delete_entity，落盘 premises/characters/*.md），
    不走 Operit 原「人设卡生成」路径——该路径的工具结果不回传 AI、无新建工具、无活跃卡时静默失败，AI 会返回虚假成功。
    我们的实现要求：工具结果真实回传到 agent 循环，写入后重读校验，绝不虚构成功。
- [ ] 写作 agent（自建提示词 + 破甲置顶、章节/前提读写、流式打断、规则开关）、章节浏览

## Phase 3 成熟化与发布

- [ ] 工程导入/导出（与电脑互拷）、通知、主题、签名 APK 发布、LGPL 合规检查

## 验收

- Kotlin 单测：对戏解析器、发言顺序、成文指令、提示词组装（破甲置顶且无 Operit 默认提示词）；文件格式 golden 夹具来自电脑 pi-xie 真实产物
- 角色新建/修改验收：写作 agent 建角色 → premises/characters/<id>.md 真实落盘 → 重读一致 → 对戏可选用；AI 回复不得虚假声称成功
- Compose UI 测试：命令面板、点名条、长按菜单、监视面板、破甲开关
- 真机验收：进对戏 → 点名 → 重说/改台词 → 监视 → 成文 → 导出互拷回电脑 pi-xie 打开一切正常

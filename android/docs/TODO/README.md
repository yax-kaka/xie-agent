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
- [ ] 瘦身：清理 assets 里 OS 自动化残留（desktop.apk/accessibility.apk/shizuku.apk/templates）与 filament 等大依赖

## Phase 0 构建基线

- 环境：JAVA_HOME=F:\Android\jbr（JDK 21）；Android SDK=C:\Users\win\AppData\Local\Android\Sdk
- 构建：`gradlew :app:assembleDebug --console=plain`
- 需清理的大件资产（OS 自动化/模板，与写作无关）：assets/desktop.apk、accessibility.apk、shizuku.apk、templates/

## Phase 1 对戏优先（核心卖点）

- [ ] 工作区：premises 文件格式（角色/场景/世界观/大纲/时间线/风格/规则/active.json）+ 章节文件，与 pi-xie 一致
- [ ] 对戏核心：常驻角色 agent（独立转录、他人台词引述格式）、轮内串行、发言顺序（# 顺序：）、点名、重说、改台词、沉默判定、标签去重/他人标签丢弃、对戏记录格式一致
- [ ] 对戏 UI：聊天流（角色行/[子代理]/续写历史）、可点击命令面板与工具栏、点名条、直播条、监视面板（滑动切换）、台词长按菜单
- [ ] 成文（保真规则）写入章节；自动成文开关
- [ ] 破甲优先：写作/角色 agent 自建系统提示词（不含 Operit 默认提示词），破甲块置顶，设置页可点开关

## Phase 2 角色管理与写作

- [ ] 角色管理页（新建/编辑：名字、设定、自定义提示词、标签；导入/删除；对戏中热更新人设）
- [ ] 写作 agent（自建提示词 + 破甲置顶、章节/前提读写、流式打断、规则开关）、章节浏览

## Phase 3 成熟化与发布

- [ ] 工程导入/导出（与电脑互拷）、通知、主题、签名 APK 发布、LGPL 合规检查

## 验收

- Kotlin 单测：对戏解析器、发言顺序、成文指令、提示词组装（破甲置顶且无 Operit 默认提示词）；文件格式 golden 夹具来自电脑 pi-xie 真实产物
- Compose UI 测试：命令面板、点名条、长按菜单、监视面板、破甲开关
- 真机验收：进对戏 → 点名 → 重说/改台词 → 监视 → 成文 → 导出互拷回电脑 pi-xie 打开一切正常

# pi-xie

pi-xie 是一个自维护的、面向小说写作的终端 agent，fork 自 [pi](https://github.com/earendil-works/pi-mono)。它保留 Pi 的 TUI、agent 循环、会话管理和扩展系统，把面向编码的系统提示与工具换成小说写作工作流。

同一个仓库还包含 Android 版源码（`android/`），fork 自 [Operit](https://github.com/AAswordman/Operit)。Android 版目前只保留源码，不提供发布包，需要自行构建。

## 发布包下载与使用

发布包从本仓库的 [Releases](https://github.com/yax-kaka/xie-agent/releases) 页面下载。当前只发布 Windows 终端版。

| 平台 | 发布包 | 当前版本 |
|------|--------|----------|
| Windows（终端版） | `pi-xie-<版本>-windows-x64.exe` | 0.1.0 |

### Windows 版：pi-xie.exe

系统要求：Windows 10/11 x64。发布包是单个自包含的 exe，不需要另外安装 Node.js。

1. 下载 `pi-xie-<版本>-windows-x64.exe`，放到你存放小说的目录，或任意目录。
2. 运行时先切到小说目录再启动（agent 的工作目录就是启动目录）：

   ```powershell
   cd path\to\novel
   .\pi-xie-<版本>-windows-x64.exe
   ```

   也可以直接双击 exe，但那样工作目录是 exe 所在目录。
3. 首次使用先配置模型凭据，任选一种：
   - 启动后输入 `/login`，按提示选择服务商并保存 API Key；
   - 或先设好环境变量再启动：

     ```powershell
     $env:OPENAI_API_KEY="sk-..."
     .\pi-xie-<版本>-windows-x64.exe
     ```
4. 输入 `/model` 选择模型，然后直接描述你要写的内容。

使用说明：

- 第一次运行 Windows 可能弹出 SmartScreen 提示（exe 未做代码签名），选“更多信息 → 仍要运行”。
- 全局配置、凭据、会话保存在 `%USERPROFILE%\.pi-xie\agent`；当前小说的项目数据保存在工作目录下的 `.pi-xie/`。
- `pi-xie.exe --help` 查看命令行参数，`pi-xie.exe --version` 查看版本号。
- 需要终端环境；在 Windows Terminal、PowerShell 或 cmd 中运行都可以。

## 致谢

本项目的绝大部分能力来自两个上游开源项目，没有它们就没有这个仓库：

- [pi](https://github.com/earendil-works/pi-mono)（作者 Mario Zechner）：桌面终端版 pi-xie 建立在它的 TUI、agent 循环、会话管理和扩展系统之上，采用 MIT 许可。仓库根目录的 [LICENSE](LICENSE) 保留了原始版权声明。


其余第三方依赖的许可证以各包元数据和对应目录下的许可证文件为准。

## 开源许可与非商业说明

- 本项目是个人自用的非商业开源项目：发布包免费下载、免费使用，我们不售卖本项目或其发布包，也没有付费版本。
- 需要区分两件事：上面这句“非商业”是本项目自己的声明，不是对上游代码的额外限制。pi 的 MIT 许可和 Operit 的 LGPL-3.0-only 许可都允许商业使用。
- 任何人二次分发本项目或其发布包时，必须遵守上游许可证：保留 pi 的版权与许可声明；按 LGPL-3.0 的要求提供对应源码、许可证副本和相关声明。
- 请勿把本项目发布包当成上游官方版本分发，也不要使用上游项目的名称、图标或渠道暗示官方背书。

## 写作模型

- 故事 = 角色 + 场景 + 事件。
- 角色和场景是一级前提，可以自由组合。
- 世界观、大纲、时间线、文风是二级约束。
- 章节以 Markdown 文件保存在 `chapters/` 下。
- `manuscript.txt` 自动维护为合并后的全文。

## 工作区结构

```text
novel/
  premises/
    characters/
    scenes/
    worldview.md
    outline.md
    timeline.md
    style.md
    active.json
  chapters/
    001.md
  manuscript.txt
```

## 写作命令

- `/character`、`/人物`、`/scene`、`/场景` - 管理角色和场景
- `/worldview`、`/outline`、`/timeline`、`/style` - 编辑二级约束
- `/premise`、`/前提` - 选择当前生效的角色/场景组合
- `/write`、`/写作` - 让 agent 写一章
- `/noai`、`/人脑` - 切换持续人脑写作模式，带章节实时预览；提交的每行直接保存，不调用 AI
- `/manuscript` - 由章节文件重建 `manuscript.txt`
- `/undo`、`/撤销` - 回退上一次写作工具的改动
- `/对戏`、`/roleplay`、`/规则`、`/权限` - 对戏、写作规则与授权控制

## 开发

```powershell
npm install --ignore-scripts
npm run build
npm run test
```

也可以全局安装后使用（需要本机有 Node.js 22.19 或更高）：

```powershell
npm install -g --ignore-scripts pi-xie
cd path\to\novel
pi-xie
```

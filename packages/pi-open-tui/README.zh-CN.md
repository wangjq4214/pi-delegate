# pi-open-tui

[English](README.md) | [简体中文](README.zh-CN.md)

一个为 [Pi](https://pi.dev) 编程代理打造的可配置终端界面扩展，与 pi-delegate 互不依赖。

此 workspace 包导入自 [OldSuns/pi-open-tui](https://github.com/OldSuns/pi-open-tui) v0.3.11，提交为 `766ccab7b40df6fb9682a105a05d3838803c3d4b`。扩展源码和测试以该快照为基础，包含本地行为调整（包括移除自定义 Header，保留 Pi 原生顶栏）；上游 MIT 版权和许可声明保留在仓库根目录的 LICENSE 中；包配置和文档遵循当前仓库。它替换原有应用骨架，不是独立的 Pi 应用。

## 功能

- **保留 Pi 原生顶栏**：不再覆盖自定义 Logo 或命令提示面板
- **自适应底栏**：集中展示 Git 状态、运行环境、上下文用量、Token、费用和扩展状态
- **带边框的编辑器**：支持块状、竖线和下划线三种光标样式
- **项目环境感知**：识别 50 多种运行环境，并展示 ahead/behind、已暂存、已修改、未跟踪、stash 和 detached HEAD 等 Git 状态
- **单轮遥测**：展示 TPS、首 Token 延迟（TTFT）、耗时、停顿、Token 数量和模型标价速率
- **思考预览**：在 Pi 折叠思考标签中展示有界标题树，圈圈与 Workline 同速，结束后保留耗时摘要
- **紧凑工具和 codemode 活动**：保留原生详情展开，展示可靠状态及已观察到的子调用进度
- **交互式设置**：通过 `/open-tui` 配置，并支持英文和简体中文界面

## 环境要求

- 本地开发需要 Git 和 Bun 1.4.1 或更高版本
- 上游测试套件需要 Node.js 22.19 或更高版本
- Pi 1.0 或更高版本；增强工具展示需要 Pi 1.1.0 的公开渲染 API，旧宿主保留原生工具展示并提示能力不可用
- 支持 UTF-8 和彩色输出的终端
- 使用完整图标集时需要 [Nerd Font](https://www.nerdfonts.com/font-downloads)（可选；内置可移植 Unicode 图标）

## 安装

### 本地开发环境

在 [workspace 根目录](../../README.zh-CN.md) 执行：

```sh
bun install --frozen-lockfile
bun run hooks:install
bun run --filter @wangjq4214/pi-open-tui build
```

本地 `dev` 直接加载 TypeScript 源码，无需先构建；`build` 使用 Rolldown 生成 `dist/index.js`、source map 和 `dist/LICENSE`。Pi 宿主 SDK 保持外部依赖，不打入 bundle。manifest 和发布内容均指向构建产物，类型检查单独使用 `typecheck`。

### 直接加载扩展

在 workspace 根目录执行：

```sh
bun run --cwd packages/pi-open-tui pi --extension ./src/index.ts
```

也可以执行 `bun run --filter @wangjq4214/pi-open-tui dev`；脚本在包目录启动 Pi。修改源码后在 Pi 中执行 `/reload`。`start` 加载 `dist/index.js`，需要先执行 `build`。使用 `build:watch` 持续构建时，构建完成后同样执行 `/reload`。

### 安装本地 Pi package

安装 Pi CLI 后：

```sh
pi install /absolute/path/to/checkout/packages/pi-open-tui
```

使用 `pi install npm:@wangjq4214/pi-open-tui` 安装此包。`pi install npm:pi-open-tui` 安装的是上游包，而非此 workspace 包。不要在同一个 Pi 会话中同时加载两份扩展。

## 字体与图标

可从 [Nerd Fonts 官方下载页](https://www.nerdfonts.com/font-downloads)或 [GitHub 最新版本](https://github.com/ryanoasis/nerd-fonts/releases/latest)下载任意已修补字体。安装后，请在终端配置中选择该字体，并重启终端。

默认的 `auto` 模式检查终端环境，而不是已安装的字体文件。在支持 UTF-8 的交互式 TTY 中，它会使用 Nerd Font 图标，即使 Pi 运行在 runner 或子 shell 中。如果图标显示为方框、乱码或错误符号，请打开 `/open-tui`，在**外观**页选择合适的模式：

- `nerd`：终端已配置 Nerd Font 时，强制使用 Nerd Font 图标
- `unicode`：可移植 Unicode 图标（文件夹、分支、笔记本电脑、灯泡、插头、沙漏等），无需修补字体；emoji 字形通过终端的 emoji 回退渲染
- `ascii`：使用纯文本图标，无需安装修补字体
- `auto`：在支持 UTF-8 的交互式 TTY 中使用 Nerd Font 图标；SSH 会话使用可移植 Unicode 图标（字体由客户端终端决定，通常没有 Nerd Font）；非交互式输出、`TERM=dumb` 或明确配置为非 UTF-8 的 locale 使用 ASCII

如果已经安装字体，但 `auto` 仍选择 ASCII，请手动切换为 `nerd`。使用 VS Code、Windows Terminal 等应用时，只在操作系统中安装字体还不够，还需要在对应的终端配置中选中该字体。如果 SSH 客户端终端确实安装了 Nerd Font 并希望在 SSH 下使用完整图标，请将模式显式设为 `nerd`。

## 配置

运行 `/open-tui` 打开**常规**、**外观**、**底栏**、**遥测**、**工具卡片**和**用户 / Skill**页面。用户／Skill 与工具展示分别配置，「外观」不再提供共享的消息布局开关。设置保存在 `~/.pi/agent/open-tui.json`，以下示例为新安装默认配置：

```json
{
  "enabled": true,
  "inlineFooter": false,
  "toolPresentation": true,
  "settingsLanguage": "en",
  "cursorStyle": "bar",
  "editorBorderStyle": "minimal",
  "messageLayout": "compact",
  "userMessageLayout": "compact",
  "toolMessageLayout": "compact",
  "userBoxBorder": {
    "enabled": false, "style": "bold", "colorMode": "theme",
    "top": { "enabled": false }, "bottom": { "enabled": false },
    "left": { "enabled": true }, "right": { "enabled": false }
  },
  "toolBoxBorder": {
    "enabled": false, "style": "double", "colorMode": "status",
    "top": { "enabled": true }, "bottom": { "enabled": false },
    "left": { "enabled": true }, "right": { "enabled": false }
  },
  "workline": {
    "marquee": true,
    "attachToBorder": false
  },
  "icons": {
    "mode": "auto"
  },
  "footerSegments": {
    "cwd": true,
    "hostname": false,
    "sessionName": false,
    "gitBranch": true,
    "gitStatus": true,
    "gitCommit": false,
    "runtime": true,
    "context": true,
    "tokens": true,
    "cost": true,
    "extensionStatuses": true,
    "capitalizeProviderName": true
  },
  "telemetry": {
    "enabled": true,
    "tps": true,
    "ttft": true,
    "duration": true,
    "tokens": true,
    "stalls": true,
    "cost": true
  },
  "thinkingPeek": {
    "lines": 1
  }
}
```

升级、启动和重载不会重写已有配置文件，也不会用新默认替换用户当前的有效配置。已有文件中缺失或类型错误的已知字段按历史默认解释（包括常规布局、块光标、环绕编辑器和贴合边框的 Workline），未知旧字段保留。独立布局字段缺失时才在内存中回退到旧 `messageLayout`；新安装才使用上面的新默认。读取或 JSON 解析失败会告警并使用回退配置。用户明确修改设置后才保存，采用同一文件系统内的文件替换；保存失败仅在当前会话生效，显示未保存告警，原文件保持完整。

主要选项：

| 选项 | 可选值 | 说明 |
| --- | --- | --- |
| `settingsLanguage` | `en`、`zh` | 切换 `/open-tui` 设置界面的语言 |
| `inlineFooter` | `true`、`false` | 将两条主要 Footer 信息行移入编辑器上下边框以节省垂直空间，默认关闭；扩展状态行仍显示在编辑器外 |
| `toolPresentation` | `true`、`false` | 工具卡片 → 增强展示，默认开启；关闭后使用原生工具内容，压缩展示与边框样式独立设置 |
| `cursorStyle` | `block`、`bar`、`underline` | `bar` 和 `underline` 需要终端支持光标形状转义序列 |
| `editorBorderStyle` | `surround`、`minimal` | 外观 → 编辑器边框；新安装默认「简洁」，已有配置保留原有效果。「简洁」仅保留上下横线，文字左右留白不变。切换即时生效并保存，仍支持工作状态和内联底栏 |
| `userMessageLayout` | `normal`、`compact` | 兼容旧配置的 User 布局状态；用户 / Skill → 启用合并控制布局和边框，关闭恢复原生消息／Skill，开启应用该组保存的样式；新安装默认 `compact` |
| `toolMessageLayout` | `normal`、`compact` | 工具卡片 → 压缩展示：关闭／开启；控制紧凑外壳，并在增强模式下隐藏成功预览；新安装默认 `compact` |
| `messageLayout` | `normal`、`compact` | 独立字段缺失时使用的旧版回退值，不再提供共享 UI 开关 |
| `userBoxBorder` | 总开关、样式、主题／固定颜色、四边开关与符号 | User 侧保存的样式选项；统一「启用」开关同时控制此边框状态。默认保存的边框标志为关闭，但紧凑竖线展示仍处于启用状态 |
| `workline.marquee` | 布尔开关 | 外观 → Workline 跑马灯；默认开启。工作文字上有高亮扫光，不横向滚动文字。关闭后状态和耗时仍更新，Pi 原生旋转指示器不受影响 |
| `workline.attachToBorder` | 布尔开关 | 外观 → Workline 贴合边框；新安装默认关闭。关闭后在编辑器上方独占一行，可见 Workline 上下各留一行空白，绝不移入 footer |
| `icons.mode` | `auto`、`nerd`、`unicode`、`ascii` | 控制底栏、Workline、工具展示和遥测通知使用的图标 |
| `footerSegments` | 布尔开关 | 分别控制底栏中的各项数据 |
| `footerSegments.capitalizeProviderName` | 布尔开关 | 将底栏中提供商名称的首字母大写；设为 `false` 时保留原始大小写 |
| `telemetry` | 布尔开关 | 控制遥测总开关和各项指标 |
| `thinkingPeek.lines` | 兼容存储：`0`、`1`、`2` | 关闭（`0`）／开启（`1` 或 `2`）；标题树最多保留最新 4 个标题 |
| `toolBoxBorder` | 总开关、样式、状态／固定颜色、四边开关与符号 | 工具卡片边框；默认关闭。保存的默认线型为 `double`，配色为 `status`，上／左开、下／右关；固定颜色使用 `muted`、`accent` 等主题标记 |

**工具卡片**前三项依次是**增强展示**、**压缩展示**、**边框样式**：前两项为独立开关，第三项循环选择关闭／单线／粗线／双线／虚线／自定义；样式关闭时隐藏后续边框配置，但不删除保存的选项。**用户 / Skill**只保留一个**启用**开关，合并控制布局与边框：关闭恢复原生 User／Skill 展示并隐藏其余设置，开启显示该组保存的样式、颜色与四边设置。旧版紧凑竖线视为启用，打开设置不会改写配置；明确编辑 User 样式时应用该组边框。两组仍支持独立四边与符号，固定颜色输入只在固定模式下出现；保存的配色也可影响紧凑竖线，旧配置的休眠 Tool 配色在明确编辑工具展示前保持不变。符号／颜色输入用 Enter 保存、Esc 取消，留空恢复回退值；符号须占一个显示列，右边框仍默认关闭。

`sessionName` 仅在会话有名称时显示；`hostname` 会显示主机名的短名称（主机名的第一个标签，例如从 `mba.example.com` 显示为 `mba`），并使用服务器图标；`gitCommit` 独立控制 detached HEAD 状态下的短哈希和标签，`gitBranch` 则控制分支名或 `HEAD` 标签；关闭 `extensionStatuses` 会隐藏整行扩展状态，其中也包括 MCP 状态。每条状态会保留其扩展通过 `ctx.ui.theme.fg()` 设置的颜色；未设置颜色的状态使用 muted 主题色显示。

开启 `inlineFooter` 后，两条常规 Footer 信息行会移入编辑器边框，从而节省垂直空间。顶部边框左侧显示 Git 分支，右侧信息组以当前目录开头；开启 `sessionName` 时，会话标题也会显示在左侧。Pi 原生 Header 和扩展状态行保持独立显示；终端较窄时优先截断低优先级 Footer 数据，保留右侧统计信息和边框角。

顶部数据会先精简再截断：目录优先级为 0，主机名为 1，会话名为 2，Git 为 3，runtime／context 为 4（数值越高越晚舍弃；同优先级先舍弃靠前项）。内联边框的左右信息组分别适配宽度；底部统计信息比模型名称更晚舍弃。

Git 支持尚无提交的分支、同时领先／落后的计数、stash 和 detached HEAD。会话启动、分支变更、工具完成、完整运行结束以及设置变更都会触发快照刷新。读取串行执行，待处理请求合并，仅发布最新请求的结果；过期结果和旧会话结果不会覆盖新状态。这不是通用文件监听器：在 Pi 外部修改文件后，会在下一次刷新触发时更新。

Runtime 检查当前工作目录中的标记，包括 `.csproj`、`.fsproj`、`.cabal` 等后缀。不同项目类型之间保留先匹配者优先的约定；独立的 `.kt` 或 `.kotlin-version` 标记可识别 Kotlin。Gradle Kotlin DSL 不足以确定项目语言，因此保留 Java／JVM 标签；只有 C 源文件标记时识别为 C，C／C++ 混合或只有通用 Make／CMake 标记时保留 C++ 回退。

唯一的 **Workline** 将 Pi 的编辑器工作信息与本次运行耗时合并显示。一次运行以 `agent_settled` 为结束边界，而不是每次底层 `agent_end`；重试、压缩及排队续跑保持连续计时，不提前发布结果。最终状态和耗时保留到下一次运行、会话切换／重载或成功的树导航。

| 结果 | 文字 | Unicode／ASCII 图标 | 颜色 |
| --- | --- | --- | --- |
| 观察到正常完成 | `done` | `✓`／`+` | 成功色 |
| 观察到中断 | `interrupted` | `■`／`!` | 警告色 |
| 观察到失败 | `failed` | `✗`／`x` | 错误色 |
| 结果证据不足 | `ended` | `•`／`-` | 中性色 |

Nerd Font 模式同样使用四种不同图标。`done` 只表示宿主正常完成，不保证用户任务已经达成；工具调用报错本身不代表整个运行失败。尚未恢复的长度截断，以及缺少决定性证据的恢复阶段取消，会显示中性的 `ended`。Pi 1.1.0 的公开 `agent_settled.aborted` 标志还能将重试阶段或底层循环结束后 before-settle 阶段的取消识别为 `interrupted`；不提供此标志的旧宿主仍受先前生命周期证据局限。这不是对所有最终结束原因的完整诊断。

无论 `inlineFooter` 是否开启，footer 都不再额外显示 working／结果计时。两个 Workline 开关即时生效并保存。原生重试、压缩等状态保留其语义、样式和展示优先级；边框较窄时会精简或截断 Workline，避免超出宽度。

## 紧凑消息布局

在 `/open-tui` 中独立使用**用户 / Skill → 启用**与**工具卡片 → 压缩展示**。新安装保留紧凑竖线（`compact`），已有文件保持原有效果且不自动改写。User 关闭时恢复原生消息与 Skill 并隐藏样式设置，开启时使用该组保存的样式。工具关闭压缩展示并将边框样式设为关闭即可恢复原外壳。两组互不影响，Assistant 输出不变。

用户竖线使用 `┃`（显式 ASCII 模式为 `|`）、主题 `userMessageText`，竖线与 `userMessageBg` 正文背景之间留一个不染色空格，背景内部保留一个左内边距及正文上下各一行 padding。Skill 卡片使用 `accent` 色竖线，不加外壳背景和上下 padding，保留真实原生内容、点击／快捷键展开及代码／段落留白。工具竖线跟随执行状态，消息间空白不染色，图片保留原生显示行为。

同时开启**工具卡片 → 增强展示**与**压缩展示**时，已完成的成功输出／diff／第三方结果预览隐藏到展开后；工具结果警告、截断／数量限制提示及完整输出路径也随详情折叠，展开后仍可查看，包括仅通过元数据提供的提示。摘要、展开提示和 codemode 活动／错误继续显示，真实失败预览及全局能力告警不隐藏。即使开启装饰边框，压缩也只由 `toolMessageLayout` 控制。关闭增强展示恢复原生工具内容，再关闭压缩展示和边框样式即可恢复原外壳；总启用开关关闭增强。

两组都可开启卡片边框，覆盖该组的竖线／原生外壳，并配置四边、线型、字符和颜色。Tool 框包围调用与结果这一整体；User 框保留原生 Markdown／转换器及终端消息标记，Skill 框组合真实原生控件，不将交互压平成文本。Tool 使用公开渲染 API；User／Skill 保持可恢复的实例级适配，在关闭模式、禁用或清理时恢复原生渲染，不兼容宿主告警并回退。兼容测试基于 Pi 1.1.0，不代表未来宿主或实际终端字体已验证，见[布局实测清单](docs/development.md#compact-message-layout-verification)。

## 工具展示

Pi 1.1.0 上，所有工具调用都获得统一的状态／名称／参数摘要、少量真实输出／错误预览（开启工具压缩展示时隐藏成功输出），以及可测得的耗时：覆盖原生工具、编辑／搜索扩展、delegate、computer-use、MCP 和其他扩展。新工具不需要加入样式白名单或编写专用 renderer。已验证的原生工具契约额外提供目标／命令摘要和编辑 diff 预览；未知 schema 使用有界通用参数摘要，不因名称熟悉就猜测语义。状态依据宿主错误证据，不搜索输出中的 “error” 等词；缺少计时的历史调用不会获得虚构耗时。使用卡片提示的 Pi 原生工具展开快捷键查看可用参数和结果；图片及其显示／隐藏控制、宿主截断提示和完整输出文件路径仍可访问。

第三方专用调用／结果组件与统一摘要组合展示，保留它们自己的紧凑视图、控件、图片、交互和重要元数据。组合时保留真实组件，不把它们压成纯文本或按通用预览预算静默裁切；因此在工具关闭压缩展示时，其原生紧凑内容可能占用额外空间。工具压缩展示会把成功结果组件隐藏到展开后，其控件和详情仍可在展开时使用。展开还会展示完整可用的通用参数和返回文本，避免专用 renderer 只显示元数据时，通用预览的剩余内容无法访问。

Codemode 保持为一张父卡片，所有已观察到的子工具名称（包括未知工具、扩展和 MCP）都使用统一子调用行。紧凑视图优先展示**已观察到**的子调用活动：运行中／失败／取消记录优先，选中行保持调用顺序，隐藏状态计数提示展开。计数不是完成百分比，也不预测最终工作量。父耗时是脚本的实际经过时间，不累加并行子调用耗时。成功脚本仍可能包含失败／取消子调用；子调用失败或脚本成功本身都不决定 Workline 的 Agent 整体结果。保留真实脚本输出预览（工具压缩展示下已完成的成功结果除外），以及子记录中可用的模型身份、状态和费用。

展开后展示完整的可用脚本和父返回内容，以及宿主提供的子记录。**子参数／错误是宿主摘要，可能已经截断；不会额外保存子调用的原始结果。** 如果脚本读取文件但只返回数量，展开无法恢复这些文件内容。父图片、宿主截断及完整输出文件访问保留原生行为；展开不能恢复宿主已丢弃的内容。

关闭**工具卡片 → 增强展示**（`toolPresentation: false`）可回到原生工具内容（关闭工具压缩展示和边框样式以恢复原有外壳）；总「启用」开关也会关闭此增强。没有公开渲染 API 的旧宿主保留原生工具并提示增强能力不可用。这里只改变展示，不改变执行、权限、对话记录或模型接收的结果。真实终端中的密度、滚动、图片和输入法行为仍需按[交互清单](docs/development.md#tool-presentation-verification)验证。

## 光标渲染

`bar` 和 `underline` 保留真实、不闪烁的终端光标形状，不用占字符格的符号模拟。`block` 保留 Pi 的软件块光标，在编辑器拥有焦点时隐藏真实光标。仍保留用于输入法定位的光标标记；获得焦点的弹窗保有自己的光标控制权。

Open TUI 会安装可恢复、仅作用于当前实例的运行时兼容适配层：对渲染期间的光标可见性指令去重，并在普通模式下等最终光标归位后才结束同步输出。不修改 Pi 源码或安装文件，也不全局拦截 stdout。禁用／重载扩展时恢复方法适配及安装前捕获的真实光标偏好；宿主接口不可用时告警并保留原生输出，不宣称能够防止闪烁。

记录输出的集成测试现覆盖固定开发版本 Pi TUI 1.1.0（先前证据覆盖 1.0.0 和当时检查的已安装版本 1.0.4）。适配依赖非公开渲染方法，因此未来宿主版本需要验证。实际视觉效果取决于终端／tmux 的同步输出支持；真实终端频闪和中文输入法定位仍需交互验证，见[光标实测清单](docs/development.md#cursor-output-verification)。

## 单轮遥测

每次 Agent 完整运行结束后，贴合边框模式保留原有临时遥测通知，不增加空白行。分离模式将遥测与运行结果和本次耗时合并在同一条 Workline 中，不另行通知；结果保留到下一次运行或会话重置。两种模式均遵循遥测设置；分离模式按可用宽度截断。其中的多个工具调用轮次合并统计：

```text
> TPS 42.5 tok/s | ~ TTFT 1.2s | + 29.7s | ↑ 567 | ↓ 1.2k | ! stall 1x / 4.3s | $ $3.60/M
```

TPS 的计算方式是：将本次运行中服务商报告的全部 Assistant 输出 Token，除以各个生成轮次的总耗时。计时范围从 `turn_start` 到 Assistant 的 `message_end`，包含 TTFT、隐藏推理、缓冲和停顿，但不包含轮次之间的工具执行时间。没有输出 Token 或无法测得生成时间时，会显示 `TPS —`。

`$ / M` 表示根据 `usage.cost.total` 得到的模型标价速率，不是底栏中的会话累计费用。所有遥测字段都可以在**遥测**页单独开关。

## 思考预览

开启 Pi 的 **Hide thinking** 后，Open TUI 将折叠块的 `Thinking...` 标签替换为**只含标题的树形展示**。`/open-tui` 的**常规 → 思考标题**只提供**开启／关闭**。

- 顶部状态行显示思考状态和实测耗时，下方按先后顺序保留**最新 4 个标题**，总共**最多 5 行**。新标题移除最旧标题，连续重复标题不新增节点；不增加溢出提示行，也不预览思考正文。
- 只识别实际思考中的明确 Markdown 标题、步骤／阶段标题，以及 `**Analyzing voting dynamics**` 这样的独立整行加粗标题；加粗标题不要求特定关键词或编号。不把普通正文、正文中的局部加粗、引用或代码示例猜成进度，也不调用模型生成摘要。没有标题时只显示状态／耗时；非推理模型保持原生行为。
- 当前标题带 spinner；以前的标题不会被打成功对勾，因为标题切换不代表任务已完成。每条 assistant 消息重新累计，不跨工具调用拼成整个任务的计划树。
- Think 在编辑器渲染生命周期读取正常 Workline 的原生动画帧，跟随宿主实际转速（包括自定义速度），而非仅统一刷新间隔。标准圈圈在两处共用 ASCII 相位回退，显式自定义宿主动画帧保持原样。不新增动画定时器、不修改宿主定时器；各自耗时仍独立。原生指示器缺失或处于重试等特殊状态时保留既有回退。
- 思考结束后收成“最新标题＋冻结耗时”的一行摘要，例如 `💡 ✓ 验证边界 · 18.4s`。取消、失败、无法确认的结束分别使用中断／失败／中性标记，只依据可靠的消息证据，不一律打成功对勾；标记只说明这段思考的结束状态，不表示任务验收通过。后续用户／assistant 消息不会清掉旧消息自己的摘要，即使最后只输出答案、没有新思考也会保留；新消息仍独立累计标题和计时。关闭功能或显式会话／界面重置时恢复原生标签。
- 标题按显示宽度截断，优先保留状态和耗时。原生展开仍显示完整原始思考，包括树中没有展示的内容。

```text
💡 思考 · 14.2s
├─ 分析约束
├─ 比较方案
├─ 检查兼容性
└─ ⠹ 验证边界
```

示例使用便携 Unicode 图标；Nerd Font 和 ASCII 图标／树线沿用现有图标设置。不再提供单行／双行选择，也没有标题数量设置。为兼容旧配置，存储键仍为 `thinkingPeek.lines`：`0` 表示关闭，`1`、`2` 都表示开启；面板修改保存为 `0`／`1`，保留其他及未知配置字段。既有启停选择及默认开启行为不变，不在启动时重写旧文件。

Workline、增强工具耗时和思考动画共用一个按需 UI 刷新调度器，合并到期更新及渲染请求；没有动态内容时不产生周期唤醒。各模块保留独立计时区间和适当的刷新节奏。动画不会轮询 Git／运行时数据，也不接管原生或第三方定时器。减少重复刷新是实现目标，不等于已测得 CPU 性能提升。

思考标签使用独立的宿主组件兼容桥。组件或终端宽度不可用／不兼容时保留原生标签，每个会话最多告警一次。自动化集成测试只覆盖固定开发宿主版本；真实终端、字体、IME 以及其他宿主版本仍需单独验证。

## 开发

在 workspace 根目录执行：

```sh
bun run --filter @wangjq4214/pi-open-tui typecheck
bun run --filter @wangjq4214/pi-open-tui test
bun run check
```

导入来源、验证方式和维护边界见 [开发指南](docs/development.md)。详细文档以英文维护。

## 文档

- [开发指南](docs/development.md) — 环境搭建、验证、调试和维护边界。
- [路线图](docs/roadmap.md) — 按建议优先级排列的候选能力与 TODO。

详细文档以英文维护。

## 致谢

本项目基于多个 Pi 社区包的工作：

- **[pi-haiku](https://github.com/nnocte/pi-haiku)** — 双行底栏结构和工作计时器
- **[pi-claude-code-tui](https://github.com/Phoobobo/pi-claude-code-tui)** — 圆角编辑器边框技术
- **[pi-zentui](https://github.com/lmilojevicc/pi-zentui)** — Starship 风格底栏、运行环境检测、会话生命周期和设置界面模式
- **[pi-tps](https://github.com/monotykamary/pi-tps)** — 单轮计时、停顿检测和保守的 TPS 计算方式

运行环境检测和 Git porcelain 解析借鉴了 `pi-zentui` 的结构。

特别感谢 **[LINUX DO](https://linux.do)** 社区的支持。

## 许可证

[MIT](../../LICENSE)

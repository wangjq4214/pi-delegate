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
- **思考预览**：模型工作时，在 Pi 隐藏思考块的 `Thinking...` 位置显示实时字幕，展示推理内容的末尾片段
- **交互式设置**：通过 `/open-tui` 配置，并支持英文和简体中文界面

## 环境要求

- 本地开发需要 Git 和 Bun 1.4.1 或更高版本
- 上游测试套件需要 Node.js 22.19 或更高版本
- Pi 1.0 或更高版本
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

运行 `/open-tui` 打开设置窗口，其中包含**常规**、**外观**、**底栏**和**遥测**四个页面。设置保存在 `~/.pi/agent/open-tui.json`：

```json
{
  "enabled": true,
  "inlineFooter": false,
  "settingsLanguage": "zh",
  "cursorStyle": "block",
  "editorBorderStyle": "surround",
  "workline": {
    "marquee": true,
    "attachToBorder": true
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

缺失或类型错误的已知字段会使用默认值，未知的旧版字段则保留。读取或 JSON 解析失败时会告警并使用默认配置。保存采用同一文件系统内的文件替换，而不是原地覆盖；保存失败时，修改仍在当前会话生效，告警会说明尚未持久化，原配置文件保持完整。

主要选项：

| 选项 | 可选值 | 说明 |
| --- | --- | --- |
| `settingsLanguage` | `en`、`zh` | 切换 `/open-tui` 设置界面的语言 |
| `inlineFooter` | `true`、`false` | 将两条主要 Footer 信息行移入编辑器上下边框以节省垂直空间，默认关闭；扩展状态行仍显示在编辑器外 |
| `cursorStyle` | `block`、`bar`、`underline` | `bar` 和 `underline` 需要终端支持光标形状转义序列 |
| `editorBorderStyle` | `surround`、`minimal` | 外观 → 编辑器边框；默认「环绕」。「简洁」仅保留上下横线，文字左右留白不变。切换即时生效并保存，仍支持工作状态和内联底栏 |
| `workline.marquee` | 布尔开关 | 外观 → Workline 跑马灯；默认开启。工作文字上有高亮扫光，不横向滚动文字。关闭后状态和耗时仍更新，Pi 原生旋转指示器不受影响 |
| `workline.attachToBorder` | 布尔开关 | 外观 → Workline 贴合边框；默认开启。关闭后在编辑器上方独占一行，可见 Workline 上下各留一行空白，绝不移入 footer |
| `icons.mode` | `auto`、`nerd`、`unicode`、`ascii` | 控制底栏、Workline 和遥测通知使用的图标 |
| `footerSegments` | 布尔开关 | 分别控制底栏中的各项数据 |
| `footerSegments.capitalizeProviderName` | 布尔开关 | 将底栏中提供商名称的首字母大写；设为 `false` 时保留原始大小写 |
| `telemetry` | 布尔开关 | 控制遥测总开关和各项指标 |
| `thinkingPeek.lines` | `0`、`1`、`2` | 关闭、单行或双行思考预览 |

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

Nerd Font 模式同样使用四种不同图标。`done` 只表示宿主正常完成，不保证用户任务已经达成；工具调用报错本身不代表整个运行失败。尚未恢复的长度截断，以及缺少决定性证据的恢复阶段取消，会显示中性的 `ended`。Pi 1.0.0 不在最终结束事件中提供结果字段，因此这里展示当前运行的公开生命周期证据，而非对所有最终结束原因的完整诊断。特别是底层循环结束后，其他扩展在 `agent_before_settle` 回调中取消运行，可能与正常完成或失败无法区分。

无论 `inlineFooter` 是否开启，footer 都不再额外显示 working／结果计时。两个 Workline 开关即时生效并保存。原生重试、压缩等状态保留其语义、样式和展示优先级；边框较窄时会精简或截断 Workline，避免超出宽度。

## 光标渲染

`bar` 和 `underline` 保留真实、不闪烁的终端光标形状，不用占字符格的符号模拟。`block` 保留 Pi 的软件块光标，在编辑器拥有焦点时隐藏真实光标。仍保留用于输入法定位的光标标记；获得焦点的弹窗保有自己的光标控制权。

Open TUI 会安装可恢复、仅作用于当前实例的运行时兼容适配层：对渲染期间的光标可见性指令去重，并在普通模式下等最终光标归位后才结束同步输出。不修改 Pi 源码或安装文件，也不全局拦截 stdout。禁用／重载扩展时恢复方法适配及安装前捕获的真实光标偏好；宿主接口不可用时告警并保留原生输出，不宣称能够防止闪烁。

记录输出的集成测试覆盖 Pi TUI 1.0.0 和本次检查的已安装版本 1.0.4。适配依赖非公开渲染方法，因此未来宿主版本需要验证。实际视觉效果取决于终端／tmux 的同步输出支持；真实终端频闪和中文输入法定位仍需交互验证，见[光标实测清单](docs/development.md#cursor-output-verification)。

## 单轮遥测

每次 Agent 完整运行结束后，贴合边框模式保留原有临时遥测通知，不增加空白行。分离模式将遥测与运行结果和本次耗时合并在同一条 Workline 中，不另行通知；结果保留到下一次运行或会话重置。两种模式均遵循遥测设置；分离模式按可用宽度截断。其中的多个工具调用轮次合并统计：

```text
> TPS 42.5 tok/s | ~ TTFT 1.2s | + 29.7s | ↑ 567 | ↓ 1.2k | ! stall 1x / 4.3s | $ $3.60/M
```

TPS 的计算方式是：将本次运行中服务商报告的全部 Assistant 输出 Token，除以各个生成轮次的总耗时。计时范围从 `turn_start` 到 Assistant 的 `message_end`，包含 TTFT、隐藏推理、缓冲和停顿，但不包含轮次之间的工具执行时间。没有输出 Token 或无法测得生成时间时，会显示 `TPS —`。

`$ / M` 表示根据 `usage.cost.total` 得到的模型标价速率，不是底栏中的会话累计费用。所有遥测字段都可以在**遥测**页单独开关。

## 思考预览

开启 Pi 的 **Hide thinking** 后，任务运行期间 pi-open-tui 会在原生隐藏思考块的 `Thinking...` 位置显示紧凑的实时字幕。`/open-tui` 中提供**关闭、单行、双行**三种模式：

- 模型推理时，思考内容的末尾片段会随 spinner 滚动（`~ think ⠋ …`）；
- 开始输出正文时定格为对勾（`~ think ✓`）；
- 双行模式中，上一条和最新一条思考内容使用相同的文字缩进；如果最新一行超出宽度，则两行随新 Token 持续显示它的最新末尾片段，不再保留上一条；
- 任务结束后恢复原生 `Thinking...` 标签。

```text
~ think ⠋ 上一条思考
          最新一条思考
```

该字幕仅在模型真正输出推理内容后出现，非推理模型不会显示。可见性由 Pi 自身的 Hide thinking 开关控制，切换后立即生效。每一行都按*显示宽度*截断（全角字符计 2 列），因此包含中文的思考文本也不会溢出终端。可在 `/open-tui` 的**常规 → 思考预览**中切换，或直接修改 `open-tui.json` 中的 `thinkingPeek.lines`。

思考预览的宿主组件兼容逻辑已独立隔离。组件树或终端宽度不可用／不兼容时，会保留原生标签，每个会话最多告警一次，不中断事件处理。生命周期测试只覆盖固定的开发宿主版本，其他宿主版本仍需另行验证。

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

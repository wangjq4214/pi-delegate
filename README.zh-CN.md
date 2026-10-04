# pi-delegate

[English](README.md) | [简体中文](README.zh-CN.md)

无需离开当前会话，即可将专注的任务委派给全新的 Pi 子 agent。

pi-delegate 是一个 Pi TypeScript 扩展，通过 RPC 启动一次性子 agent，支持同步返回结果或显式启用后台执行。

## 功能

- **全新的子 agent**：每个任务使用新会话；委派工具仅对主 agent 可用。
- **工具继承**：重新初始化主 agent 的工具和扩展，保留启用状态与可发现性。
- **同步与后台执行**：等待结果，或在会话所属任务运行期间继续其他工作。
- **任务管理**：接收模型可见的完成消息，查询后台结果，并显式取消任务。
- **软催促与状态 UI**：配置任务级收尾提醒，在 TUI 输入框上方查看子 agent 状态。

## 环境要求

- 本地安装需要 Git 和 Bun 1.4.1 或更高版本。
- Node.js 22.19 或更高版本。Pi 在 Bun 下运行时，子进程需要能从 `PATH` 找到 `node`。
- 兼容的 Pi 宿主。本扩展已在 `@earendil-works/pi-coding-agent@1.0.0` 上验证；其他宿主版本尚未验证。

## 安装

在本地 Git 仓库的根目录执行：

```sh
bun install --frozen-lockfile
```

安装依赖时也会安装开发用 Git hook。具体配置请参阅[开发指南](docs/development.md)。

### 直接加载扩展

```sh
bun run pi --extension ./src/index.ts
```

Pi 直接加载 TypeScript 源码，无需构建。

### 作为本地 Pi package 安装

安装 Pi CLI 后执行：

```sh
pi install /absolute/path/to/pi-delegate
```

`package.json` 声明了扩展入口。请先使用 Bun 安装本地依赖。该 package 当前标记为 `private`，尚未发布到 npm。

## 使用

主 agent 可以调用 `delegate`，明确提供任务及所需背景：

```json
{
  "task": "Review error handling in src/ and report findings with file paths",
  "context": "Analyze only; do not modify files"
}
```

默认情况下，调用会等待子 agent 的最终结果。如需在子 agent 运行期间继续工作，可以显式启用后台模式：

```json
{
  "task": "Analyze test coverage and report gaps",
  "context": "Analyze only; do not modify files",
  "background": true
}
```

| 工具 | 用途 |
| --- | --- |
| `delegate` | 启动全新的同步或后台子 agent。 |
| `delegate_status` | 使用返回的 `taskId` 查询后台任务。 |
| `delegate_cancel` | 取消后台任务并等待资源清理。 |

参数、结果状态、催促配置和状态 UI 的详细说明请参阅[使用指南](docs/usage.md)。

## 限制

- 后台执行需要长期运行的 TUI 或 RPC 会话。退出、重载、替换会话或分支导航后，任务不会继续运行。
- 主／子 agent 共享工作目录；扩展不提供工作区隔离或操作系统沙箱。
- 不会自动复制主 agent 的完整对话，请明确提供相关背景。
- 软催促只是建议，不是强制超时。后台 usage 与 Pi 主会话总量分开报告。

工具继承、生命周期、交互和清理边界请参阅[运行机制与安全边界](docs/runtime.md)。

## 文档

- [使用指南](docs/usage.md) — 工具、参数、结果、催促和 TUI 行为。
- [运行机制与安全边界](docs/runtime.md) — 工具继承、进程归属、取消和安全边界。
- [开发指南](docs/development.md) — 环境配置、检查、测试、Git hooks 和仓库结构。
- [路线图](docs/roadmap.md) — 按优先级排列的能力候选与 TODO。

详细文档统一使用英文维护。

## 参与贡献

修改前请阅读[开发指南](docs/development.md)。运行其中列出的检查与测试；更新项目级文档时，请保持中英文 README 内容一致。

## 许可证

本仓库目前没有许可证文件，尚未指定许可条款。

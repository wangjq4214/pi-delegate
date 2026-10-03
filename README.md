# pi-delegate

Pi TypeScript extension，提供 `delegate` 工具，通过 RPC 启动一次性子 agent。使用 Bun 管理依赖、Biome 检查和格式化，以及 Lefthook 管理 Git hooks。除 `delegate` 和子进程内部初始化命令外，不注册其他命令。

## 开始使用

需要 Git、Bun 1.4.1 或更高版本，以及兼容的 Pi 宿主。开发依赖锁定并验证了 `@earendil-works/pi-coding-agent@1.0.0`；Pi CLI 在 Node.js 下运行时需要 Node.js 22.19 或更高版本。

```sh
bun install --frozen-lockfile
```

安装后项目的 `postinstall` 会调用 **Lefthook** 安装 `pre-commit`。如安装时禁用了生命周期脚本，可手动执行：

```sh
bun run hooks:install
```

请在 Git 仓库内安装依赖，否则无法安装 Git hook。Bun 若提示阻止了传递依赖的生命周期脚本，无需为本项目的检查和测试自动信任这些脚本。

## 加载扩展

在项目根目录执行以下命令，直接加载 TypeScript 源码，无需构建：

```sh
bun run pi --extension ./src/index.ts
```

也可以使用已安装的 Pi CLI：

```sh
pi --extension ./src/index.ts
```

修改入口后可使用 Pi 的 `/reload`。

`package.json` 的 `pi.extensions` 声明了入口，也可以将本目录作为本地 Pi package 使用：

```sh
pi install /absolute/path/to/pi-delegate
```

本地 package 的依赖需由开发者通过 Bun 安装。Pi 宿主依赖声明在 `peerDependencies`，并作为开发依赖提供本地类型；不将宿主模块打包进扩展。当前项目为 `private`，不会意外发布到 npm。

## RPC 委派

加载扩展后，主 agent 可以调用 `delegate`：

```json
{
  "task": "检查 src/ 中的错误处理，返回发现和文件路径",
  "context": "只分析，不修改文件"
}
```

- `task` 必填且不能是空白文本；`context` 可选。不自动复制主 agent 的完整对话，需要的背景应明确提供。
- 每次调用启动新的 Pi RPC 子进程、创建新的内存会话，等待最终答案返回；不复用会话、不返回后台任务句柄。
- 沿用主 agent 的工作目录、环境、项目信任状态和当前模型/思考级别；通过常规配置发现、显式扩展参数和工具/命令来源重新加载扩展，并重放可获取的扩展 CLI flags。
- 加载完整的继承工具集合，再恢复主 agent 的当前启用状态；保留 `tool_search` / `codemode` 可发现的工具。MCP 使用同一配置重新连接，不共享主进程连接或缓存。
- **子 agent 不注册 `delegate`**，不能通过模型声明、工具搜索或 `codemode` 调用它；扩展本身仍会加载。
- 子进程就绪后检查工具是否缺失、schema/exposure/namespace 是否不同，以及启用状态是否一致。无法重新加载的运行时工具明确报错，不静默省略、不退回代理。
- 调用取消或父会话关闭时会终止子 agent；正常完成和失败也会清理子进程与临时初始化快照。控制命令有 40 秒响应超时，工具初始化最多等待 30 秒；模型任务本身没有固定时限，可由主调用取消。
- 最终文本采用 Pi 默认输出上限（50 KB / 2000 行，任一超限即截断），返回开头的完整行预览、截断信息及完整 UTF-8 原文文件路径。超长首行可能没有预览；可通过 `read` 读取完整文件。输出文件独立于初始化快照，调用结束后仍保留，使用完毕后可删除，或交由系统临时文件维护清理。
- 委派结果统一在 `details.status` 中返回四种状态：`stop → completed`、`length → incomplete`、`error → failed`、`aborted → cancelled`。未完成结果保留部分文本并提示生成长度限制；失败和取消保留可获取的诊断、会话及 usage，并设置 `isError: true`，不再只抛异常。启动、继承和 RPC 失败也返回 `failed`；父调用取消返回 `cancelled`。尚未获取的会话/停止原因字段省略，未获取的 usage 为零。
- `incomplete` 不自动续写，也不代表运行错误（`isError: false`）。展示截断独立使用 `details.truncation` 表示；正常生成但超出展示上限时仍是 `completed`。

子进程使用已安装 Pi 宿主包中的 CLI。Node.js 宿主沿用当前 Node 可执行文件；Bun 宿主需要能从 PATH 找到 `node`。本扩展在 Pi 1.0.0 上验证。

**边界：**“继承”是正常重新初始化，不是任意内存配置、闭包或宿主私有 flags 的序列化。配置文件在启动期间应保持稳定。注册限制不是沙箱，具有 shell 工具的子 agent 仍有进程级操作权限。支持的 RPC `select` / `confirm` / `input` 会转交父会话 UI；没有 UI 时取消请求，多行 editor 请求也会取消，避免取消任务后留下不可中断的编辑器。

## 开发命令

| 命令 | 作用 |
| --- | --- |
| `bun run check` | 非写入的 Biome 格式、lint 和 import 检查，warning 也使检查失败 |
| `bun run check:fix .` | 全项目格式化、安全 lint 修复和 import 整理 |
| `bun run format` | 仅执行格式化 |
| `bun run typecheck` | 检查 `src/` 与 `tests/` 的 TypeScript 类型 |
| `bun test` | 注册矩阵、RPC 生命周期、真实 Pi/确定性模型/MCP 集成测试及隔离 Git 仓库的 hook 测试 |
| `bun run hooks:install` | 安装或更新 Lefthook 管理的 hook |

`check:fix` 也接受文件路径。自动修复不使用 `--unsafe`，无法安全修复的问题需手动处理。

## Git hook

配置位于 `lefthook.yml`，**只配置 `pre-commit`，没有 `pre-push`**。提交前按顺序执行：

1. 对暂存的 Biome 支持文件自动格式化、应用安全 lint 修复并整理 imports。
2. 使用 Lefthook 的 `stage_fixed: true` 将修复后的文件重新暂存。
3. 对全项目执行 TypeScript 类型检查，包括未暂存的源文件和测试文件。

仍有 lint error/warning 或类型错误时提交失败。自动修复可能在失败前已经修改工作区，请检查 diff 后再提交。仅提交 Markdown/YAML 等 Biome 不支持的文件时会跳过 Biome，但仍执行类型检查。测试通过 `bun test` 手动运行，不配置到其他 hook。

**部分暂存注意事项：** 此配置处理工作区中的整个文件并重新暂存，因此同一文件里的未暂存修改可能一起进入提交。使用 `git add -p` 时，请先保存这些修改，提交前检查 `git diff --cached`；此配置不承诺保留部分暂存边界。

hook 集成测试仅在临时 Git 仓库中创建测试提交，不修改本项目的 Git index 或历史。当前验证不包含需要模型凭证的模型调用端到端测试。

## 目录

```text
src/index.ts             # Pi extension 入口
tests/                   # Bun 测试
biome.json               # Biome 配置
lefthook.yml             # Lefthook pre-commit 配置
tsconfig.json            # TypeScript 配置
bun.lock                 # Bun 依赖锁
```

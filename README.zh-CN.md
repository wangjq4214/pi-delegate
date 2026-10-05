# Pi workspace

[English](README.md) | [简体中文](README.zh-CN.md)

这是一个使用 Bun + TypeScript 的 monorepo，包含两个独立包：

| 包 | 用途 | 状态 |
| --- | --- | --- |
| [`@wangjq4214/pi-delegate`](packages/pi-delegate/README.zh-CN.md) | 通过 RPC 委派子代理的 Pi 扩展 | 保留现有扩展、npm 包名和行为 |
| [`@wangjq4214/pi-open-tui`](packages/pi-open-tui/README.md) | 重写 Pi 终端 UI 的独立应用 | 目前仅有应用骨架，private，尚不发布 |

`pi-open-tui` 不是 delegate UI 的抽取。两个包互不依赖，本次不引入共享运行时包或 Turbo/Nx。

## 开发

使用 Git、Bun 1.4.1 或更高版本；delegate 的 Pi 宿主/子进程及构建后的应用需要 Node.js 22.19 或更高版本。

在仓库根目录执行：

```sh
bun install --frozen-lockfile
bun run hooks:install
bun run build
bun run typecheck
bun run check
bun run test
```

`build`、`typecheck` 和 `test` 顺序执行各 workspace 的脚本，`test` 还会运行仓库级测试。请使用 **`bun run test`**，而不是在根目录直接执行 `bun test`：delegate 的 fixture 路径基于包目录。Biome 和 Git hooks 统一配置在根目录。

### 单独运行一个包

```sh
bun run --filter @wangjq4214/pi-delegate test
bun run --filter @wangjq4214/pi-open-tui dev
bun run --filter @wangjq4214/pi-open-tui build
bun run --filter @wangjq4214/pi-open-tui start
```

UI 命令目前只输出骨架提示并退出，不会启动交互式 Pi 会话。

### 加载或安装 delegate

```sh
bun run --cwd packages/pi-delegate pi --extension ./src/index.ts
# 安装了 Pi CLI 时，先构建，再执行：
pi install /absolute/path/to/checkout/packages/pi-delegate
# 原有 npm 安装方式不变：
pi install npm:@wangjq4214/pi-delegate
```

根目录是 private workspace，不是 Pi package。delegate 的构建、打包和发布在 `packages/pi-delegate` 中进行；manifest 保留扩展入口和随包提供的 worktree skill。

## 目录结构

```text
packages/
  pi-delegate/       扩展源码、测试、skills、文档和构建配置
  pi-open-tui/       独立应用入口、测试和构建配置
tests/               仓库级 Git-hook 和 workspace 测试
.grimoire/           项目需求和架构记录
package.json         Private workspace 根配置和共享开发工具
tsconfig.base.json   共享 TypeScript 编译选项
tsconfig.json        仓库级测试的类型检查
biome.json           仓库级格式化和 lint 配置
lefthook.yml         仓库级 pre-commit hook
bun.lock             统一的 workspace 锁文件
```

运行时验证与 Git-hook 限制见 [delegate 开发指南](packages/pi-delegate/docs/development.md)。修改契约前请查阅相关 `.grimoire/` 记录。

## 许可证

仓库目前没有许可证文件，尚未指定许可条款。

# pi-delegate

最小 Pi TypeScript extension 项目，使用 Bun 管理依赖、Biome 检查和格式化，以及 Lefthook 管理 Git hooks。当前仅提供 `/hello` 示例命令，不包含委派等业务功能。

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

在 Pi 交互界面输入 `/hello` 或 `/hello Derek`，会显示问候通知。没有 UI 的模式下，该示例命令不会访问 UI。修改入口后可使用 Pi 的 `/reload`。

`package.json` 的 `pi.extensions` 声明了入口，也可以将本目录作为本地 Pi package 使用：

```sh
pi install /absolute/path/to/pi-delegate
```

本地 package 的依赖需由开发者通过 Bun 安装。Pi 宿主依赖声明在 `peerDependencies`，并作为开发依赖提供本地类型；不将宿主模块打包进扩展。当前项目为 `private`，不会意外发布到 npm。

## 开发命令

| 命令 | 作用 |
| --- | --- |
| `bun run check` | 非写入的 Biome 格式、lint 和 import 检查，warning 也使检查失败 |
| `bun run check:fix .` | 全项目格式化、安全 lint 修复和 import 整理 |
| `bun run format` | 仅执行格式化 |
| `bun run typecheck` | 检查 `src/` 与 `tests/` 的 TypeScript 类型 |
| `bun test` | 扩展示例测试及隔离 Git 仓库的 hook 集成测试 |
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

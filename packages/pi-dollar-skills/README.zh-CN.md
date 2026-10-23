# pi-dollar-skills

[English](README.md) | [简体中文](README.zh-CN.md)

独立的 Pi 扩展，提供类似 Codex 的 skill 选择方式：`/` 保留普通命令、隐藏 skill 候选；输入 `$` 列出 skill 名称及描述。选中后插入 `$skill-name`，不会立即发送；提交时将完整 skill 文件及其位置注入模型上下文。

## 试用

已针对 Pi 1.4.0 验证，使用公开的 `addAutocompleteProvider` 和自定义补全触发字符接口。缺少该 UI 接口的旧宿主会收到提示，不会尝试修补编辑器。SDK 由 Pi 提供，不打包进扩展。

在仓库根目录运行，保持当前工作目录：

```sh
pi -e ./packages/pi-dollar-skills/src/index.ts
# 或构建后加载：
bun run --filter @wangjq4214/pi-dollar-skills build
pi -e ./packages/pi-dollar-skills/dist/index.js
```

当前包为 private，尚未发布。以上命令不安装扩展、不修改全局设置。不要同时加载源码与构建产物。

## 使用方式

输入 `$`，继续输入可按名称筛选，然后使用编辑器原有选择键（通常为方向键、Tab 或 Enter）。选中不发送，可以继续输入需求，再正常提交：

```text
用 $grimoire-review 和 $grimoire-test 检查这些修改
```

- 引用位于文本开头或空白之后；skill 名精确匹配已加载的名称，后面可接常见结束标点。
- 代码块、行内代码和转义的 `$` 保持字面含义；未知名称原样保留。可以用 `\$skill-name` 或行内代码引用已知名称而不加载。
- 一条消息支持多个 skill，按首次出现顺序加载；同名引用在本次提交中只加载一次。提交时重新读取完整文件（含 frontmatter），附带文件位置和相对引用目录；保留原始需求与图片，由 Pi 继续处理。
- `/` 命令和 `!` shell 请求保留宿主语义，普通提示词才执行 `$` 注入。手动输入 `/skill:name` 仍然可用，只是不出现在候选列表。
- 使用 Pi 当前会话提供的 skill，包含配置路径和包提供的 skill；不卸载 skill，不改变模型自动匹配能力，不改写设置。
- 文件读取失败时停止本次提交，不发送半套上下文。交互编辑器为空时恢复需求文本，不覆盖较新的草稿。扩展不恢复编辑器里的图片；若宿主已消费附件，重试时需重新附加。
- 通过宿主补全组合接口工作，不替换原生/Open TUI 编辑器，不修补全局原型、不修改 Pi 安装文件。`/reload` 使用宿主原有扩展/UI 清理流程。

## 开发与验证边界

```sh
bun run --filter @wangjq4214/pi-dollar-skills typecheck
bun run --filter @wangjq4214/pi-dollar-skills test
bun run --filter @wangjq4214/pi-dollar-skills build
```

测试覆盖解析、无损补全、真实 SDK/资源加载/扩展提交流程向离线 provider 发送上下文（含图片和失败处理），以及原生和 Open TUI 编辑器的实际按键路径。编辑器测试控制终端调度与 UI 挂载桥接，不等于真实终端的像素或输入法验证。Open TUI 仅作为测试协作者，不是运行时依赖；实际显示和输入法表现需本地试用。

本次不发布 npm 包、不修改用户配置。契约见 [spec 0015](../../.grimoire/spec/0015-dollar-skill-invocation.md) 和 [ADR 0026](../../.grimoire/adr/0026-independent-dollar-skill-extension.md)。

## 许可证

[MIT](../../LICENSE)。

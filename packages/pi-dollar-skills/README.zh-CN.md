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

包已配置为可公开发布到 npm；首次发布和 Trusted Publisher 配置仍需维护者完成，以上命令不会执行这些操作。发布后可用 `pi install npm:@wangjq4214/pi-dollar-skills` 安装。不要同时加载源码与构建产物。

## 使用方式

输入 `$`，继续输入可按名称筛选，然后使用编辑器原有选择键（通常为方向键、Tab 或 Enter）。选中不发送，可以继续输入需求，再正常提交：

```text
用 $grimoire-review 和 $grimoire-test 检查这些修改
```

- 引用位于文本开头或空白之后；skill 名精确匹配已加载的名称，后面可接常见结束标点。
- 代码块、行内代码和转义的 `$` 保持字面含义；未知名称原样保留。可以用 `\$skill-name` 或行内代码引用已知名称而不加载。
- 一条消息支持多个 skill，按首次出现顺序加载；同名引用在本次提交中只加载一次。提交时重新读取完整文件（含 frontmatter），附带文件位置和相对引用目录；保留原始需求与图片，由 Pi 继续处理。
- 交互模式下，多个 skill 各自显示原生 Pi skill 卡片，用户正文单独显示。全屏模式可点击单张卡片独立展开，也可用 Pi 原有展开快捷键（通常为 Ctrl+O）统一展开/折叠。Open TUI 的紧凑布局与 User 消息边框仍能作用于这些原生组件。
- 新的多 skill UI 消息保存提交时的快照，回放不重新读取已修改的 skill 文件；不改写旧版本已有的消息。恢复会话时请保持扩展已加载，否则 Pi 会退回显示完整存储内容。
- `/` 命令和 `!` shell 请求保留宿主语义，普通提示词才执行 `$` 注入。手动输入 `/skill:name` 仍然可用，只是不出现在候选列表。
- 使用 Pi 当前会话提供的 skill，包含配置路径和包提供的 skill；不卸载 skill，不改变模型自动匹配能力，不改写设置。
- 文件读取失败时停止本次提交，不发送半套上下文。交互编辑器为空时恢复需求文本，不覆盖较新的草稿。扩展不恢复编辑器里的图片；若宿主已消费附件，重试时需重新附加。
- 通过宿主补全组合接口工作，不替换原生/Open TUI 编辑器，不修补全局原型、不修改 Pi 安装文件。`/reload` 使用宿主原有扩展/UI 清理流程。

## 集成说明

交互模式的多个不同 skill 通过一条公开 custom 会话消息提交，由 Pi 公开导出的 skill/User 组件组合显示。Pi 将其中的完整指令、需求与图片转换为一条面向模型的 User 消息，steering/follow-up 排队也保持整体投递。空闲时提交会使宿主 `before_agent_start` 事件标记为 `messageType: "custom"`，扩展会消费该输入（`handled`）；仅处理普通 User 输入钩子或会话条目的其他扩展需考虑这一差异。单 skill 和非 TUI 模式仍走普通输入变换流程。不增加 Open TUI 运行时依赖，也不导入宿主私有组件路径。

## 开发与验证边界

```sh
bun run --filter @wangjq4214/pi-dollar-skills typecheck
bun run --filter @wangjq4214/pi-dollar-skills test
bun run --filter @wangjq4214/pi-dollar-skills build
```

测试覆盖解析、无损补全、真实 SDK/资源加载/扩展提交流程向离线 provider 发送上下文（含图片、失败处理、steering/follow-up 与 RPC），原生/Open TUI 编辑器按键路径，原生多卡片渲染、独立点击/统一展开、快照回放，以及常规/全屏宿主渲染器中的 Open TUI 布局适配（含边框、主题/边距/宽度变化和清理）。测试控制终端调度与 UI 挂载，不等于真实终端的像素或输入法验证。Open TUI 仅作为测试协作者，不是运行时依赖；实际显示和输入法表现需本地试用。

运行时契约见 [spec 0015](../../.grimoire/spec/0015-dollar-skill-invocation.md) 和 [ADR 0026](../../.grimoire/adr/0026-independent-dollar-skill-extension.md)。公开发布由 [ADR 0030](../../.grimoire/adr/0030-public-workspace-trusted-publishing.md) 单独授权，操作步骤见仓库 [发布指南](../../docs/releasing.md)。本次实现不执行实际发布或修改账号配置。

## 许可证

[MIT](../../LICENSE)。

# Roadmap

[Back to README](../README.md) · [Development](development.md)

Unchecked items are unimplemented capability candidates, listed in suggested priority order. Behavior, defaults, and interfaces should be agreed before implementation. This list is not a release commitment. Tool-call and user-message improvements remain exploratory directions.

## TODO

- [ ] **Trustworthy run outcomes:** distinguish completed, interrupted, and failed runs in the Workline instead of treating every stopped run as successful.
  - Use reliable host lifecycle signals; show a neutral ended state when the outcome is unknown. A failed tool call does not necessarily mean the agent run failed.
  - Preserve elapsed time, native retry/compaction semantics, and attached/detached layouts. Reset outcomes across run and session boundaries.
- [ ] **Extension status folding and filtering:** bound the space occupied by extension statuses, with configurable visibility, ordering, and pinned entries.
  - Show an overflow indicator and provide an on-demand view of full statuses. Preserve extension-provided colors and support narrow terminals.
  - Operate on generic extension status keys without depending on pi-delegate or interpreting arbitrary status text as structured task state.
- [ ] **Layout presets and focus mode:** offer Minimal, Standard, Diagnostic, and Presentation presets built from existing settings.
  - Provide a temporary focus mode that restores prior settings on exit rather than overwriting saved preferences.
  - Presentation mode can hide this extension's paths, hostname, session name, and thinking preview; it cannot promise to redact Pi's native header or transcript.
- [ ] **Recent-run telemetry:** provide an on-demand view of recent outcomes, duration, TTFT, TPS, and output tokens for the current session.
  - Keep bounded in-memory history, preserve existing measurement definitions, and distinguish missing measurements from zero. Do not retain prompts, tool contents, or reasoning text.
  - Avoid cross-session persistence or a telemetry database in the initial version.
- [ ] **Reliable settings and diagnostics:** validate all configuration fields, save safely, and report persistence failures instead of silently ignoring them.
  - Distinguish temporarily applied settings from saved settings; provide page-local reset and diagnostics for the configuration path, resolved icon mode, and relevant terminal capabilities.
  - Preserve existing valid configuration on failed writes and avoid exposing credentials or unrelated environment variables. Land validation and persistence foundations before or alongside features that add settings.
- [ ] **Tool-call presentation:** make calls easy to scan through concise summaries of status, tool name, target or command, and measurable elapsed time.
  - Keep successful calls compact, expose useful failure context, and retain access to full arguments and results through expansion. Preserve diffs, images, truncation notices, and saved-output paths.
  - Compose with existing tool renderers rather than replacing tool execution. Use tool-specific summaries only for recognized schemas; preserve custom rendering or conservative fallback for unknown tools.
  - Verify public renderer APIs against the supported Pi host. Consider grouping completed related calls only after individual-call rendering is stable; avoid regrouping live calls in ways that disrupt scrolling or obscure concurrent activity.
- [ ] **User-message presentation:** improve turn-boundary visibility with restrained colors and spacing, and explore reversible long-message folding and compact attachment summaries.
  - Keep stored and model-facing content unchanged. Hidden content must be explicitly indicated and fully recoverable; attachments must remain discoverable.
  - Proper per-message folding or custom message containers may require a Pi host extension point. Theme changes and display-Markdown transformations are not substitutes for native expansion state; do not rewrite user messages into custom entries or rely on private patches.
  - Show queued, steering, or follow-up states only when the host exposes reliable metadata. Copy/edit/resend controls and per-message shortcuts need separate interaction and API review.

# Universal compact Open TUI tool calls with observable codemode execution

**Spec ID:** 0011
**Status:** Draft
**Date:** 2026-10-12
**Sources:** Accepted refinement contract H1–H7 below; [Open TUI roadmap](../../packages/pi-open-tui/docs/roadmap.md#todo); [ADR 0018](../adr/0018-public-host-tool-renderer-composition.md); [ADR 0019](../adr/0019-universal-tool-presentation-with-specialized-composition.md).

## Source and coordination boundary

- **H1 — Intent:** The user requested improved tool-call presentation in `packages/pi-open-tui/`. The coordinator recommended compact, scannable, expandable presentation: status, tool name, target/command, reliable result summary and measurable duration; compact successes, useful failure context, preservation of detailed renderers and important outputs. The user accepted: “Proceed as recommended and upgrade the workspace's Pi version” (translated).
- **H2 — Host and scope:** The accepted recommendation uses the public Pi 1.1.0 renderer composition API, not replacement tool execution or private tool-component patches. Upgrade the workspace Pi development baseline from 1.0.0; older hosts lacking this API retain native tool presentation with an explicit capability notice. Keep packages independent. The first increment does not automatically group unrelated top-level calls.
- **H3 — Codemode:** After the user objected to ignoring codemode, the coordinator proposed one parent card containing observed child-call progress, script access and parent output. Running/failed children have priority in compact presentation; selected rows retain call order and successful overflow is indicated. Successful scripts compact child successes but retain output preview; failed/cancelled children remain distinguishable from script outcome. Do not duplicate child calls as top-level messages, fabricate total progress percentages or sum parallel durations. Expand the full script and available parent content plus host-provided child records, while acknowledging host-truncated child metadata and absent raw child results. Do not additionally cache every child's raw output. Preserve host-provided model-call status, model identity and cost. The user accepted the complete proposal, including its raw-output limitation, with “Yes!” (translated).
- **H4 — Endpoint and permissions:** Produce and verify one requirements spec after recording qualifying knowledge. No ticket decomposition, implementation plan, production/test edits, dependency installation or QA execution in this stage. The subsequent “.” adds no requirement. Consume settled requirements and established solution choices; organize and express them without inventing domain facts, requirements, constraints, acceptance semantics, architecture or unconfirmed assumptions. Trace material claims to this handoff or inspected sources. A needed new fact/decision returns to refinement before artifact work resumes; formatting is not permission to fill semantic gaps. Return at the spec-only endpoint.
- **H5 — Universal coverage revision:** The user rejected the eight-native-tool coverage boundary: “All other tool calls must be covered too, not just these” (translated). They accepted the coordinator's “generic styling fallback + tool-specific enhancements” (translated) proposal with “Yes” (translated): cover native, editing/search, delegate, computer-use, MCP and other extension tools, including future tools without a styling-name allowlist; provide unified status/name/argument summary, available timing, output/error preview and expansion; add verified tool-specific enhancements; use conservative generic summaries for unknown semantics instead of bypassing styling; preserve specialized output, buttons, images, interactions and important metadata. Codemode's host-observed children receive unified rows without extra raw-result retention.
- **H6 — Revision endpoint and permissions:** The same acceptance selects revision of this existing spec after recording the qualifying boundary change in ADR 0019. No ticket decomposition, implementation plan, production/test changes, dependency installation or QA execution. H1–H4 remain historical sources; H5 replaces their unknown-schema/specialized-renderer styling exemption, not their no-guessing or preservation constraints. Consume settled requirements and choices only; return needed semantic decisions to refinement before continuing.
- **H7 — Fold tool-result warnings with compact details:** The user requested: “In packages/pi-open-tui/, warnings should also be hidden while tool calls are collapsed in compact mode” (translated). The coordinator scoped this to tool-result warnings/notices, including truncation warnings, result-count limits and saved full-output paths: hide them while the Tool layout is compact and the call is not expanded; retain access after expansion without deleting original result data. Real execution-error context, normal presentation and global capability notices are unchanged. The user accepted with “Yes” (translated), selecting revision of this existing spec only, without new tickets, an implementation plan, code/test edits or QA execution. H7 replaces R3's earlier requirement that these notices/paths remain visible in the collapsed compact view, not its recoverability guarantee or the architectural boundaries. Current read-only evidence: `tool-presentation.ts` (`compose`) hides completed successful output in compact layout but still unconditionally adds `renderNotices()` in the collapsed result branch; `tool-presentation-policy.ts` (`renderNotices`) extracts structured truncation/limit metadata, saved paths and known textual tail notices. Existing `tool-presentation.integration.test.ts` fixtures assert visible compact truncation notices/paths; those assertions are prior-behavior evidence, not acceptance of H7 or a test run in this refinement.
- **K — Durable boundaries:** [ADR 0018](../adr/0018-public-host-tool-renderer-composition.md) records public renderer composition, workspace host upgrade and codemode parent/metadata ownership without additional nested raw-result retention. It partially supersedes only [ADR 0011](../adr/0011-import-upstream-open-tui-extension.md)'s Pi SDK 1.0.0 development pin. [ADR 0019](../adr/0019-universal-tool-presentation-with-specialized-composition.md) partially supersedes ADR 0018's unknown-schema/specialized-renderer exclusion: all tools receive generic presentation, verified schemas may add specialized enhancements, and existing renderer capabilities remain accessible. [ADR 0013](../adr/0013-host-evidenced-open-tui-run-outcomes.md) retains the distinction between individual tool errors, host-run completion and user-task acceptance. Existing cursor adaptations in [ADR 0015](../adr/0015-extension-local-cursor-output-adaptation.md) are not expanded by this feature.
- **S — Historical repository surfaces for H1–H6:** The initial refinement inspected lifecycle/configuration, package guidelines and manifests before tool presentation was implemented. For the H5/H6 revision, [tool-presentation.ts](../../packages/pi-open-tui/src/tool-presentation.ts) identifies eight host-native definitions and returns unrecognized or specialized renderers unchanged; [index.ts](../../packages/pi-open-tui/src/index.ts) now constructs that resolver and observes execution/session lifecycle. [Existing integration fixtures](../../packages/pi-open-tui/tests/tool-presentation.integration.test.ts) include native and specialized renderer composition; they are source evidence, not a test run in this refinement. [config.ts](../../packages/pi-open-tui/src/config.ts) owns preferences; [Chinese README](../../packages/pi-open-tui/README.zh-CN.md) documents settings, presentation, icon modes and Workline. [Package guidelines](../../packages/pi-open-tui/AGENTS.md) require independence, aligned bilingual READMEs, shared lockfile and focused tests. Both [Open TUI manifest](../../packages/pi-open-tui/package.json) and [delegate manifest](../../packages/pi-delegate/package.json) now pin Pi development SDKs to 1.1.0. Existing source realizes a recognized-native-only increment, not H5's universal coverage or proof of acceptance.
- **P — Historical host evidence from initial refinement:** Read-only inspection of installed Pi coding-agent 1.1.0 confirmed `registerToolRenderer`, `ToolRendererResolver` and `next()` in `dist/core/extensions/types.d.ts` and `runner.js`; the then-workspace Pi 1.0.0 lacked that registration API. Installed `docs/extensions.md` and `docs/tui.md` described renderer composition, expansion, partial results, modes and width-safe rendering. Installed codemode `tool.d.ts`, `renderer.js`, `execute.js` and `docs/codemode.md` showed `details.calls` streaming child records with name, compact/truncated argument text, status, completion duration and optional error/cost, but no full child results. Arguments were truncated to a 200-character preview and errors to a 500-character preview in that inspected host; these are host limits, not new extension limits. Evidence root: `C:/Users/Derek Wang/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/`. Workspace evidence root: `packages/pi-open-tui/node_modules/@earendil-works/pi-coding-agent/`. These historical observations are retained, not relabeled as new SDK verification in this revision.

No blocking choice remains. Exact glyphs, preview line/row budgets, configuration key spelling, settings placement, refresh interval and internal module organization are reversible implementation details; this spec does not invent numeric acceptance thresholds or new public tool inputs for them. “Card” means one tool presentation, not a mandated decorative box or a new transcript entry.

**Related contract (2026-10-13):** [Spec 0013](./0013-configurable-tool-call-box-borders.md) now governs independent User/Skill versus Tool presentation settings, optional four-sided borders, the captured new-install default baseline, and preservation of existing configuration on upgrade. Its new defaults must not override existing users' settings. This spec continues to govern universal Tool content/coverage, host integration and codemode semantics; it does not prescribe the shared `messageLayout` control.

## Requirements

### R1 — Presentation-only integration and host baseline

- Use Pi 1.1.0's public `registerToolRenderer` composition capability for enhanced presentation. Upgrade the workspace Pi development SDK baseline from 1.0.0 to 1.1.0 consistently across its packages and shared lockfile; preserve independent packages and external host SDK bundling.
- Do not re-register tools solely for styling, replace their execution, patch private tool components or change model-facing arguments/results, permission checks, concurrency, execution outcomes, transcript entries or usage accounting.
- Compose a universal generic presentation layer with existing renderers. Unknown schemas, unfamiliar names and specialized third-party presentations must not be excluded from basic styling. Add tool-specific summaries only for verified semantics; do not assume a tool's name alone proves its argument/result schema. Existing renderer output and capabilities remain accessible under R3.
- On hosts without the public capability, preserve native tool presentation and provide an explicit enhancement-unavailable notice without interrupting tool execution. Package compatibility declarations/documentation must accurately describe this fallback, not imply that Pi 1.0.0 has the new rendering capability.
- The workspace upgrade includes compatibility verification for pi-delegate and Open TUI; it does not authorize unrelated delegate features or a package dependency between them.

**Trace:** H1–H2 and H5; K/ADRs 0018, 0019 and 0011; S/manifests, resolver and package guidelines; P/public API comparison.

### R2 — Universal, scannable tool summaries

- With enhanced presentation enabled on a supported host, cover every tool call presented by that host: native tools, editing/search extensions, delegate tools, computer-use, MCP and other extension tools. This includes tools without dedicated renderers or recognized schemas and future tools without adding their names to a styling allowlist. Examples include `replace`, `replace_match`, `insert`, `copy`, `move`, `ffgrep`, `fffind` and `delegate*`; these illustrate coverage, not a closed list.
- Order available summary information as status, tool name, target/command or generic argument summary, available result/output or error preview, measurable duration and detailed expansion access. Summaries describe actual available arguments/results, not invented conclusions. Unknown semantics receive a conservative generic argument/result summary rather than bypassing unified presentation; known schemas may enhance the summary, such as edit diffs or search pattern/path.
- Ordinary successful calls are compact by default; a small useful preview is allowed. Failures retain short useful error context and a visible path to detailed content, not just a colored error icon.
- Use restrained theme-aware styling: emphasize the target, de-emphasize duration, and distinguish outcomes with both symbols/text and color. Honor the extension's existing Nerd/Unicode/ASCII icon modes and `auto` resolution rather than requiring a new font.
- Classify tool errors from reliable host error evidence, not keyword searches in arbitrary output. Do not classify overall Workline outcomes from individual tool failures.
- Show elapsed time only where it can be measured or the host supplies it. Historical or otherwise unavailable timings must not be fabricated as zero or recreated from the current render time.

**Trace:** H1 and H5; K/ADRs 0018, 0019 and 0013; S/resolver, README icon and Workline semantics; P/renderer context and execution events.

### R3 — Recoverable details and important output

- Preserve access through expansion to detailed arguments/results and existing detailed renderer behavior. Content hidden by this extension's compact view must be recoverable; an expanded view must not apply another undisclosed compact-preview limit.
- For edits, retain diff preview and access to the detailed diff rather than replacing it with only an applied/success label. Preserve existing images and their show/hide behavior.
- With enhanced Tool presentation enabled and the Tool layout set to compact, an unexpanded call must fold tool-result warnings/notices and saved full-output paths into its details instead of displaying them separately. This includes truncation warnings, result-count/entry/line-limit notices and known textual tail notices, whether supplied in result text or structured metadata. The rule applies to ordinary tools and codemode parent results; do not leak folded notices/paths back into a compact summary or preview.
- Expansion must expose the retained tool-result warnings/notices and available full-output file paths alongside the available detailed result, including notices/paths supplied only in structured metadata. Collapsing again hides them again. This is presentation-only hiding: preserve original result data and file access; expansion cannot restore content already omitted by the host.
- This warning-folding rule does not suppress real execution-error context required by R2/R6, change normal Tool layout behavior, or hide global capability/fallback notices. It does not change codemode child activity/outcome semantics or introduce a general warning filter for arbitrary output.
- Preserve existing third-party renderer output, buttons, images, interactions, controls and important metadata as usable capabilities, not merely labels copied into a text preview. Provide unified presentation without removing access to specialized functionality. Unknown schemas or specialized renderers are not exemptions from styling; neither compact summaries nor expansion may silently discard their useful content or capabilities.
- These guarantees concern ordinary tool presentation and codemode's parent content. Codemode child metadata/results have the explicit R6 limitations below.

**Trace:** H1, H3, H5 and H7; S/roadmap preservation requirements and existing renderer fixtures; K/ADRs 0018 and 0019; P/existing renderers and codemode output handling.

### R4 — Stable running presentation

- Keep active calls in their owning presentation; do not automatically merge unrelated top-level calls, rearrange their transcript order or regroup live activity.
- Update running status and measurable elapsed time without requiring a height-changing presentation for every output fragment. Favor stable compact layout and restrained refresh rather than additional prominent animation.
- Distinct concurrent parent calls must not share progress, errors or timing. Retained observations must not leak across session replacement/reload or branch navigation into another call.
- Fit the available terminal width using display-column-aware handling, including Chinese, wide/combining characters and emoji. Preserve expansion/input behavior and render correctly after resize/theme changes in regular and fullscreen modes.

**Trace:** H1–H3; S/roadmap live grouping caution and existing lifecycle; P/TUI width, invalidation and mode contracts. Isolation is required for accurate per-call summaries, not a new persistent history feature.

### R5 — Codemode as one observable parent presentation

- Treat recognized host codemode as a dedicated parent presentation, not a generic one-line tool and not an ignored special case. Compose with its existing renderer for detailed script/output behavior.
- In compact running presentation, make observed child-call progress primary; the script is secondary, with a concise access/preview and expansion indication rather than the existing long default code block.
- Report observed child counts/statuses without assuming the script's final number of calls. Do not present a completion percentage based on the currently observed count.
- Apply unified child-row styling to all host-observed calls, regardless of tool name, source or schema recognition. Present child tool name, schema-recognized target/command or conservative available argument summary, reliable status and available duration. Unknown child semantics do not exclude a record or authorize guessed details. Give running and failed children priority in the compact view, retain the original call order among selected rows, and indicate successful/other overflow. Where all important rows cannot fit, hidden activity/failure must remain discoverable rather than silently excluded.
- Nest children within their own parent; do not append copied child tool messages/rows at top level. Preserve the host's execution/transcript/model-facing semantics.
- On successful script completion, compact successful child details while retaining a short preview of actual script output and access to available child records and the script. Do not invent a semantic summary of the script's intent or output.
- Parent elapsed time describes the script's wall time, not a sum of concurrent child durations. Missing child durations remain unavailable, not zero.

**Trace:** H3 and H5; K/ADRs 0018 and 0019; P/codemode streaming details and existing renderer.

### R6 — Codemode outcomes, expansion and data limits

- Keep script outcome, child-call outcomes and overall Agent-run outcome distinct. A script completed via `Promise.allSettled()` or equivalent handling may contain failed/cancelled children. Its presentation must not report all children successful, and child failures alone must not falsely mark the script or Agent run failed.
- Preserve discoverable failed-child context even when the script succeeds. On script failure, retain available partial parent output and error context; do not imply earlier tool side effects were undone.
- Expansion exposes the complete available script and parent returned content, plus all available host-provided child records. Explicitly communicate that child argument/error records are summaries and can already be truncated by the host; do not label them complete raw arguments/errors/results.
- Do not additionally cache every child's raw output, reconstruct absent child results, persist a separate nested-result archive or change what the script returns to the model. If a script reads files but only returns a count, expansion does not promise to recover those file contents.
- Preserve parent images, output previews, truncation metadata and full-output file paths under R3. Host-provided model-call records such as `models.classify()` and `models.generateImages()` retain available status, model identity and cost; they must not be misrepresented as no observed activity merely because they are not `tools.*` calls.
- If the available schema does not establish recognized codemode details, retain unified generic tool presentation and access to the existing detailed renderer under R1/R3. Do not guess child records, script state or results from text. Coverage extends to host-observed records, not fabricated absent activity or raw results.

**Trace:** H3 and H5; K/ADRs 0018, 0019 and 0013; P/codemode result/schema, error/side-effect and model-call semantics.

### R7 — Settings and discoverable limitations

- Provide an `/open-tui` setting to disable the tool-presentation enhancement and return to the existing host/tool rendering. Honor the extension's overall disabled state as well.
- Integrate with existing configuration validation/persistence and save-failure feedback; do not overwrite unrelated preferences. Provide English and Chinese settings text and keep the bilingual READMEs aligned.
- Explain universal generic coverage and verified tool-specific enhancements, preservation of specialized renderer capabilities, compact/expanded behavior, the public host API requirement and older-host fallback, the distinction between script and child outcomes, and the limits on codemode child metadata/raw results.
- Exact setting names and preview budgets are not extra public contracts in this spec. The accepted behavior is enhanced compact presentation with a discoverable native-presentation escape hatch.

**Trace:** H1–H3 and H5; S/configuration, README and package guidelines.

## Solution

Use a presentation-only layer composed through the supported host's renderer resolver. Every tool call receives unified generic presentation; verified schemas may add tool-specific summaries and previews without deciding coverage. Unknown schemas and specialized renderers keep conservative summaries plus accessible existing output and capabilities, rather than an entirely unenhanced fallback. Recognized codemode receives one parent presentation whose compact view emphasizes observed child activity and actual parent output, with unified styling for all available child records. Host child records are metadata, not additional transcript messages or a full nested-output store. Settings select enhanced versus native presentation; unsupported public host capability retains native rendering with an honest notice.

### Seams

| Seam | Connects | Expects | Provides |
| --- | --- | --- | --- |
| Renderer resolution | Pi/tool/other extension renderers → Open TUI → transcript rendering | Public resolver and `next()` chain; available args/result/context, partial/expanded state, current theme and available width; existing dedicated renderer or host default presentation | Universal generic styling without a name/schema allowlist, optional verified tool-specific enhancement, recoverable details and usable existing renderer capabilities; no execution re-registration. |
| Execution evidence | Host lifecycle/context → per-call presentation | Reliable call identity, parent identity where supplied, execution/error evidence and available monotonic duration | Accurate isolated status/timing; no text-derived error classification or fabricated historical timing. |
| Codemode child records | Host codemode updates/result → parent presentation | Recognized `details.calls` records with observed statuses, bounded argument/error summaries, optional duration/cost; script args and parent content | One parent-owned activity view with unified child rows for every observed tool and available expanded records, without separate child transcript messages or additional raw-result retention. |
| Preferences | `/open-tui` and existing config storage → renderer selection | Existing enabled/icon/language settings plus enhancement selection and persistence feedback | Enhanced/native selection and consistent icons/language without changing unrelated preferences. |
| Host development baseline | Shared workspace dependencies → both packages and build/runtime verification | Consistent Pi 1.1.0 development SDKs and shared lockfile; host SDKs stay external | A tested upgrade baseline, unchanged package independence and explicit older-host capability fallback. |

## End-to-End Tests

These are required future input-to-presentation scenarios, not tests run during refinement or evidence of an implemented feature.

### E1 — Ordinary success and detailed expansion

- **Given:** A recognized file-reading tool with a known target and available result content.
- **When:** It executes successfully and the user expands the completed presentation.
- **Then:** Compact presentation shows reliable status/name/target and available summary/timing, with no large default output block. Expansion recovers available arguments/content and existing detailed rendering. A call reconstructed without timing does not display a fabricated zero/current-render duration.

### E2 — Failure is actionable but not a run verdict

- **Given:** Any tool, including an unfamiliar extension tool, produces a host-marked error, followed by a normal assistant completion.
- **When:** Its presentation and the Workline render.
- **Then:** Tool failure has a distinct symbol/text and short error context with detailed access. Workline retains its own host-run evidence semantics. Conversely, successful output containing the word “error” is not falsely styled as a failed tool.

### E3 — Diff, images and truncated output survive compaction

- **Given:** Tool results include a detailed edit diff, an image, or host-truncated output with a saved full-output path.
- **When:** Compact presentation renders and the user expands/toggles images using existing host controls.
- **Then:** Diff preview/detail and image behavior remain usable. In compact Tool layout, truncation/limit notices and full-output paths are absent while the call is unexpanded, then available in expanded details and hidden again on collapse under R3. Expanded available content is not secretly constrained by the compact-preview budget, and host-omitted output is not claimed to have been restored.

### E4 — Specialized renderer and unknown schema receive unified styling

- **Given:** Another extension/MCP tool has a specialized renderer with output and usable controls/images, or a familiar tool name has an unrecognized schema.
- **When:** It executes with the enhancement enabled, and the user accesses detailed output and existing interactions; also reconstruct its available call from history.
- **Then:** Unified status/name and conservative argument/result summary remain present, not an entirely unenhanced exemption. No target/command semantics are guessed from a familiar name. Existing output, controls, images, interactions and important metadata remain accessible and usable. History without timing has no fabricated duration. Renderer composition does not replace execution, duplicate accounting or mutate content.

### E5 — Dynamic concurrent codemode calls

- **Given:** A codemode script starts concurrent child calls and conditionally starts more after receiving results.
- **When:** The script remains active and observed child records update.
- **Then:** One parent presentation shows observed counts and running/completed/error activity, not a false percentage/final total. Unified child rows cover native, extension, MCP and unfamiliar observed tool names without schema-based exclusion or guessed details. Selected child rows retain call order, activity/errors do not silently disappear into successful overflow, no duplicate top-level child messages appear, and parent wall time is not the sum of child times.

### E6 — Script succeeds with a failed or cancelled child

- **Given:** A script handles child failures with `Promise.allSettled()` and returns normally.
- **When:** Its parent result renders compactly and expands.
- **Then:** The script is completed, with failed/cancelled child counts and useful available error context, not “all successful” and not a falsely failed parent/Agent run. Expansion shows available child records and actual returned content.

### E7 — Script fails after side effects and partial output

- **Given:** A script has already executed a file mutation, emitted partial output and then fails or ends with cancelled calls.
- **When:** The parent result is displayed.
- **Then:** Available partial parent output/error and observed child outcomes remain accessible. Presentation does not claim the earlier mutation was undone or classify unknown details from output keywords.

### E8 — Expansion does not promise absent nested results

- **Given:** A script reads multiple files but returns only a count; some host child argument/error previews are truncated.
- **When:** The user expands the parent presentation, including after session reconstruction where the host retains its details.
- **Then:** The full available script/parent output and available child records are exposed with metadata-summary limitations. There is no purported full child-file viewer, extra nested-result archive, reconstruction claim or mutation of model-facing output.

### E9 — Codemode model calls, images and large parent output

- **Given:** Host codemode records classifier/image-model calls with available model/status/cost, and parent content contains images or a full-output path after truncation.
- **When:** Running, completed compact and expanded views render.
- **Then:** Available model activity is visible and actual output/imagery remains accessible. Parent truncation notices and saved full-output paths are folded in unexpanded compact Tool layout and accessible after expansion under R3, including metadata-only paths. No model-call prompt/image data is invented from metadata.

### E10 — Native fallback and settings escape hatch

- **Given:** A host lacks `registerToolRenderer`, or the user disables enhanced tool presentation/overall Open TUI.
- **When:** A tool executes and the user uses normal host/tool presentation controls.
- **Then:** Native/existing rendering and execution remain intact. An unsupported host explicitly reports the unavailable enhancement; a supported host honors the setting and existing persistence/save-failure behavior without rewriting unrelated preferences.

### E11 — Layout and ownership transitions

- **Given:** Multiple parent calls, long Chinese/emoji paths, a narrow terminal and available partial output.
- **When:** The user expands, resizes, changes theme/icon mode, changes sessions/branches or reloads in regular and fullscreen modes.
- **Then:** Rendered lines fit the supplied width; status remains understandable without color/Nerd Font alone; expansion remains usable; active parents do not share records/timing; old-call observations do not leak into new calls; existing editor, cursor and Workline behavior is not regressed by the new rendering.

### E12 — All tool-source categories receive basic styling

- **Given:** A supported host presents native tools and non-native editing/search, delegate, computer-use, MCP and other extension tools, with representative tools both with and without dedicated renderers.
- **When:** Each runs and completes, including an error, while enhanced presentation is enabled; inspect compact and expanded presentation.
- **Then:** Every call receives unified status/name, an available target or conservative generic argument summary, actual output/error preview, available timing and detailed access. No tool-source category is skipped. Verified edit/search enhancements coexist with generic coverage; execution, permissions, returned content and usage semantics remain unchanged.

### E13 — Future unfamiliar tool without allowlist changes

- **Given:** A tool with a previously unknown name/schema is newly made available through the host's supported mechanism, without adding an Open TUI-specific renderer or editing a styling-name list.
- **When:** Its call appears in the transcript with enhancement enabled, and an observed call to it also appears inside codemode.
- **Then:** The top-level call automatically receives generic unified presentation; the available child record receives unified child-row presentation within its parent. Unknown semantics do not suppress styling or fabricate targets/results. Available detailed content remains accessible, and absent raw child results remain absent under R6.

### E14 — Warning folding follows Tool layout and expansion, not result deletion

- **Given:** Enhanced Tool presentation is enabled and ordinary/native, unfamiliar extension and codemode parent results contain truncation/limit notices or saved full-output paths. Include known textual tail notices and structured metadata with no equivalent notice/path in the result text; also include a host-marked failed call with useful error context.
- **When:** Each call is shown unexpanded in compact Tool layout, expanded, and collapsed again; separately switch to normal Tool layout or disable the enhancement.
- **Then:** Unexpanded compact Tool presentation displays none of those result notices/paths, including through summaries or previews. Expansion exposes the available notices/paths and detailed result, and collapsing hides them again without mutating returned content/metadata. The failed call still displays short actionable error context. Normal layout and disabled-enhancement behavior are unchanged; the existing unsupported-host capability notice remains outside this folding rule.

## Decisions

- **Public renderer composition and upgraded workspace baseline:** H2 and ADR 0018 select Pi 1.1.0 for the inspected public seam rather than tool re-registration/private component modification. Both package development baselines are affected, but they remain independent.
- **Compact successes, useful failures, existing details:** H1 reduces transcript noise without treating minimal output as permission to discard diff/image/truncation information. H7 moves tool-result warnings/notices and saved full-output paths out of unexpanded compact Tool presentation and into recoverable expanded details; this changes visibility, not retained result data or failure semantics.
- **One codemode parent with observed activity:** H3 avoids duplicate transcript noise while retaining visibility into nested work; observed call count is not a known script plan or percentage.
- **No additional raw nested-result store:** H3 and ADR 0018 accept host metadata/output limits instead of silently caching everything. Child success/failure, parent completion and Agent-run completion stay separate.
- **Universal generic layer with verified enhancements:** H5 and ADR 0019 replace recognized-native-only coverage and unenhanced unknown/specialized fallbacks. Recognition controls optimization, not styling eligibility; existing renderer capabilities remain usable.
- **Spec only:** H4, H6 and H7 select revision of one continuing requirements contract. No implementation-plan or ticket stage is necessary for this bounded presentation change at refinement time.

## Test Plan

- Use actual supported Pi renderer integration with controlled native/extension/MCP/codemode fixtures to verify universal resolver composition, generic presentation without a dedicated renderer, partial/expanded presentation, parent/child evidence, existing controls and unsupported-host/settings fallback. Pure string snapshots alone do not establish that the host actually uses the new renderers.
- Cover every tool-source category in R2, unfamiliar and future names without allowlist edits, familiar-name/different-schema tools, specialized third-party renderers and their usable capabilities. Existing fixtures that expect other renderers to remain entirely unchanged must be revised to distinguish preserved functionality from unified styling; retained function identity alone does not establish H5 acceptance.
- For H7, revise prior compact-visible-notice/path assertions and verify E3/E9/E14 through actual renderer integration. Cover textual notices, structured truncation/limit metadata and metadata-only full-output paths in ordinary and codemode parent results, plus expand/collapse transitions, normal layout, disabled enhancement and retained real-error context. Verify folded notices/paths do not reappear through summaries/previews and result content/metadata remain unchanged. These are future verification obligations, not tests executed during this spec-only revision.
- Cover concurrent/dynamic children (including unfamiliar tools), caught errors/cancellation, parent failure, no child calls, multiple simultaneous parents, model-call records, missing timing and unrecognized detail schemas. Verify that script/model-facing content and execution/accounting remain unchanged.
- Include width/theme/icon/resize/expansion and available-history reconstruction checks. Recorded terminal output can verify layout/control behavior, not prove actual terminal/font/IME visual correctness.
- Verify the workspace upgrade with both packages' affected typecheck/build/test coverage and shared repository checks; revisit tests explicitly tied to 1.0.0 instead of relabeling their evidence as 1.1.0 without running it. Existing non-public cursor/thinking adaptations need compatibility regression coverage on the upgraded host.
- Manually inspect transcript density, failure discoverability, scrolling stability, expansion and images in both TUI modes with a live terminal. Keep unperformed manual checks explicit; no numeric refresh/latency or line-budget gate has been agreed.
- Check settings and aligned English/Chinese documentation against R1–R7, including the native escape hatch and explicit child-metadata/raw-result limits.

## Out of Scope

- Replacing tool execution, changing permissions/concurrency, altering model-facing input/output or adding child transcript messages.
- Private tool-component patches, unrelated package coupling or delegate features.
- Automatically merging/grouping unrelated top-level calls, a new execution scheduler, script analysis to guess intent/final call totals, or generated semantic output summaries.
- Additional raw child-result retention, a full nested-result archive/viewer, or recovery of content absent from host metadata/parent output.
- User/Skill presentation changes within this Tool-content spec (their independent configuration/borders are covered separately by Spec 0013), a general persistent telemetry/history system or expanded cursor adaptation scope.
- Ticket decomposition, implementation planning, implementation/dependency installation or QA execution during this selected refinement endpoint.

This revision establishes a requirements contract, not implementation or QA completion. The recognized-native-only and SDK observations in the earlier H1–H6 source history are historical evidence, not a current coverage audit. H7's current read-only renderer/fixture observations establish the warning-folding gap, not an implemented fix or passing verification. The codemode child-data limitation remains accepted, not an unresolved blocker. No additional behavioral assumption or blocking decision is required for this spec-only handoff.

# Context

## Concepts

### ThinkingPeek
- **Definition:** An Open TUI capability presenting the current assistant message's actual thinking titles as a bounded chronological tree in Pi's native collapsed thinking label. Its On/Off control replaces raw-body row modes; native expansion remains the owner of full original reasoning.
- **Synonyms:** Thinking Preview, Reasoning Peek
- **Relationships:**
  - contains DynamicSpinner
  - contains MilestoneExtraction
  - contains StreamingDuration
  - contains CollapsedThinkingSummary
  - contains SanitizedThinkingPreview
  - depends on UiRefresh

### DynamicSpinner
- **Definition:** Thinking animation driven by a demand subscription to the shared UI refresh owner, independent of stream-chunk delivery. It stops when the segment ends or is cleared; it does not own a separate periodic timer.
- **Synonyms:** Thinking Ticker, TickerTimer
- **Relationships:**
  - belongs to ThinkingPeek
  - depends on UiRefresh

### MilestoneExtraction
- **Definition:** Display-only extraction of explicit Markdown headings and step/phase titles from actual cumulative thinking, excluding ordinary guide-word prose and code examples. Titles describe model text, not verified task progress; a transition does not establish a successful earlier stage.
- **Synonyms:** Phase Extraction, Reasoning Milestone
- **Relationships:**
  - belongs to ThinkingPeek

### StreamingDuration
- **Definition:** Measured elapsed duration from the first actual thinking chunk until that segment ends, independently of tool-call and whole-run intervals. Shared refresh updates its presentation; the final duration is frozen.
- **Synonyms:** Elapsed Timing, Thinking Duration
- **Relationships:**
  - belongs to ThinkingPeek

### CollapsedThinkingSummary
- **Definition:** A single-row collapsed label retained on its own native message component after a thinking segment ends, with its latest available title, frozen measured duration and evidence-based completed/interrupted/failed/neutral-ended mark. It survives settlement and subsequent user/assistant messages while their title/timing state starts fresh; feature disablement or explicit session/UI teardown can restore native labels. It is not a cross-message progress accumulator or task-acceptance claim.
- **Synonyms:** Completed Thinking Label
- **Relationships:**
  - belongs to ThinkingPeek

### SanitizedThinkingPreview
- **Definition:** Sanitized display title text with Markdown markers and terminal control sequences removed before display-column-aware clipping. Raw reasoning-body previews are no longer shown; original reasoning remains unchanged and natively expandable.
- **Relationships:**
  - belongs to ThinkingPeek

### UiRefresh
- **Definition:** The session-scoped scheduling owner shared by extension-owned Workline, enhanced-tool elapsed presentation and thinking animation. It services cadence-aware demand, coalesces render channels and stops periodic wakeups when idle, without merging measurements or taking over external-data polling or host/third-party timers.
- **Synonyms:** Shared UI Refresh, UI Refresh Scheduler

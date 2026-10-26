# Independent User and Tool presentation configuration

**Status:** Testing
**Date:** 2026-10-13

## Context

The user found the Tool settings and Appearance's final message-layout option unclear. They requested that User message and Tool call configuration be separated, with each exposing comparable configurable presentation capabilities. In a follow-up clarification on 2026-10-13, they explicitly included skill invocation presentation in the User message configuration scope: “User message configuration must also cover skills” (translated).

Current source inspection shows that `messageLayout` drives both the User/skill adapter in `packages/pi-open-tui/src/user-message-layout.ts` and the compact Tool rail fallback in `packages/pi-open-tui/src/tool-presentation.ts` (`frame`). Tool box borders also have their own configuration. Thus separating settings labels alone would leave a shared behavior switch.

Source: the user's refinement request, “Separate User message and Tool call configuration, allowing each to configure capabilities similar to the current Tool call settings” (translated); `packages/pi-open-tui/src/config.ts`; the two presentation modules above; [ADR 0018](./0018-public-host-tool-renderer-composition.md), [ADR 0019](./0019-universal-tool-presentation-with-specialized-composition.md), and [ADR 0020](./0020-instance-local-user-message-layout-adaptation.md).

## Decision

- Give User message and Tool call presentation independent configuration ownership. Changing either category's presentation settings must not implicitly change the other category's appearance through a shared layout switch.
- Expose comparable presentation customization separately for the two categories, rather than making one category's appearance depend on the other's settings. This addresses the user's request for independent configuration and the ambiguity of the existing shared message-layout control.
- The User-owned configuration scope includes ordinary User messages and skill invocation cards. Skill presentation is handled within this scope, not omitted from customization or assigned to Tool configuration.
- Upgrading must not alter an existing user's configuration or its effective presentation. New defaults must not overwrite existing preferences. This preservation constraint was explicitly confirmed on 2026-10-13: “Upgrades must not change user configuration” (translated).
- This configuration boundary does not replace the existing renderer integration boundaries: Tool composition remains subject to ADRs 0018/0019; User adaptation remains subject to ADR 0020.

## Consequences

- Separating UI labels without separating the underlying shared behavior is insufficient.
- Detailed presentation controls, the default-value snapshot, and existing-configuration migration semantics belong in [Spec 0013](../spec/0013-configurable-tool-call-box-borders.md), not this architectural record. The user selected the spec-only endpoint on 2026-10-13.
- No implementation or verification is claimed. In a clarification on 2026-10-13, the user selected their currently active configuration as the new default baseline. The persisted configuration was read from `C:/Users/Derek Wang/.pi/agent/open-tui.json`; its concrete values remain task requirements rather than architectural decisions.

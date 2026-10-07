# Changelog

## 0.9.0 (unreleased)

- Added a committed dependency lockfile and aligned source setup, CI and desktop packaging on `npm ci` for reproducible installs.
- Simplified setup and distribution documentation to focus on usage, validation and release preparation.
- Added guided disposable-pilot creation in the cockpit using the selected Forge host, with native configuration/destination pickers, an immutable image ID and explicit capability review. Draft inputs are never automatically activated or approved.
- Pinned pilot templates alongside host code, added platform/runtime guidance at the entry point, and documented evaluation source pairs and remaining qualification work.
- Removed repeated introductory copy and updated the in-app quickstart to use the pilot generator.

- Rebuilt Pipeline configuration around the cockpit theme, a setup hub, visible Copilot/Claude runtime installation/connection controls and in-app quickstarts. Added a standalone README review example and a complete first-use guide.
- Canonical agent discovery prefers `agents/`; Claude session definitions and temporary Copilot adapters consume the same library and relevant root skills. Removed the requirement for committed runtime mirrors, with duplicate/symlink checks and worktree restoration tests.
- Host registration now pins canonical skills, entry instructions and conventions as well as agent/host code.

- Added an opt-in Forge cockpit: durable local history, all nine stages, criterion/test/log trace, read-only patch/artifacts, filtered events, comparison and exact checkpoint review.
- Added a native bridge to independently selected/pinned Forge code, Python and operator inputs. Imported bundles remain read-only and cannot authorize host actions.
- Added host-owned cancellation, checkpoint restoration and bounded remediation controls; source review/publication remain manual.
- Persisted non-secret project-facts drafts; imported profiles preserve modules, decisions and source references with field-change review and renewed export acknowledgement.
- Unified Guided/Advanced evaluated permission disclosures and hardened IPC senders/navigation, child environments, credential storage/binding, evidence paths and folder opening.
- Added themes, keyboard tabs, focus-managed command palette/dialogs, interaction/security tests, Chromium screenshots and an opt-in signing/notarization packaging path with checksums/source revision.

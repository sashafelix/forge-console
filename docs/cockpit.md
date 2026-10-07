# Forge run cockpit

Open **Forge cockpit** from the guided workbench or configuration header. The [quickstart](quickstart.md) walks through first-use setup and evidence inspection. This is the opt-in integration with Forge's governed Python host. The existing standalone agent workbench remains available separately.

## Choose a mode

| Mode | What Console does | Authority |
| --- | --- | --- |
| Inspect evidence bundle | Reads an explicitly selected directory; shows stages, criterion/test/log links, commands, artifacts and a text diff if present | Imported evidence is read-only. Labels, approvals and signatures do not authorize execution. |
| New governed run | Registers reviewed Forge code/Python and operator inputs; launches the host CLI and follows its state/events | The separately selected host owns stages, scopes, checkpoints, receipts and recovery. |
| Standalone workflow | Uses existing Claude Code/Copilot controllers | Shows evaluated shell/network/write/tool/credential permissions; a worktree is not an OS sandbox. |

The bundled Forge pack and recognised RGR agent definitions remain blocked in generic execution controllers. The cockpit is the separate governed path; renaming an arbitrary agent is not a security boundary.

## Inspect an existing run

Choose **Inspect evidence bundle** and select a run's `bundle` directory, a legacy canonical evidence directory or an independently verified/extracted portable export. Console does not extract or execute archives. Use Forge's `verify-export-bundle.py` before extracting a shared archive with a trusted utility. The portable source-free export excludes `changes.patch`; the Diff tab needs a separately reviewed local patch.

The overview shows all nine stages and reports the evidence level explicitly:

- **Unverified evidence:** missing or inconsistent files/metadata are listed.
- **Evidence files checked:** bounded file/reference/hash/history checks passed. This is limited inspection, not the complete Python contract validator or authenticated execution.
- **Local host receipts verified:** a managed completed run additionally reconciles with the separately registered private host ledger and current independently tested patch.

Evidence connects each criterion to locked test IDs and logs. Clicking a reference opens a read-only preview; detected credentials are masked and the number of redactions is shown. Raw files remain unchanged for canonical validation. Detection is pattern-based and cannot guarantee that unknown secrets are hidden.

Diff shows changed text files and a unified patch. Events support stage/text filtering and cursor pagination. Compare shows exact run metadata and criterion status; differing baselines are highlighted. It is not a statistical model benchmark. Use Forge's paired evaluation harness for that.

## Prepare a governed run

1. Install the Forge revision containing `scripts/forge-host.py`, Python 3.11+ and a reachable Linux Docker engine. Provision the target's test dependencies in a reviewed immutable image. The host never pulls/builds an image or falls back to a host shell. On Windows, run the CLI host in WSL; launching it through this native bridge is not yet supported.
2. In **New governed run**, select the trusted Forge checkout and Python executable through native dialogs. Console fingerprints host source/contracts, canonical agents/skills, entry instructions, conventions and Python; changed code requires renewed selection/review. Checkout bytecode is excluded from execution via a fresh Python cache prefix.
3. For a first run, open **First run? Create a disposable pilot**. Provide a reviewed immutable Python image ID, exported model configuration and a new destination. Forge generates the sample target and draft operator files; follow its `SETUP.md` and capability worksheet. Then select four independently reviewed JSON files: runtime configuration, execution policy, capability inventory and story risk facts. Their bytes are pinned. Probe results never register capabilities. Follow [the guided pilot](https://github.com/sashafelix/forge/blob/main/docs/getting-started/governed-pilot.md) for qualification and expected results, or [the host reference](https://github.com/sashafelix/forge/blob/main/docs/governed-host.md) for custom targets.
4. Click **Check host readiness**. Doctor checks Docker/image, risk, all core and required specialist routes. It does not contact a model or approve anything.
5. Select a clean target Git repository, enter the task and review the selected providers and policy. Preparation creates a disposable tracked-HEAD snapshot and private host directory without running a model.
6. Review the start checkpoint: exact base, source/test roots, command argv, immutable image, model endpoints, credential references and limits. **Approve and continue** sends the exact host-issued checkpoint ID/binding and advances one stage. Continue using the available stage controls, reviewing any later checkpoint before proceeding.

Model credentials come from a vault entry only when the exported provider binding exactly matches its saved registry entry, or from the operator's named application environment variable. No secret values pass through renderer state, argv, JSON inputs or command containers. CLI host HTTP requests use Python's environment proxy/certificate trust behavior, which differs from Electron probes; confirm the intended network/CA configuration. Provider locality is operator-declared and cannot prove whether a gateway forwards source externally.

Host code, Python, local account, Docker daemon/image and selected policy are trusted. Imported paths cannot register executable handles or reuse approvals. Renderer IPC must originate from a registered app window's exact main-frame page. Folder opening is restricted to selected/application directories and never launches arbitrary files.

## Failure and recovery

The cockpit polls managed host state/events while work is active. It surfaces the original error and only offers actions the current host allows. Imported bundles have no continue/approve/resume/retry controls.

For interrupted work, **Resume** restores the stage checkpoint and asks for fresh approval/invocations. For deterministic rejection, choose the earliest invalid stage and **Retry**; the host preserves prior evidence and consumes an attempt. Small allows one total attempt; standard/high-risk allow two. High-risk specialist reviews and checkpoints before GREEN/close remain mandatory. **Cancel** is terminal and retains partial source/evidence. Quitting interrupts managed host workers; restart retrieves durable status instead of claiming an unfinished stage passed.

Use **Open workspace folder** and **Open evidence folder** to review local results. Applying a patch, committing, pushing, merging and deploying remain manual. This version does not provide automatic publication or a distributed worker scheduler. Run history is a bounded local registry, not cloud synchronization.

## Project setup and navigation

Project facts drafts now survive screen navigation/restarts. Import an existing schema-1.0 project profile to preserve modules, decisions and source references; changed fields are listed. Review acknowledgement never persists, and exports remain create-only. These facts remain a separate context handoff, not executable policy.

The cockpit supports light/dark/system themes, keyboard tabs (arrows/Home/End), focus-managed dialogs and **Cmd/Ctrl+K** commands. Screenshots and browser tests exercise overview, evidence, diff, checkpoints and narrow layouts. They complement jsdom interaction tests and do not certify native desktop accessibility, OS keyrings, live models or signed installers.

## Development checks

```bash
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:ui
```

Browser tests use a synthetic read-only bridge fixture, never a real credential or native host. CI uploads screenshots for review and smoke-packages the desktop. Test a real profile, Docker host, proxy/CA and OS keyring on the intended machine before wider use. Signing is opt-in with configured certificates; see [distribution](distribution.md).

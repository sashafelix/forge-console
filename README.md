# Agent Pipeline UI

A private, cross-platform local workbench for installing, configuring, running and monitoring agent pipelines with interchangeable AI runtimes and tool adapters.

The application is deliberately independent of any one pipeline, model provider or IDE. Pipelines are loaded from manifests, runtimes are adapters, and the UI renders each pipeline's declared inputs and stages.

## Current capabilities

- Electron desktop shell for macOS, Windows and Linux
- React and TypeScript user interface
- validated built-in and user-installed pipeline packs
- version-aware pipeline selection and dynamic task forms
- local project and Git-repository selection
- runtime discovery and version probing for Claude Code and GitHub Copilot CLI
- persisted manual executable selection for GUI-launched desktop environments
- macOS discovery for Homebrew, local npm, Volta and pnpm CLI locations
- BMW LLM adapter placeholder with no false claim of executable support
- read-only provider preview runs with live output and cancellation
- local run records, prompts and append-only event logs
- secret-declared input redaction in persisted previews
- narrow Electron IPC boundary with no arbitrary shell endpoint
- example Agent Development Pipeline and Jira Story Agent packs

## Read-only preview mode

Version `0.3.0` can run a safe provider preview for a selected project and pipeline:

- Claude Code runs in `plan` permission mode with structured streaming output.
- GitHub Copilot runs programmatically with write and shell tools denied.
- prompts are sent through standard input rather than interpolated into a shell command.
- previews may inspect only what the selected runtime permits and may not claim implementation occurred.

Write-capable pipeline execution is intentionally not enabled yet. It will require explicit capability grants, provider-specific permission mapping, isolated worktrees and pipeline-owned evidence contracts.

## Runtime setup

The app searches the inherited `PATH` plus common local CLI locations. On macOS this includes Apple Silicon Homebrew, `/usr/local/bin`, `~/.local/bin`, Volta and pnpm locations.

A runtime can also be selected explicitly from the UI:

1. select Claude Code or GitHub Copilot;
2. choose **Choose executable**;
3. select the local executable or Windows command shim;
4. use **Use automatic** to remove the override later.

The chosen path is stored in the app's per-user settings file. No runtime credentials are stored by this feature.

## Pipeline packs

A local pack folder must contain `pipeline.json` at its root. The manifest declares:

- identity and version;
- dynamic input schema;
- supported runtimes;
- required capabilities;
- ordered stages and roles.

The installer validates the manifest, rejects symlinks and oversized packs, and excludes repository/build state such as `.git`, `node_modules`, `dist` and prior run evidence.

## Development

Requirements:

- Node.js 22.12 or newer
- npm

```bash
npm install
npm run dev
```

Quality checks:

```bash
npm run typecheck
npm test
npm run build
```

Create a platform package on the current operating system:

```bash
npm run package
```

## Cross-platform packages

The **Package desktop** GitHub Actions workflow builds independent artifacts for:

- macOS Apple Silicon (`arm64`)
- macOS Intel (`x64`)
- Windows (`x64`)
- Linux (`x64`)

Run it manually from the Actions tab or push a `v*` tag. Artifacts are retained for 14 days.

The current packages are unsigned development builds. macOS Gatekeeper and Windows SmartScreen may warn until signing and macOS notarisation are configured.

## Architecture

See [docs/architecture.md](docs/architecture.md) and [docs/distribution.md](docs/distribution.md).

## Status

Version `0.3.0` provides the generic catalog, validated local pack installation, runtime discovery/configuration, safe previews and cross-platform packaging foundation. Full pipeline execution, signed distribution, BMW LLM execution and tool adapters remain incremental milestones.

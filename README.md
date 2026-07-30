# Agent Pipeline UI

A private, cross-platform local workbench for installing, configuring, running and monitoring agent pipelines with interchangeable AI runtimes and tool adapters.

The application is deliberately independent of any one pipeline, model provider or IDE. Pipelines are loaded from manifests, runtimes are adapters, and the UI renders each pipeline's declared inputs and stages.

## Current capabilities

- Electron desktop shell for macOS, Windows and Linux
- React and TypeScript user interface
- validated built-in and user-installed pipeline packs
- dynamic task forms generated from pipeline manifests
- local project and Git-repository selection
- runtime discovery and version probing for Claude Code and GitHub Copilot CLI
- BMW LLM adapter placeholder with no false claim of executable support
- read-only provider preview runs with live output and cancellation
- local run records, prompts and append-only event logs
- secret-declared input redaction in persisted previews
- narrow Electron IPC boundary with no arbitrary shell endpoint
- example Agent Development Pipeline and Jira Story Agent packs

## Read-only preview mode

Version `0.2.0` can run a safe provider preview for a selected project and pipeline:

- Claude Code runs in `plan` permission mode with structured streaming output.
- GitHub Copilot runs programmatically with write and shell tools denied.
- prompts are sent through standard input rather than interpolated into a shell command.
- previews may inspect only what the selected runtime permits and may not claim implementation occurred.

Write-capable pipeline execution is intentionally not enabled yet. It will require explicit capability grants, provider-specific permission mapping, isolated worktrees and pipeline-owned evidence contracts.

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

## Architecture

See [docs/architecture.md](docs/architecture.md).

## Status

Version `0.2.0` provides the generic catalog, installation, discovery and read-only preview foundation. Full pipeline execution, provider configuration, signed pack distribution and tool adapters remain incremental milestones.

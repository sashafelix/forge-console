# Agent Pipeline UI

A private, cross-platform local workbench for installing, configuring, running and monitoring agent pipelines with interchangeable AI runtimes and tool adapters.

The application is deliberately independent of any one pipeline, model provider or IDE. Pipelines are loaded from manifests, runtimes are adapters, and the UI renders each pipeline's declared inputs and stages.

## Initial scope

- Electron desktop shell for macOS, Windows and Linux
- React and TypeScript user interface
- pipeline-pack catalog and manifest validation
- runtime-adapter catalog for Claude Code, GitHub Copilot and BMW LLM
- local project-folder selection
- dynamic task forms generated from pipeline manifests
- local run-draft persistence
- secure, narrow Electron IPC boundary
- example Agent Dev Pipeline and Jira Story Agent packs

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

Version `0.1.0` is the generic workbench foundation. Runtime execution, pack installation and full run monitoring will be added incrementally without coupling the UI to a specific pipeline.

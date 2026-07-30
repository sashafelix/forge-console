# Architecture

## Product boundary

Agent Pipeline UI is a local, single-user desktop workbench. It is not itself a pipeline and it is not tied to one model provider.

The user independently selects:

1. a local project or source context;
2. an installed pipeline pack;
3. an agent runtime;
4. configured tool adapters;
5. a local execution environment.

## Extension boundaries

### Pipeline packs

A pipeline pack declares its identity, version, dynamic input schema, required capabilities, compatible runtimes and ordered stages. The renderer does not hard-code stage names or task fields.

Packs may be bundled with the application or installed into the per-user application-data directory. Installation validates the manifest and copies a bounded, symlink-free pack snapshot while excluding repository and build state. Multiple versions remain independently selectable.

### Runtime adapters

Runtime adapters translate a generic agent request into provider-specific execution. Initial targets are Claude Code, GitHub Copilot and BMW LLM. A runtime may be a local process, HTTP endpoint or MCP/ACP connection.

Version 0.3 implements executable discovery, persisted process-runtime path overrides and read-only local process previews for Claude Code and GitHub Copilot. Provider arguments are fixed adapter data, prompts are passed over standard input, and the renderer cannot construct command lines.

Runtime discovery combines the inherited environment with standard local binary locations. This compensates for reduced environments in GUI-launched macOS applications without executing an interactive shell startup file.

### Tool adapters

Tool adapters expose constrained capabilities such as local Git, Jira, GitHub, Confluence and IntelliJ MCP. Pipelines request capabilities rather than naming concrete connectors.

### Execution adapters

Execution adapters decide where work runs. The current execution environment is the local machine. Write-capable pipeline execution will add isolated Git worktrees before containers or remote workers are considered.

## Settings boundary

Non-secret desktop settings are stored as versioned JSON under Electron's per-user application-data directory. Version 0.3 stores only explicit Claude Code and GitHub Copilot executable paths.

Settings writes are atomic and validated before replacement. Model credentials, tokens and HTTP authentication are not stored in this file; future secrets must use operating-system credential storage.

## Run boundary

A preview run is stored under Electron's per-user application-data directory and contains:

- `run.json` — current preview state with secret-declared inputs redacted;
- `prompt.txt` — the exact read-only prompt sent to the runtime;
- `events.jsonl` — append-only lifecycle and provider-output events.

The controller owns process lifecycle and cancellation. The selected pipeline still owns any future canonical execution evidence; the desktop application must not manufacture stage success.

## Security boundary

The React renderer has no Node.js access. Electron runs with `contextIsolation`, `nodeIntegration: false` and a narrow preload API. Renderer input cannot request arbitrary shell execution.

Read-only preview mode does not grant Claude permission bypass or Copilot write/shell tools. Write-capable execution requires a separate explicit permission model and cannot be inferred from a pipeline's compatibility declaration.

## Distribution boundary

The desktop application is packaged separately on Apple Silicon macOS, Intel macOS, Windows x64 and Linux x64 runners. Normal CI creates an unpacked Linux package as a smoke test, while the dedicated packaging workflow creates distributable artifacts.

Current packages are intentionally unsigned development builds. Signing, notarisation and trusted update delivery are separate release-security capabilities.

## Source layout

```text
src/
├── main/
│   ├── ipc.ts             narrow renderer boundary
│   ├── packs.ts           pack validation and installation
│   ├── runtime.ts         runtime discovery and process spawning
│   ├── settings.ts        atomic non-secret settings store
│   └── run-controller.ts  persisted preview lifecycle
├── renderer/              React user interface
└── shared/                provider-neutral contracts, settings and runtime specs

packs/examples/            bundled example manifests
```

## Next milestones

1. install packs from archives and private Git repositories;
2. generic pipeline-owned event/artifact monitoring;
3. permission-gated write execution in isolated worktrees;
4. Copilot ACP session adapter;
5. BMW LLM authenticated HTTP adapter;
6. Jira, GitHub, Confluence and IntelliJ MCP tool adapters;
7. signed and notarised macOS, Windows and Linux packages;
8. trusted application and pipeline-pack updates.

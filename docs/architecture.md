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

### Runtime adapters

Runtime adapters translate a generic agent request into provider-specific execution. Initial targets are Claude Code, GitHub Copilot and BMW LLM. A runtime may be a local process, HTTP endpoint or MCP/ACP connection.

### Tool adapters

Tool adapters expose constrained capabilities such as local Git, Jira, GitHub, Confluence and IntelliJ MCP. Pipelines request capabilities rather than naming concrete connectors.

### Execution adapters

Execution adapters decide where work runs. Version 0.1 starts with the local machine; containers and remote workers remain future adapters.

## Security boundary

The React renderer has no Node.js access. Electron runs with `contextIsolation`, `nodeIntegration: false` and a narrow preload API. Renderer input cannot request arbitrary shell execution.

Canonical pipeline artifacts should remain owned by the selected pipeline. The desktop application provides presentation, process control and human input without silently rewriting pipeline evidence.

## Initial source layout

```text
src/
├── main/       Electron controller and IPC
├── renderer/   React user interface
└── shared/     provider-neutral contracts

packs/examples/ Example pipeline manifests
```

## Near-term milestones

1. executable discovery and runtime health checks;
2. generic local process runtime adapter;
3. pipeline-pack installation from folder, archive and Git repository;
4. generic run-event stream and stage monitoring;
5. Claude Code adapter;
6. GitHub Copilot adapter;
7. BMW LLM HTTP adapter;
8. Jira, GitHub and IntelliJ MCP tool adapters;
9. signed macOS, Windows and Linux packages.

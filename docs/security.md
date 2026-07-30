# Security model

Agent Pipeline UI is a local orchestration workbench. It does not treat an AI runtime, pipeline pack, agent definition or selected repository as inherently trusted.

## Renderer boundary

- Electron renderers run with `nodeIntegration: false`, `contextIsolation: true` and `sandbox: true`.
- The preload exposes a narrow, typed API.
- There is no renderer-accessible arbitrary shell endpoint.
- Local paths are selected through native dialogs and re-resolved in the main process.

## Pipeline previews

Read-only previews deny model write and shell tools. They are intended for planning and inspection only.

## Pipeline execution

Executable pipeline packs must declare a schema `1.1` execution contract. The controller:

- creates an isolated Git worktree;
- freezes the approved turn budget and validation commands;
- denies model shell and network tools;
- runs exact validation commands after the model exits;
- does not commit, push, merge, deploy or publish.

## Standalone agent execution

Standalone agents are discovered from repositories selected by the operator. The agent source repository and target code repository are separate.

The controller:

- resolves the selected agent file inside its declared source root;
- rejects traversal, symlinked agent files and oversized definitions;
- parses requested tools, writes, input placeholders and environment variables;
- creates an isolated worktree of the target repository;
- requires explicit approval before launching the runtime;
- rejects agent-created commits by confirming `HEAD` remains at the prepared base revision;
- runs `git diff --check` and records changed files;
- leaves all commit and publication actions manual.

### Trusted-shell limitation

An agent that declares `bash`, `shell` or equivalent tools may require shell access to perform its stated job. This is shown as a high-visibility approval warning.

A Git worktree limits where ordinary repository changes occur, but it is **not an operating-system sandbox**. A shell-capable AI process may technically access commands, files and networks available to the current user account. Only approve agent definitions from sources you trust.

Future hardening should replace broad model shell access with controller-mediated command allowlists, constrained network destinations and disposable execution environments.

## Credentials

The current application does not persist Jira, Confluence or BMW LLM secrets. Environment variables required by an agent are detected by name and displayed before approval. Values are never written into prompts or run metadata.

The planned credential vault must:

- use the operating system's secure credential store;
- return only configured/not-configured metadata to renderers;
- inject secrets only into explicitly approved runs;
- redact secret values from stdout, stderr and persisted events;
- prevent pipeline packs and agent definitions from reading unrelated credentials.

Until that vault is implemented, secrets inherited from the launching shell remain subject to the permissions of the selected runtime and any approved shell-capable agent.

## Publication boundary

No current workflow automatically commits, pushes, opens a pull request, edits Jira, writes Confluence, merges or deploys. Those actions require separate future capability contracts and explicit operator approval.

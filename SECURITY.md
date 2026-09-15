# Security

Agent Pipeline UI is a local developer tool that can execute configured AI runtimes against selected projects. Security boundaries are therefore part of the product contract.

## Current guarantees

- the renderer has no direct Node.js access;
- Electron context isolation is enabled and Node integration is disabled;
- renderer-to-main communication uses a narrow preload API;
- the UI cannot submit arbitrary shell strings through IPC;
- provider commands and arguments are fixed adapter definitions;
- preview and execution prompts are sent over standard input rather than shell interpolation;
- Claude and Copilot permissions are mapped explicitly from the approved run policy;
- repository writes occur in isolated Git worktrees;
- the controller rejects agent-created commits and runs `git diff --check` after execution;
- pipeline manifests are validated before use;
- installed packs reject symlinks, unsupported file types and configured size limits;
- `.git`, dependencies, build output and prior run evidence are excluded from pack copies;
- connection secrets are encrypted with Electron `safeStorage` and are never returned to the renderer;
- only credentials explicitly required by an approved agent are injected into that runtime process;
- saved secret values are excluded from prompts, repositories, run records and persisted events;
- proxy URLs reject embedded credentials;
- runtime discovery adds known local binary directories without sourcing interactive shell configuration;
- the Self hosted LLM adapter is not marked executable until the controller-mediated HTTP execution path exists;
- no automatic merge, deployment or publication capability exists.

## Important limitations

- a Git worktree is a repository-isolation mechanism, **not** an operating-system sandbox;
- an approved shell-capable AI process may technically access commands, files and networks available to the current user account;
- corporate proxy and CA settings extend trust to the configured network infrastructure and should be reviewed before use;
- current desktop packages are unsigned development builds and may trigger Gatekeeper or SmartScreen warnings;
- direct Self hosted LLM execution is intentionally disabled even when its endpoint is configured successfully.

Future hardening should replace broad model shell access with controller-mediated command allowlists, constrained network destinations and disposable execution environments.

## Distribution requirements

Public or organisational distribution requires Apple notarisation, Windows code signing, release checksums, trusted update metadata and signed pipeline-pack verification.

Report security issues privately to the repository owner rather than opening a public issue.

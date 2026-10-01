# Security

Agent Pipeline UI is a local developer tool that can execute configured AI runtimes against selected projects. Security boundaries are therefore part of the product contract.

## Current guarantees

- the renderer has no direct Node.js access;
- Electron context isolation is enabled and Node integration is disabled;
- renderer-to-main communication uses a narrow preload API;
- the UI cannot submit arbitrary shell strings through IPC;
- provider executables and argument structure are constructed by adapter code, with task content passed as data;
- Claude Code and manifest/preview prompts use standard input; standalone Copilot prompts use a CLI argument (without shell interpolation), which may be visible to local process inspection;
- Claude and Copilot permissions are mapped explicitly from the approved run policy;
- repository writes occur in isolated Git worktrees;
- the controller rejects agent-created commits and runs `git diff --check` after execution;
- pipeline manifests are validated before use;
- installed packs reject symlinks, unsupported file types and configured size limits;
- `.git`, dependencies, build output and prior run evidence are excluded from pack copies;
- connection secrets are encrypted with Electron `safeStorage` and are never returned to the renderer;
- only declared managed connection values are added for an approved agent; child processes also inherit the launcher environment;
- the connection layer does not directly write saved values into prompts or run records; runtime-output redaction is best-effort, not a complete secret filter;
- proxy URLs reject embedded credentials;
- runtime discovery adds known local binary directories without sourcing interactive shell configuration;
- the Self hosted LLM adapter is not marked executable until the controller-mediated HTTP execution path exists;
- the controllers do not automatically merge, deploy or publish; approved shell/MCP tools still carry the access available to their process.

## Important limitations

- legacy Connections checks `safeStorage.isEncryptionAvailable()` but does not reject Linux `basic_text`; the model registry additionally rejects that fallback;
- inherited process environment variables are not a general credential allowlist; launch from an appropriately scoped environment;
- arbitrary runtime output can contain secrets that pattern redaction misses, and legacy preview stdout/stderr is persisted without the standalone run-output sanitizer; review records before sharing;

- a Git worktree is a repository-isolation mechanism, **not** an operating-system sandbox;
- an approved shell-capable AI process may technically access commands, files and networks available to the current user account;
- corporate proxy and CA settings extend trust to the configured network infrastructure and should be reviewed before use;
- current desktop packages are unsigned development builds and may trigger Gatekeeper or SmartScreen warnings;
- direct Self hosted LLM execution is intentionally disabled even when its endpoint is configured successfully.

Future hardening should replace broad model shell access with controller-mediated command allowlists, constrained network destinations and disposable execution environments.

## Distribution requirements

Public or organisational distribution requires Apple notarisation, Windows code signing, release checksums, trusted update metadata and signed pipeline-pack verification.

Report security issues privately to the repository owner rather than opening a public issue.

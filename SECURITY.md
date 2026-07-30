# Security

Agent Pipeline UI is a local developer tool that can execute configured AI runtimes against selected projects. Security boundaries are therefore part of the product contract.

## Current guarantees

- the renderer has no direct Node.js access;
- Electron context isolation is enabled and Node integration is disabled;
- renderer-to-main communication uses a narrow preload API;
- the UI cannot submit arbitrary shell strings;
- provider commands and arguments are fixed adapter definitions;
- preview prompts are sent over standard input rather than shell interpolation;
- Claude previews use plan permission mode and never bypass permissions;
- Copilot previews deny write and shell tools and disable remote session features;
- pipeline manifests are validated before use;
- installed packs reject symlinks, unsupported file types and configured size limits;
- `.git`, dependencies, build output and prior run evidence are excluded from pack copies;
- secret-declared inputs are redacted from persisted drafts and preview prompts;
- run records and append-only events are stored under Electron's per-user application-data directory;
- executable overrides are non-secret, validated settings written atomically with owner-only permissions where supported;
- runtime discovery adds known local binary directories without sourcing interactive shell configuration;
- BMW LLM is not marked executable until an authenticated HTTP adapter exists;
- no automatic merge, deployment or publication capability exists.

## Known limitations

- Windows npm-installed CLI shims may require the operating-system command shell; only fixed adapter arguments are passed and user prompts remain on standard input.
- cancellation currently targets the direct child process. Full process-tree containment is required before write-capable execution.
- runtime authentication health is inferred from a version probe only; a dedicated authenticated smoke check is still required.
- explicit executable selection proves that a file exists, while the subsequent version probe determines whether it is usable.
- workflow packages are unsigned development builds and may trigger Gatekeeper or SmartScreen warnings.
- workflow artifacts are private-repository build outputs, not signed release provenance.

## Future requirements

Write-capable runtime and tool adapters must declare capabilities, validate all structured inputs, constrain filesystem access to authorised roots, run in isolated worktrees or sandboxes and keep secrets in operating-system credential storage. HTTP, ACP and MCP adapters must use explicit trust configuration and must never expose local control endpoints to the LAN by default.

Public or organisational distribution requires Apple notarisation, Windows code signing, release checksums, trusted update metadata and signed pipeline-pack verification.

Report security issues privately to the repository owner rather than opening a public issue.

# Architecture

## Product boundary

Forge Console is a local, single-user desktop workbench. It is not itself a pipeline and it is not tied to one model provider, IDE or agent repository.

The operator independently selects:

1. a workflow repository containing agent definitions;
2. a target code repository when it differs from the workflow repository;
3. an available process runtime;
4. optional service connections and network settings;
5. the permissions required for the run.

## Pipeline configuration

For Forge, the UI exports reviewed project/model facts and provides a separate governed-host cockpit. Native host registration pins code/Python; operator inputs are hashed and copied privately per run. The bridge consumes host state and cursor events and sends only currently available actions with exact approval bindings. Read-only imports have no execution handle. Generic controllers retain their recognised-RGR guards. See [the boundary](pipeline-configuration.md) and [cockpit](cockpit.md).

The model registry stores providers and named routing profiles, keeps encrypted credentials in the main process, and performs bounded synthetic diagnostics for four HTTP protocols. Exports and successful tests do not install an HTTP execution adapter or establish trusted pipeline capabilities. See [model configuration](model-configuration.md).

## Repository-native agents

The workbench discovers Markdown agent definitions from `agents/`, `.github/agents/` and `.claude/agents/`. Agent frontmatter and instructions are parsed into a provider-neutral contract describing inputs, requested tools, declared writes, required environment variables and execution characteristics.

The workflow repository is never treated as automatically trusted. Shell, network, credential and write requirements are surfaced before execution.

## Runtime adapters

Runtime adapters translate a generic agent request into provider-specific execution.

Current adapters are:

- **Claude Code** — local process adapter with structured streaming output;
- **GitHub Copilot CLI** — local process adapter with programmatic JSONL output;
- **Self hosted LLM** — configurable HTTP endpoint metadata and connectivity testing. Direct agent execution is intentionally unavailable until the controller-mediated HTTP execution loop exists.

Process-runtime executable discovery combines the inherited environment with standard local binary locations and optional user-selected executable overrides. This helps GUI-launched desktop applications find CLI tools without sourcing interactive shell startup files.

## Connections

Jira, Confluence and Self hosted LLM connection profiles are stored by the main process.

- non-secret metadata is persisted as versioned JSON;
- both credential stores require a secure Electron `safeStorage` backend (see [security](security.md));
- the renderer receives only connection metadata and configured/not-configured state;
- child environments contain platform/network essentials, selected CLI authentication and explicitly approved required variables;
- network settings support inherited, operating-system, manual and direct proxy modes plus `NO_PROXY` and an optional corporate CA bundle.

## Execution boundary

Write-capable runs use isolated Git worktrees. The controller owns worktree creation, provider launch, lifecycle events and validation.

The approval snapshot freezes the selected agent, target repository, runtime, requested permissions and required credentials before execution starts. After the runtime exits, the controller confirms that the prepared base revision has not been replaced by an agent-created commit, runs `git diff --check` and records the changed files.

A worktree limits ordinary repository changes but does not sandbox the operating system. Broad shell access remains a trusted-local-instruction capability.

## Interactive runs

Interactive agents may request operator input during execution. Conversation state, pending questions and lifecycle events are persisted with the run. On restart, runs left preparing, running or validating are marked failed with a recovery event and their worktree is preserved. This does not restart an interrupted process. Runs waiting for input retain their pending question and can continue through the supported reply path, subject to the current execution guards.

## Pipeline packs

Manifest-driven pipeline packs remain supported by the backend. A pack declares identity, version, input schema, required capabilities, compatible runtimes, stages and an optional schema `1.1` execution contract.

Executable packs use isolated worktrees and controller-owned validation commands. Commit, push, merge, deployment and publication remain outside automatic execution.

## Security boundary

The React renderer has no Node.js access. Electron uses `contextIsolation`, disables Node integration and exposes a narrow typed preload API. Renderer input cannot request arbitrary shell execution directly.

Secrets stay in the main process and are not returned through the preload API. Provider commands are constructed by trusted adapter code rather than renderer-supplied shell strings.

## Source layout

```text
src/
├── main/
│   ├── agents.ts                      repository agent discovery
│   ├── agent-execution-controller.ts  isolated agent-run lifecycle
│   ├── provider-registry.ts           model profiles, credentials and diagnostic state
│   ├── provider-ipc.ts                reviewed model exports and main-process probes
│   ├── agent-runtime.ts               standalone Claude/Copilot invocation
│   ├── interrupted-run-recovery-core.ts persisted interruption handling
│   ├── connections.ts                 encrypted service connections
│   ├── execution-controller.ts        manifest execution lifecycle
│   ├── ipc.ts                         narrow renderer boundary
│   ├── network-settings.ts            proxy and CA handling
│   ├── runtime.ts                     runtime discovery and process spawning
│   └── worktrees.ts                   repository isolation helpers
├── renderer/                          task-first and advanced user interfaces
└── shared/                            provider-neutral contracts and validation

packs/examples/                        example manifests
```

## Next milestones

1. controller-mediated HTTP execution for Self hosted LLM endpoints;
2. stronger shell command allowlisting and disposable execution environments;
3. constrained network destinations for network-capable agents;
4. richer run-artifact review and provenance;
5. signed and notarised desktop packages with trusted updates;
6. signed or otherwise verified pipeline-pack distribution.

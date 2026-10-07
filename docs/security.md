# Security model

Forge Console is a local orchestration workbench. It does not treat an AI runtime, pipeline pack, agent definition, selected repository or external service as inherently trusted.

## Renderer boundary

- Electron renderers run with `nodeIntegration: false`, `contextIsolation: true` and `sandbox: true`.
- The preload exposes a narrow, typed API.
- Every IPC handler checks the registered application window, exact page URL and main frame. Navigation, new windows, webviews and permission requests are denied outside the registered app pages.
- There is no renderer-accessible arbitrary shell endpoint.
- Local paths are selected through native dialogs and re-resolved in the main process.
- Folder opening accepts selected/application directories only; evidence inspection rejects unsafe paths, symlinks, oversized files and excessive nesting.
- Connection secret values are never returned through the renderer API.

## Pipeline execution

Recognised Local RGR packs/agents stay blocked in generic controllers. The opt-in [cockpit](cockpit.md) separately invokes the selected Forge governed host. Its native bridge pins code/Python and operator input bytes; managed runs obtain authority only from the private host state. Imported bundles never gain action handles. Commands run in Forge's Docker boundary; provider calls occur in the trusted host. The following describes other executable packs.

Executable pipeline packs must declare a schema `1.1` execution contract. The controller:

- creates an isolated Git worktree;
- freezes the approved turn budget and validation commands;
- denies model shell and network tools unless the execution contract explicitly allows a supported capability;
- runs controller-owned validation commands after the model exits;
- does not commit, push, merge, deploy or publish.

## Standalone agent execution

Standalone agents are discovered from repositories selected by the operator. The agent source repository and target code repository may be separate.

The controller:

- resolves the selected agent file inside its declared source root;
- rejects traversal, symlinked agent files and oversized definitions;
- parses requested tools, writes, input placeholders and environment variables;
- creates an isolated worktree of the target repository;
- requires explicit approval before launching the runtime;
- resolves only credentials explicitly required by the approved agent;
- rejects agent-created commits by confirming `HEAD` remains at the prepared base revision;
- runs `git diff --check` and records changed files;
- leaves all commit and publication actions manual.

### Trusted-shell limitation

An agent that declares `bash`, `shell` or an equivalent tool may require shell access to perform its stated job. This is shown as a high-visibility approval warning.

A Git worktree limits where ordinary repository changes occur, but it is **not an operating-system sandbox**. A shell-capable AI process may technically access commands, files and networks available to the current user account. Only approve agent definitions from sources you trust.

Future hardening should replace broad model shell access with controller-mediated command allowlists, constrained network destinations and disposable execution environments.

## Credentials

Jira, Confluence and Self hosted LLM connection profiles are persisted by the main process.

- connection metadata such as service URL, authentication header and model name is stored separately from secrets;
- both credential stores require available OS encryption and reject Linux `basic_text` when reading/saving secrets; configure a supported keyring and re-enter credentials previously stored through the insecure fallback;
- saved secrets are never returned to the renderer;
- child environments allow platform/network essentials, the selected CLI's supported authentication variables and explicitly approved required variables; unrelated launcher credentials and code-injection variables are excluded;
- inherited environment variables take precedence only when the same declared variable is already present in the launcher environment;
- secrets are not written into prompts, repositories, run records or persisted event messages by the connection layer;
- removing a connection deletes both its metadata and encrypted secret entry.

Standalone output and legacy preview/validation stdout/stderr use pattern-based redaction, which cannot detect every secret. Agents, tools and external services may echo sensitive inputs; inspect prompts, conversations and output before sharing run records.

Claude Code and manifest/preview prompts are sent on stdin. Standalone Copilot passes the prompt through `--prompt`/`-p` without shell interpolation; local process inspection may expose those arguments.

The Self hosted LLM connection can be configured and connectivity-tested against an OpenAI-compatible `/v1/models` endpoint. Direct agent execution through that HTTP adapter is intentionally disabled until a controller-mediated execution loop exists.

## Network and proxy settings

The workbench supports inherited, operating-system, manual and direct proxy modes. Manual proxy URLs reject embedded usernames and passwords. An optional corporate CA certificate can be supplied to provider child processes.

Changing network settings clears cached provider-readiness state. Operators should treat proxy servers and custom certificate authorities as part of the trusted computing boundary.

## Publication boundary

The built-in controllers do not publish agent changes onto the source branch, push, open pull requests, edit Jira, write Confluence, merge or deploy. Worktree preparation does create an ephemeral Git snapshot commit without moving the selected branch or changing its index. This is controller behaviour, not an operating-system restriction on approved shell/MCP tools. Automating these actions requires separate capability contracts and explicit operator approval.


## Model configuration registry

The separate provider registry supports multiple encrypted credentials, refuses Linux's `basic_text` fallback and returns credential-presence metadata only. Secret values are excluded from renderer drafts, imports, exports and diagnostic messages. Removing a credential drops its active reference; unreferenced encrypted slots are reclaimed on subsequent credential writes. Provider and profile writes are serialized and revision checked. Reviewed exports require the same registry revision.

The Forge bridge supplies a vault credential only when the complete exported provider object matches its saved registry entry. Changed endpoints/identity/headers cannot reuse that credential. Host HTTP calls reject redirects; credentials stay outside argv, renderer state and Docker mounts. Locality remains operator-declared and unknown embedded source/output secrets may evade pattern redaction. Protect the local account, host ledger/key, trusted Python, Docker daemon and image; this is not remote attestation or hosted identity management.

Imports assign fresh provider identities and never bind an imported endpoint to an existing credential. Probes reject redirects, use bounded responses and timeouts, and send synthetic prompts only. Tool-call tests inspect output without invoking tools. These checks are diagnostics, not trusted capability registrations. See [model configuration](model-configuration.md) for protocol, certificate and execution limitations.

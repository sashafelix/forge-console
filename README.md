# Agent Pipeline UI

A private, cross-platform, repository-first workbench for discovering, configuring, running and monitoring standalone agents and multi-agent pipelines with interchangeable AI runtimes.

The application is deliberately independent of any one pipeline, agent library, model provider or IDE. Workflows are discovered from the repository selected by the operator; target code repositories remain separate when an agent library is reused across projects.

## Current capabilities

- Electron desktop shell for macOS, Windows and Linux
- repository-native standalone-agent discovery from:
  - `agents/`
  - `.github/agents/`
  - `.claude/agents/`
- no workflow list before a repository is selected
- separate workflow-source and target-code repository selection
- automatic parsing of agent frontmatter, tools, `${input:...}` placeholders, declared writes and required environment variables
- isolated Git worktrees for approved writes
- explicit approval for shell, network, credentials and file-write access
- runtime discovery and version probing for Claude Code and GitHub Copilot CLI
- persisted manual executable selection for GUI-launched desktop environments
- encrypted Jira, Confluence and BMW LLM connection profiles
- per-agent secret injection based only on declared environment-variable requirements
- BMW LLM endpoint/model/authentication configuration and connection testing
- local run records, prompts and append-only event logs without secret values
- post-run `git diff --check`, changed-file collection and rejection of agent-created commits
- narrow Electron IPC boundary with no arbitrary renderer shell endpoint

## Repository Workbench

The default window begins empty. Choose a repository and the workbench discovers only the agents present in that repository.

A standalone run can use two repositories:

1. **Workflow repository** — supplies the selected agent definition.
2. **Target code repository** — supplies the source code, tests and Git history the agent must inspect.

Typical defect-investigation flow:

1. choose the Java Cloud AI Dev Kit as the workflow repository;
2. select `investigate-defect`;
3. choose the affected service repository as the target codebase;
4. enter the Jira ticket key;
5. review requested tools, credentials, writes, shell and network access;
6. approve the run;
7. review generated investigation artifacts in the isolated worktree.

The app does not copy or modify the workflow repository. It renders the selected instructions, substitutes declared inputs, and executes the runtime with the target worktree as its working directory.

Standalone agents that request shell access are treated as trusted local instructions. A Git worktree limits ordinary repository changes and the controller rejects commits, but shell access is **not** an operating-system sandbox. Only approve agent definitions you trust.

## Connections

Open **Workspaces → Connections**, press `Cmd/Ctrl+,`, or use the **Connections** button in the repository workbench.

Initial connection profiles:

- Jira ATC
- Confluence ATC
- BMW LLM

Tokens are encrypted with Electron `safeStorage`, backed by the operating system credential service. React receives only configured/not-configured metadata; saved secret values are never returned to the renderer.

When a selected agent declares `ATC_JIRA_TOKEN`, `ATC_CONFLUENCE_TOKEN`, or another supported connection variable, the main process decrypts only that value and injects it into the approved runtime process. Secret values are not written into prompts, repositories, events or `run.json`.

BMW LLM can be configured and connection-tested in version `0.6.0`. Direct BMW LLM agent execution remains deliberately unavailable until the controller-mediated HTTP tool loop is implemented.

## Pipeline packs

Manifest-driven pipeline packs remain supported by the execution backend and may be installed explicitly. They are no longer shown as though they belong to every selected repository.

A local pack folder must contain `pipeline.json` at its root. The manifest declares identity, version, inputs, supported runtimes, required capabilities, stages and an optional execution contract.

Schema `1.1` packs may declare an isolated execution contract. The controller creates a separate Git worktree, requires explicit approval, runs exact controller-owned validation commands, and leaves commit, push, merge and deployment actions manual.

## Runtime setup

The app searches the inherited `PATH` plus common local CLI locations. On macOS this includes Apple Silicon Homebrew, `/usr/local/bin`, `~/.local/bin`, Volta and pnpm locations.

A runtime executable can also be selected explicitly in the UI. The chosen path is stored in the app's per-user settings file; provider credentials are managed separately through the Connections vault or by the provider CLI itself.

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

## Cross-platform packages

The **Package desktop** GitHub Actions workflow builds independent artifacts for macOS Apple Silicon, macOS Intel, Windows x64 and Linux x64.

Run it manually from the Actions tab or push a `v*` tag. The current packages are unsigned development builds, so macOS Gatekeeper and Windows SmartScreen may warn until signing and notarisation are configured.

## Architecture

See [docs/architecture.md](docs/architecture.md), [docs/security.md](docs/security.md), [docs/distribution.md](docs/distribution.md) and [docs/troubleshooting.md](docs/troubleshooting.md).

## Status

Version `0.6.0` makes the repository the source of truth for workflow discovery and adds encrypted Jira, Confluence and BMW LLM connection profiles. Repository-native multi-agent pipeline discovery, direct BMW LLM execution, controller-mediated shell allowlisting, native clarification prompts and richer artifact review remain incremental milestones.

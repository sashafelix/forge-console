# Agent Pipeline UI

A private, cross-platform local workbench for discovering, configuring, running and monitoring standalone agents and multi-agent pipelines with interchangeable AI runtimes.

The application is deliberately independent of any one pipeline, agent library, model provider or IDE. Pipeline packs are manifest-driven, standalone agents are discovered from repositories, runtimes are adapters, and target code repositories remain separate from reusable agent definitions.

## Current capabilities

- Electron desktop shell for macOS, Windows and Linux
- React and TypeScript user interfaces
- validated built-in and user-installed pipeline packs
- repository-native standalone agent discovery from:
  - `agents/`
  - `.github/agents/`
  - `.claude/agents/`
- separate agent-library and target-code repository selection
- automatic parsing of agent frontmatter, tools, `${input:...}` placeholders, declared writes and required environment variables
- isolated Git worktrees for approved pipeline and standalone-agent writes
- explicit approval for standalone-agent shell, network and file-write access
- runtime discovery and version probing for Claude Code and GitHub Copilot CLI
- persisted manual executable selection for GUI-launched desktop environments
- macOS discovery for Homebrew, local npm, Volta and pnpm CLI locations
- BMW LLM adapter placeholder with no false claim of executable support
- read-only provider previews with live output and cancellation
- local run records, prompts and append-only event logs
- post-run `git diff --check`, changed-file collection and rejection of agent-created commits
- narrow Electron IPC boundary with no arbitrary renderer shell endpoint

## Single Agent Runner

Open **Workspaces → Single Agent Runner** or press `Cmd/Ctrl+Shift+A`.

A standalone run has two separate repositories:

1. **Agent library** — supplies the selected agent definition.
2. **Target code repository** — supplies the source code, tests and Git history the agent must inspect.

Typical defect-investigation flow:

1. choose the Java Cloud AI Dev Kit as the agent library;
2. select `investigate-defect`;
3. choose the affected service repository as the target codebase;
4. enter the Jira ticket key;
5. review requested tools, environment variables, writes, shell and network access;
6. approve the run;
7. review generated investigation artifacts in the isolated worktree.

The app does not copy or modify the agent library. It renders the agent instructions, substitutes declared inputs, and executes the selected runtime with the target worktree as its working directory.

Standalone agents that request shell access are treated as trusted local instructions. The worktree limits repository writes and the controller rejects commits, but shell access is **not** an operating-system sandbox. Only approve agent definitions you trust.

Environment variables referenced by an agent, such as `ATC_JIRA_TOKEN`, must currently exist in the environment that launches the desktop app. The planned credential vault will store Jira, Confluence and BMW LLM credentials in the operating system's secure credential store and inject them only into approved runs.

## Pipeline modes

### Read-only preview

- Claude Code runs in `plan` permission mode with structured streaming output.
- GitHub Copilot runs programmatically with write and shell tools denied.
- prompts are sent through standard input rather than interpolated into a shell command.

### Isolated pipeline execution

Schema `1.1` pipeline packs may declare a validated execution contract. The app creates a separate Git worktree, requires explicit operator approval, allows model file edits without model shell/network access, runs exact controller-owned validation commands, and leaves commit/push/merge/deploy actions manual.

## Runtime setup

The app searches the inherited `PATH` plus common local CLI locations. On macOS this includes Apple Silicon Homebrew, `/usr/local/bin`, `~/.local/bin`, Volta and pnpm locations.

A runtime can also be selected explicitly from the UI:

1. select Claude Code or GitHub Copilot;
2. choose **Choose executable**;
3. select the local executable or Windows command shim;
4. use **Use automatic** to remove the override later.

The chosen path is stored in the app's per-user settings file. Runtime credentials are not stored by this feature.

## Pipeline packs

A local pack folder must contain `pipeline.json` at its root. The manifest declares identity, version, inputs, supported runtimes, required capabilities, stages and an optional execution contract.

The installer validates the manifest, rejects symlinks and oversized packs, and excludes repository/build state such as `.git`, `node_modules`, `dist` and prior run evidence.

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

Version `0.5.0` adds repository-native standalone-agent discovery and execution against separate target repositories. Jira/Confluence credential storage, BMW LLM execution, controller-mediated shell allowlisting, native clarification prompts and richer pipeline artifact views remain incremental milestones.

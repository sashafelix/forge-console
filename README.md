# Agent Pipeline UI

## AI Dev Pipeline configuration

Use **Pipeline configuration** in the guided workbench to prepare and preview a Local RGR `project-profile.json`. Export is an explicit native save operation and only creates a new file. Project facts are checked in both renderer and main process; commands remain unexecuted text. Validate and explicitly supply the file to [agent-dev-pipeline](https://github.com/sashafelix/agent-dev-pipeline) in your usual coding environment.

This integration configures project facts only. It does not launch the RGR orchestrator, translate stages into generic workbench runs, bind profiles, select RGR risk/runtime policy, approve runs or publish changes. Existing workflows for other agents remain available. See [the configuration boundary](docs/pipeline-configuration.md).

A cross-platform, repository-first desktop workbench for discovering, configuring, running and monitoring standalone agents and multi-agent workflows with interchangeable AI runtimes.

The application is deliberately independent of any one pipeline, agent library, model provider or IDE. Workflows are discovered from the repository selected by the operator, target code repositories remain separate when required, and privileged actions are surfaced for explicit approval.

## Current capabilities

- Electron desktop shell for macOS, Windows and Linux
- task-first guided workbench with an advanced specialist-agent view
- repository-native agent discovery from:
  - `agents/`
  - `.github/agents/`
  - `.claude/agents/`
- separate workflow-source and target-code repository selection
- automatic parsing of agent frontmatter, inputs, tools, declared writes and required environment variables
- isolated Git worktrees for approved repository changes
- explicit approval for shell, network, credentials and file-write access
- runtime discovery, readiness checks and execution for Claude Code and GitHub Copilot CLI
- encrypted Jira, Confluence and Self hosted LLM connection profiles
- per-agent secret injection based only on declared environment-variable requirements
- configurable proxy, `NO_PROXY` and corporate CA settings
- local run records, prompts, conversations and append-only event logs without persisted secret values
- interrupted-run recovery and interactive agent questions
- post-run `git diff --check`, changed-file collection and rejection of agent-created commits
- narrow Electron IPC boundary with no arbitrary renderer shell endpoint

## Guided workbench

The default screen is task-first. Choose a repository and the workbench discovers the workflows and specialist agents contained in that repository.

A run can use two repositories:

1. **Workflow repository** — supplies the selected agent definition.
2. **Target code repository** — supplies the source code, tests and Git history the agent must inspect or modify.

Typical flow:

1. choose a repository containing agent definitions;
2. select a guided workflow or specialist;
3. choose the target codebase when it differs from the workflow repository;
4. provide the task or ticket reference;
5. review requested tools, credentials, writes, shell and network access;
6. approve the run;
7. review the result and isolated worktree changes.

Agent definitions that request shell access are treated as trusted local instructions. A Git worktree limits ordinary repository changes, but it is **not** an operating-system sandbox. Only approve agent definitions you trust.

## Connections

Open **Workspaces → Connections**, press `Cmd/Ctrl+,`, or use the Connections control in the workbench.

Available connection profiles:

- Jira
- Confluence
- Self hosted LLM

Tokens are encrypted with Electron `safeStorage`, backed by the operating-system credential service. The renderer receives only configured/not-configured metadata; saved secret values are never returned to the UI.

When an approved agent declares a supported environment variable such as `JIRA_TOKEN`, `CONFLUENCE_TOKEN` or `SELF_HOSTED_LLM_TOKEN`, the main process decrypts only the required value and injects it into that runtime process. Secret values are not written into prompts, repositories, events or `run.json`.

The Self hosted LLM profile supports endpoint, model and authentication configuration plus a `/v1/models` connectivity check. Direct agent execution through the HTTP adapter remains disabled until the controller-mediated HTTP execution loop is implemented.

## Pipeline packs

Manifest-driven pipeline packs remain supported by the execution backend and may be installed explicitly. A local pack folder contains `pipeline.json` at its root and declares identity, version, inputs, supported runtimes, required capabilities, stages and an optional execution contract.

Schema `1.1` packs may declare an isolated execution contract. The controller creates a separate Git worktree, requires explicit approval, runs controller-owned validation commands and leaves commit, push, merge and deployment actions manual.

## Runtime setup

The app searches the inherited `PATH` plus common local CLI locations. A runtime executable can also be selected explicitly in the UI. Provider credentials are managed separately through the Connections vault or by the provider CLI itself.

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

Current packages are unsigned development builds, so macOS Gatekeeper and Windows SmartScreen may warn until signing and notarisation are configured.

## Architecture and security

See [docs/architecture.md](docs/architecture.md), [docs/security.md](docs/security.md), [docs/distribution.md](docs/distribution.md) and [docs/troubleshooting.md](docs/troubleshooting.md).

## Status

Version `0.8.6` provides the task-first repository workbench, secure connection vault, network/proxy configuration, interactive agent runs and recovery of interrupted work. The Self hosted LLM connection is configuration/test-only; controller-mediated HTTP execution, stronger sandboxing and signed distribution remain incremental milestones.

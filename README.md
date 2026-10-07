# Forge Console

The desktop companion for **[Forge](https://github.com/sashafelix/forge)** and a standalone repository-agent workbench. Formerly Agent Pipeline UI; existing settings, credentials, run history and technical identifiers are retained.

## Start here

Open **Pipeline configuration** for the setup hub, or **Quickstart guides** for guided instructions. The [quickstart](docs/quickstart.md) covers a first Copilot/Claude agent run, a governed Forge run, and read-only evidence review. A small [README review agent](examples/agents/readme-review.md) is included.

## Forge configuration

Use **Pipeline configuration** to manage providers, model profiles and role routing, or prepare a Local RGR `project-profile.json`. Models can be discovered or entered manually using OpenAI Responses, OpenAI-compatible Chat Completions, Anthropic Messages or Gemini protocols. The UI provides explicit synthetic capability tests, encrypted credentials, reusable profiles and reviewed secret-free exports.

Validate and explicitly supply exported files to [Forge](https://github.com/sashafelix/forge). The separate **Forge cockpit** can inspect evidence or control runs through an independently registered governed Forge host. The host owns execution, stages, policy, approvals and receipts. Configuration/probes alone grant no authority. Start with [the cockpit guide](docs/cockpit.md), [model configuration](docs/model-configuration.md) and [the integration boundary](docs/pipeline-configuration.md).

Known Local RGR packs and agents remain blocked in generic workbench controllers: the main process rejects prepare, start and reply/resume for recognised identifiers and filenames. The new cockpit uses the separately selected governed host. Standalone execution below applies to other definitions.

A cross-platform, repository-first desktop workbench for discovering, configuring, running and monitoring standalone agents and multi-agent workflows with interchangeable AI runtimes.

The application is deliberately independent of any one pipeline, agent library, model provider or IDE. Workflows are discovered from the repository selected by the operator, target code repositories remain separate when required, and privileged actions are surfaced for explicit approval.

## Current capabilities

- Electron desktop shell for macOS, Windows and Linux
- Forge cockpit with nine-stage progress, criterion/test/log trace, read-only diff, artifact inspection, event filters, run comparison and host-owned approvals/recovery
- native registration of pinned Forge code/Python/operator inputs; imported bundles remain read-only
- persistent project-facts drafts and lossless schema-1.0 profile import with changed-field review
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
- multiple provider/model profiles with capability diagnostics, per-role fallbacks and local-only policy
- encrypted Jira, Confluence and Self hosted LLM connection profiles
- explicitly required credentials and a minimal platform/network child environment; unrelated launcher secrets and code-injection variables are excluded
- configurable proxy, `NO_PROXY` and corporate CA settings
- local run records, prompts, conversations and append-only event logs; output redaction is best-effort and records need review before sharing
- recovery of interrupted-run records/worktrees and interactive agent questions; interrupted active processes are marked failed, not automatically restarted
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

Connection tokens use Electron `safeStorage` with a secure OS keyring. Both stores reject unavailable encryption and Linux's `basic_text` fallback when saving/reading secrets. See [security](docs/security.md). The renderer receives configured/not-configured metadata, never saved secret values.

When an approved agent declares a supported variable such as `JIRA_TOKEN`, `CONFLUENCE_TOKEN` or `SELF_HOSTED_LLM_TOKEN`, the main process resolves only the required value. Children receive platform/network essentials, supported CLI authentication and explicitly approved variables. Output redaction remains best-effort; inspect records before sharing.

The Self hosted LLM profile supports endpoint, model and authentication configuration plus a `/v1/models` connectivity check. Direct agent execution through the HTTP adapter remains disabled until the controller-mediated HTTP execution loop is implemented.

## Pipeline packs

Manifest-driven pipeline packs remain supported by the execution backend and may be installed explicitly. A local pack folder contains `pipeline.json` at its root and declares identity, version, inputs, supported runtimes, required capabilities, stages and an optional execution contract.

Schema `1.1` packs may declare an isolated execution contract. The controller creates a separate Git worktree, requires explicit approval, runs controller-owned validation commands and leaves commit, push, merge and deployment actions manual.

## Runtime setup

The app searches the inherited `PATH` plus common local CLI locations. A runtime executable can also be selected explicitly in the UI. Install Git and the selected Claude Code or GitHub Copilot CLI separately, authenticate that CLI and confirm it works against the selected repository. Provider login belongs to that CLI; the Connections vault supplies declared service variables. HTTP provider credentials belong to the separate model registry. Open **Pipeline configuration → CLI runtimes** to select an executable, test the connection and return to Workflows with Copilot or Claude selected. Canonical `agents/` definitions run through both CLI adapters: Claude receives session discovery instructions; Copilot uses temporary worktree discovery files restored on exit. `skills/<name>/SKILL.md` stays in the selected source library. Legacy native directories remain supported; canonical identities take precedence. Copilot CLI is currently a standalone runtime and cannot be selected as an HTTP model route for the governed Forge host.

## Development

Keep documentation, UI placeholders and test fixtures generic: use fictional project IDs, ordinary role names and reserved example domains. Do not copy employer-specific names, internal ticket keys, account identifiers or operational data into examples.

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

The workflow now offers an explicit signed macOS/Windows mode and macOS notarization using repository secrets, and records package checksums/source revision. No certificate is bundled or signing claimed without it. See [distribution](docs/distribution.md).

## Architecture and security

See [docs/architecture.md](docs/architecture.md), [docs/security.md](docs/security.md), [docs/distribution.md](docs/distribution.md) and [docs/troubleshooting.md](docs/troubleshooting.md).

## Status

Version `0.9.0` is unreleased. The Forge cockpit adds opt-in governed host execution and read-only evidence review alongside existing agent workflows. The model editor/probes and legacy Self hosted LLM connection remain separate configuration features. Live model/native keyring qualification and certificate-backed distribution require testing on the intended machine. See [CHANGELOG.md](CHANGELOG.md).

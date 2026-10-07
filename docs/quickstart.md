# Get your first result in Forge Console

Open **Quickstart guides** from the workbench, or **Pipeline configuration → Get started**. Configuration, the cockpit and the embedded guides share the same light/dark/system theme.

Choose the path that matches your goal:

| Goal | Start here | You need |
| --- | --- | --- |
| Use a Copilot or Claude Code subscription with repository agents | **Pipeline configuration → CLI runtimes** | Git, the installed/authenticated CLI, an agent library and a target Git repository |
| Run Forge's governed nine-stage delivery pipeline | **Models & providers**, then **Forge cockpit** | Forge, Python, Linux Docker, a reviewed image and four host input files |
| Review evidence from someone else's run | **Forge cockpit → Inspect evidence bundle** | An extracted, reviewed evidence directory; no model account |
| Describe the project for an orchestrator | **Project facts** | Reviewed stack, command descriptions, architecture references and team decisions |

**Copilot is a CLI runtime, not an HTTP provider preset.** Console supports Copilot for standalone agents. The governed Forge host currently uses HTTP model providers and cannot route stage roles through a Copilot or Claude Code subscription. An Anthropic API connection and a Claude Code login are separate setups. Do not paste a CLI session token into the provider registry.

## 1. Try a small standalone review

### Connect your assistant

1. Install Git and your chosen assistant using the official [Copilot CLI setup](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli) or [Claude Code setup](https://code.claude.com/docs/en/quickstart).
2. Open a terminal. Run `copilot login` for Copilot, or `claude` and follow the Claude sign-in flow. Confirm the CLI works on your computer, then fully restart Console so it sees the updated environment.
3. Open **Pipeline configuration → CLI runtimes**. Both assistants are listed even when not installed. Click **Refresh runtimes**. If automatic discovery misses the installation, use **Choose … executable**.
4. Click **Test … connection**. This makes a small provider request and can consume plan allowance; no test runs automatically. **Installed** only means executable discovery succeeded. A successful test reports that the account reached the provider.
5. Click **Use GitHub Copilot for a workflow** or **Use Claude Code for a workflow**. Console returns to Workflows with that runtime selected. The CLI's configured model is used; Console does not force a specific model.

For corporate proxy/VPN/certificate setup, open **Connections → Network & Proxy** before testing. See [troubleshooting](troubleshooting.md).
Connections stays in the main window. Save your settings, then use **Back to previous page** to return to your setup screen without losing its inputs. `Cmd/Ctrl+,` opens Connections from any page.

On Windows, choose the installed native CLI `.exe`. Console rejects `.cmd`/`.bat` launchers for agent runs to keep task text and agent definitions out of a command shell.

### Select a library and target

A **workflow library** contains instructions. A **target repository** contains the code to inspect or change. They can be different repositories.

If you have the Console source checkout, use its [`examples`](../examples/) directory as a starter library. It contains one ordinary, read-only agent at [`agents/readme-review.md`](../examples/agents/readme-review.md). Otherwise use your team's reviewed standalone library.

1. Click **Choose workflow folder** and select `forge-console/examples` (the directory containing `AGENTS.md` and `agents/`).
2. Select **Readme Review** under the specialist agents.
3. Select a small target Git repository. Start with a clean checkout so the first result is easy to review. Console records the base revision and snapshots the current checkout into an isolated worktree; workflow instructions come from the selected library.
4. Enter this task:

   > Review the README setup instructions and list missing steps. Do not edit files.

5. Select your connected runtime and prepare the run. Inspect the exact target, base revision and requested permissions. This example needs repository reads; shell commands, writes and service credentials are unnecessary.
6. Approve the prepared run. Follow its progress and answer any requested input.
7. Review the final findings. This example should produce source-referenced feedback with no changed files. Other agents may propose changes in an isolated worktree; inspect those before applying, committing or publishing.

A worktree is not an OS sandbox. Approve shell or other privileges only when the reviewed agent needs them. The recognised Forge/RGR stage agents are deliberately blocked here: use the governed cockpit for those.

### Maintain the library once

Use this layout in your own workflow repository:

| Path | Purpose |
| --- | --- |
| `AGENTS.md` | Entry instructions, workflow and links to the catalogs |
| `agents/<agent>.md` | Canonical role prompt with `name` and `description` frontmatter |
| `skills/<skill>/SKILL.md` | Reusable instructions, read only when relevant |

Console prefers `agents/` over `.github/agents/` and `.claude/agents/` for duplicate agent identities. Duplicate identities within the same directory tier are rejected. Legacy libraries continue to work. Keep filenames and frontmatter names aligned for predictable native selection.

Claude receives session discovery definitions pointing to the canonical files. Copilot receives temporary discovery files in the isolated worktree; pre-existing native Markdown is backed up and restored when the process exits. Source libraries are not modified. Adapters supply the library root so subagents can read `AGENTS.md` and relevant skills. Reading a skill never grants additional permission.

## 2. Prepare a governed Forge run

Use this path for Forge's PREPARE → BRAINSTORM → PLAN → ANALYZE → RED → GREEN → REFACTOR → VERIFY → CONVERGE sequence.

### Prepare the model configuration

1. Open **Pipeline configuration → Models & providers** and choose a provider preset or compatible gateway. Enter its complete API base URL, protocol, locality and authentication. Save the provider.
2. Click **Discover models**, then add an advertised model to a profile. If discovery is unavailable, open **Profiles & routing**, create a profile, add a model and enter its exact deployment/model ID.
3. Use **Use as default for all roles** to populate the routes, then adjust individual roles and ordered fallbacks as needed. Every role, including specialists, needs a primary route for export.
4. Save the profile. Run the synthetic diagnostics explicitly. They check requests for generation, streaming, structured output and tool calling; a passing diagnostic is not a trusted capability registration or proof of task quality.
5. Review the model/locality/fallback preview, tick the acknowledgement and **Export reviewed profile**. Choose a new filename such as `runtime-configuration.json`. Credentials remain in the native vault or named host environment; the file contains references.

### Register the host and inputs

Follow [Forge's governed-host walkthrough](https://github.com/sashafelix/forge/blob/main/docs/governed-host.md) for the exact input schemas and reviewed image setup. Console does not invent a trusted policy or capability inventory from probe results.

| File | What it establishes |
| --- | --- |
| Runtime configuration | Provider endpoints, model bindings and ordered role routes |
| Execution policy | Source/test write roots, command argv, immutable image and limits |
| Capability inventory | Independently trusted adapter registrations tied to the exact bindings |
| Story risk facts | Scope and risk facts used to resolve the run profile |

1. Install a compatible Forge checkout and Python 3.11+. Make a Linux Docker engine and the reviewed immutable test image available. The host does not pull images or silently use a host shell.
2. Open **Forge cockpit → New governed run**. Select the trusted Forge checkout and Python executable, then the four input files. Console pins their contents. Changes to agent instructions, skills, contracts or host code require renewed host review/selection.
3. Click **Check host readiness**. Resolve every reported issue before preparing a run. This check does not call a model or approve execution.
4. Select a clean target Git repository and a small, concrete task with observable acceptance criteria. Prepare the run.
5. Review the start checkpoint: base revision, allowed source/test roots, command arguments, image, providers and limits. Click **Approve and continue** when those match your intent.
6. Follow the stage trace. Open Evidence to inspect tests and logs. Review any later checkpoint before continuing.
7. After completion, inspect the final diff and independent verification evidence. Applying, committing, pushing, merging and deploying remain separate actions.

The native governed bridge supports macOS/Linux with Linux Docker. On Windows, run the Forge host in WSL and import its evidence into Console. Standalone CLI workflows remain available on Windows.

If a run stops, inspect its original error. Use only the recovery action offered by the host; retry starts from the selected stage checkpoint and requires fresh approval. See [cockpit recovery](cockpit.md#failure-and-recovery).

## 3. Inspect evidence without running a model

1. Open **Forge cockpit → Inspect evidence bundle**. Select an extracted run `bundle` directory or a canonical evidence directory. Console does not extract or execute archives. Verify a shared portable archive with Forge's export verifier before extracting it.
2. In Overview, check the story, base revision, profile, completed stages and evidence level. Imported completion labels alone do not prove execution.
3. In Evidence, follow an acceptance criterion to its locked test IDs and command logs. Open artifacts for the detailed output.
4. In Diff, review an available local `changes.patch`. Source-free portable exports intentionally omit this patch.
5. In Events, follow the run's stage/failure history. Compare can contrast another run's metadata and criterion results.

Imported evidence stays read-only and never gets Approve/Continue/Retry controls. **Evidence files checked** means bounded structural/hash inspection; **Local host receipts verified** additionally reconciles a managed completed run with its private registered host ledger. See [evidence levels](cockpit.md#inspect-an-existing-run).

## Project facts and everyday use

**Project facts** saves stack, commands, architecture references, modules, decisions and constraints to a separate `project-profile.json`. Import an existing profile or create a new one, review changes, then export a new file. From Forge, validate it with:

```bash
python3 scripts/validate-project-profile.py /path/to/project-profile.json
```

Supply that reviewed profile to your orchestrator as project context. It is not one of the four governed host inputs and does not authorize command execution. Non-secret drafts persist; review acknowledgements and entered secrets do not.

When updating a source installation, pull the reviewed changes, run `npm ci`, stop the previous development process and run `npm run dev` again. Packaged installations require an updated build; merging a PR does not update an already installed app.

For more detail: [models and routing](model-configuration.md), [cockpit](cockpit.md), [troubleshooting](troubleshooting.md), [security](security.md), and [distribution](distribution.md).

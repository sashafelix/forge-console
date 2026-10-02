# Troubleshooting

## Local RGR will not launch from the workbench

This is expected. Recognised Local RGR packs and agents are configuration-only; prepare, start and reply/resume are blocked in the main process. Export reviewed project/model configuration and validate it in the pipeline repository. History and cancellation remain available. See [the configuration handoff](pipeline-configuration.md).

## A model test passed but execution is unavailable

Discovery and synthetic capability tests only check the configured provider. Neither the model registry nor the legacy Self hosted LLM connection installs a controller-mediated HTTP execution loop. Execute the pipeline in its supported coding environment; see [model configuration](model-configuration.md) for preflight and capability limits.

## Claude Code or Copilot is unavailable

Install and authenticate the selected CLI separately, and confirm Git and that CLI work against the target repository. GUI applications may inherit a smaller `PATH`; select an executable explicitly in the UI if discovery misses it. Copilot must support the required programmatic/custom-agent permission flags. Its custom-agent source must be under `.github/agents/` or `.claude/agents/`.

The Connections vault supplies declared service variables; it does not replace provider CLI login. Review inherited environment variables as well as the approved connection requirements.

## Model discovery, credentials or connectivity fail

Check the selected protocol, endpoint/base URL, model ID and provider credential. A provider may support manual model IDs even when listing is unavailable. Review the diagnostic result and run a synthetic test explicitly; do not infer capability from a model name.

The model registry refuses credential storage if a supported encrypted keyring is unavailable, including Linux `basic_text`. Configure an OS keyring rather than weakening storage checks. The legacy Connections vault has different fallback checks; see [security](security.md).

Review proxy mode and endpoint access. Model-registry requests use Electron networking and OS trust; the optional child-process CA setting does not automatically configure an equivalent custom CA for those requests. Do not bypass certificate verification.

## Export or project-facts changes disappear

Exports create new files and never overwrite an existing file, even if the native dialog offers replacement. Choose a fresh filename. Model exports require the registry revision reviewed by the operator; review again after changing it.

Project facts are a new-profile form, not an existing-file editor. Switching to Models or leaving configuration discards unsaved project facts. Preview and export while the form is open. Model-profile draft persistence is separate.

## A run was interrupted

Restarting the app recovers records and preserves the worktree. Runs left preparing, running or validating are marked failed; the original process is not automatically restarted. Inspect the recorded error and existing changes before starting another run. A run waiting for input can retain its question and continue through the reply flow if its definition is still executable.

## Blank Electron window during development

Use Node.js 22.12 or newer. Run `npm install`, then `npm run dev` from the repository root and open the Electron window. The renderer URL (`http://127.0.0.1:5173`) is an internal Vite development server, not a standalone browser app.

If Electron reports an unavailable preload script or module, stop the development process with Ctrl+C, close its Electron window, and run `npm run dev` again. The launcher waits for the Vite endpoint and compiled Electron entry files. Use `npm run typecheck` and `npm run build` to distinguish compilation errors from launch problems. Sandboxed preload scripts must be self-contained or bundled.

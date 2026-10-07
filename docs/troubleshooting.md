# Troubleshooting

## Local RGR will not launch from the workbench

Generic controllers deliberately block recognised Local RGR pack/agent execution. Use the separate **Forge cockpit** with a registered governed host and reviewed operator inputs, or run your existing adapter in its coding environment. See [the integration guide](cockpit.md).

## A model test passed but execution is unavailable

Discovery/probes are diagnostics. The cockpit needs reviewed Forge code, Python, a reachable Linux Docker engine, an installed immutable image, execution policy, risk facts and independently established adapter registrations. Check Doctor and the exact binding hashes; a passing probe cannot supply those grants.

## Claude Code or Copilot is unavailable

Install and authenticate the selected CLI separately, and confirm Git and that CLI work against the target repository. GUI applications may inherit a smaller `PATH`; select an executable explicitly in the UI if discovery misses it. Copilot must support the required programmatic/custom-agent permission flags. The CLI must also support `--add-dir` to read the selected library. Canonical `agents/` files are staged automatically for the run; legacy `.github/agents/` and `.claude/agents/` sources remain supported. Use **Pipeline configuration → CLI runtimes** to choose an executable and test its connection.

The Connections vault supplies declared service variables; it does not replace provider CLI login. Review inherited environment variables as well as the approved connection requirements.

On Windows, select the runtime's native `.exe` for standalone agent runs. Console rejects `.cmd`/`.bat` wrappers so task text and generated agent JSON cannot be interpreted as shell commands. A wrapper may pass executable discovery or a connection check while still being unsuitable for an agent run. Install the native CLI or use the CLI directly in WSL.

## Where is Copilot in the configurator?

Choose **CLI runtimes** or **Set up Copilot or Claude**. Copilot uses its CLI login and runs standalone workflows. **Models & providers** configures HTTP models for the governed Forge host; a Copilot subscription is not a provider API key. The [quickstart](quickstart.md) explains both paths.

## Configuration still shows old controls

Restart an updated build. For source installs, pull the reviewed changes, run `npm ci`, stop the old development process and restart with `npm run dev`. A merged change does not replace a running or packaged installation. Configuration uses the same theme selector as the cockpit.

## Model discovery, credentials or connectivity fail

Check the selected protocol, endpoint/base URL, model ID and provider credential. A provider may support manual model IDs even when listing is unavailable. Review the diagnostic result and run a synthetic test explicitly; do not infer capability from a model name.

Both stores reject unavailable encryption and Linux `basic_text` when reading/saving credentials. Configure a secure keyring; re-enter legacy fallback credentials. See [security](security.md).

Review proxy mode and endpoint access. Model-registry requests use Electron networking and OS trust; the optional child-process CA setting does not automatically configure an equivalent custom CA for those requests. Do not bypass certificate verification.

## Export or project-facts changes disappear

Exports create new files and never overwrite an existing file, even if the native dialog offers replacement. Choose a fresh filename. Model exports require the registry revision reviewed by the operator; review again after changing it.

Non-secret project facts persist locally across navigation/restarts. Imported profiles preserve supported fields and show changed fields. Review acknowledgement always resets; preview/review again before create-only export. A corrupt or excessive draft is discarded safely.

## A run was interrupted

Restarting the app recovers records and preserves the worktree. Runs left preparing, running or validating are marked failed; the original process is not automatically restarted. Inspect the recorded error and existing changes before starting another run. A run waiting for input can retain its question and continue through the reply flow if its definition is still executable.

## Blank Electron window during development

Use Node.js 22.12 or newer. Run `npm ci`, then `npm run dev` from the repository root and open the Electron window. The renderer URL (`http://127.0.0.1:5173`) is an internal Vite development server, not a standalone browser app.

If Electron reports an unavailable preload script or module, stop the development process with Ctrl+C, close its Electron window, and run `npm run dev` again. The launcher waits for the Vite endpoint and compiled Electron entry files. Use `npm run typecheck` and `npm run build` to distinguish compilation errors from launch problems. Sandboxed preload scripts must be self-contained or bundled.

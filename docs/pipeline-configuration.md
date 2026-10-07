# Forge configuration boundary

The configuration hub offers **Get started**, **CLI runtimes**, **Models & providers**, **Project facts**, and **Quickstart guides**. See the [first-use guide](quickstart.md) for complete paths through each setup.

Configuration integrates with [Forge](https://github.com/sashafelix/forge) through explicit file handoffs. The separate [cockpit](cockpit.md) can also control a registered governed host. Both repositories remain independent; Forge owns execution/governance and the native bridge preserves that authority.

| Concern | Owner |
|---|---|
| Edit project facts, model preferences and preview/export JSON | UI configuration forms |
| Explicitly supply and validate a project profile | Operator and pipeline |
| Stage order, role authority and risk resolution | Pipeline |
| Runtime routing and command permissions | Pipeline and its runtime adapter |
| Checkpoints, independent verification and evidence | Pipeline |
| Merge/deployment decisions | Existing operator/platform process |

See [Models, providers and routing](model-configuration.md) for the separate runtime configuration workflow, including discovery, diagnostic probes, named profiles, local-only policy and trusted pipeline validation. These preferences do not install execution adapters or grant role authority.

## Project-facts handoff

Project facts describe the **target repository you want Forge to work on**. They are optional reusable context. Start with its README, package/build files, CI configuration and architecture notes; use facts you can verify. Enter the current change request when starting a run.

The form provides generic placeholders and persistent help for every field, without assuming a particular language or framework. **See a complete example profile** shows a separate fictional TypeScript web app; **Show module example** and **Show decisions example** explain the JSON fields. Placeholders and examples leave your draft untouched.

For a minimal profile, enter Project ID, Prepared by and Languages / stack, then review the default profile version (`1`) and project root (`.`). Add the remaining facts as you learn them.

| Field | What belongs here | Example |
|---|---|---|
| Project ID (required) | Stable target-project identifier, usually the repository name | `example-webapp` |
| Profile version (required) | Revision of these facts; increment when publishing an update | `1` |
| Prepared by (required) | Person or team responsible for reviewing the facts | `Example engineering team` |
| Project root (required) | Target repository path as seen by the pipeline | `.` when the pipeline's working directory is that repository |
| Languages / stack (required) | Languages and runtimes, one per line | `TypeScript`, `Node.js` on separate lines |
| Frameworks | Main application, build and test frameworks, one per line | `React`, `Vite`, `Vitest` on separate lines |
| Build / test / lint commands | Actual commands from project scripts or CI, run from the project root; tests should finish without watch mode | `npm run build`; `npm run test -- --run`; `npm run lint` in their respective fields, if those scripts exist |
| Architecture style | How the application is organised | React single-page app with feature modules and a REST API client |
| Architecture reference | Path or URL of the current architecture documentation | `docs/architecture.md` |
| Environment description | Development platforms, CI environment and required services | macOS/Linux development; Ubuntu CI; disposable PostgreSQL in Docker for integration tests |
| Project constraints | Established compatibility, data or product requirements, one per line | Keep existing public API responses compatible. |
| Modules | JSON array mapping code areas to their paths and purpose | Each object has exactly `name`, `path` and `purpose`; keep `[]` if unknown |
| Project decisions | JSON object of agreed technical choices, with text values | `{"package_manager":"npm; commit package-lock.json"}`; keep `{}` if none are recorded |
| Original source reference | Optional document or reference used to prepare the profile | `docs/project-context.md`; leave blank when there is no existing source |

For example, the Modules field could contain:

```json
[
  { "name": "Web app", "path": "src", "purpose": "User interface and feature logic" },
  { "name": "API client", "path": "src/api", "purpose": "Typed requests to the backend" }
]
```

Use your project's actual paths and commands. Optional text fields may remain blank. Modules and decisions must retain valid JSON (`[]` and `{}` are valid empty values). Commands are stored as text; execution permissions and approvals are configured through the run policy.

1. Open **Pipeline configuration → Project facts** from the guided workbench.
2. Enter project identity, stack, architecture references, command descriptions and constraints. Unknown optional facts can remain blank. Credentials belong in the existing connection system, never in project facts.
3. Preview the generated JSON and confirm the facts have been reviewed.
4. Export to a new file through the native save dialog. Existing files are never overwritten, including when the OS dialog offers replacement. Use a new filename for a revision.
5. From the pipeline checkout, run `python3 scripts/validate-project-profile.py /path/to/project-profile.json` and explicitly supply the reviewed profile to the orchestrator.

The export matches project-profile schema `1.0`. Non-secret drafts survive navigation/restarts; review acknowledgement does not. Import an existing profile through the native picker to preserve all supported fields, including modules, decisions and source references. Changed fields are listed for review; unknown fields/authority-bearing decision keys are rejected rather than silently discarded. Exports remain new files and use renewed operator provenance. Forge's validator remains canonical.

Validation in the UI checks its bounded form input and emits a fixed contract shape. The pipeline's schema/authority validator remains canonical. A `provenance.source` label is an assertion, not authentication; only an independently supplied operator/platform file may be bound as trusted. Repository-discovered files cannot promote themselves. Export does not bind a run, execute commands, test a runtime, resolve a risk profile or approve anything.

The bundled pipeline manifest is a non-executable reference/preview of the nine stages. It has no execution contract and is not the pipeline engine. The main-process controllers also reject known Forge and legacy RGR pack/agent identifiers and filenames on prepare, start and reply/resume, including previously prepared records. History and cancellation remain available. Other agents retain their existing workflow. This guard prevents accidental launch of recognised RGR definitions; it is not a sandbox for renamed or arbitrary agent content.

## Governed execution integration

The opt-in cockpit registers selected Forge code/Python and four reviewed operator inputs, pins their hashes, and uses the host's status/events/actions. It offers nine-stage trace, checkpoint review, explicit recovery and read-only bundle inspection. Imports never gain executable handles. Tests cover the bridge, permissions, path/sender/credential boundaries and user interactions; browser CI records screenshots. Forge additionally qualifies its controlled full host fixture through Docker CI. Neither fixture claims live model quality, native keyring certification or distributed scheduling. See [the cockpit guide](cockpit.md).

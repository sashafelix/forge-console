# Forge configuration boundary

The first integration with [Forge](https://github.com/sashafelix/forge) is a file handoff. Keep both repositories independent: the UI prepares project facts and model configuration, and the pipeline owns execution and governance.

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

1. Open **Pipeline configuration → Project facts** from the guided workbench.
2. Enter project identity, stack, architecture references, command descriptions and constraints. Unknown optional facts can remain blank. Credentials belong in the existing connection system, never in project facts.
3. Preview the generated JSON and confirm the facts have been reviewed.
4. Export to a new file through the native save dialog. Existing files are never overwritten, including when the OS dialog offers replacement. Use a new filename for a revision.
5. From the pipeline checkout, run `python3 scripts/validate-project-profile.py /path/to/project-profile.json` and explicitly supply the reviewed profile to the orchestrator.

The export matches project-profile schema `1.0` from Local RGR `2.3.0` (upstream commit `2538062338af41fbb7ca0b53870a3bb9d3134934`). The form prepares a minimal profile: `modules` and `decisions` start empty and can be edited in JSON before canonical validation. It is a new-profile builder, not an existing-file editor. Unsaved project-facts state lasts only while that form remains mounted: switching to Models or closing configuration discards it. Model-profile drafts have their own persistence; that does not persist project facts.

Validation in the UI checks its bounded form input and emits a fixed contract shape. The pipeline's schema/authority validator remains canonical. A `provenance.source` label is an assertion, not authentication; only an independently supplied operator/platform file may be bound as trusted. Repository-discovered files cannot promote themselves. Export does not bind a run, execute commands, test a runtime, resolve a risk profile or approve anything.

The bundled pipeline manifest is a non-executable reference/preview of the nine stages. It has no execution contract and is not the pipeline engine. The main-process controllers also reject known Forge and legacy RGR pack/agent identifiers and filenames on prepare, start and reply/resume, including previously prepared records. History and cancellation remain available. Other agents retain their existing workflow. This guard prevents accidental launch of recognised RGR definitions; it is not a sandbox for renamed or arbitrary agent content.

## Future execution integration

Any execution integration needs a separate opt-in proposal and conformance suite before becoming available. Demonstrate stage/role preservation, profile escalation, independent verification, checkpoint enforcement, exact evidence handling, bounded remediation, failure recovery and interruption/resume. No claim of full orchestration compatibility is made by the configuration export.

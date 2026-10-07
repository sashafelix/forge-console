# Forge configuration boundary

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

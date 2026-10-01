# Models, providers and routing

Open **Pipeline configuration → Models & providers**. The registry stores multiple named provider connections and reusable model profiles. It prepares configuration for Local RGR; it does not start RGR runs or install an HTTP execution adapter.

## Connect and configure

1. Choose OpenAI, Anthropic, Google Gemini, Ollama, LM Studio, vLLM or a custom gateway. Presets provide editable connection defaults, not a fixed model catalogue.
2. Check the **API protocol**, complete **base URL** (including any version/path prefix), authentication and locality. Save the provider. Keys are held by the main process and encrypted with the operating-system keyring; they are not included in drafts or exports. An unavailable keyring blocks storing credentials, but unauthenticated local services remain usable.
3. Click **Discover models** or enter an exact model/deployment ID in a profile. Discovery only checks the advertised list. Servers without a listing endpoint can still be configured manually.
4. Create a named profile, optionally associate a project ID, and add one or more model bindings. Set a default for every role, then adjust individual roles and their ordered fallback chains. Duplicate a profile for another project or environment.
5. Save the profile and explicitly run generation, streaming, structured-output and tool-call diagnostics. Results include time and latency. Connection, model, parameter or credential edits invalidate saved results. A passing probe is evidence about that request, not a model-quality benchmark or an execution approval.
6. Review the secret-free JSON preview, check the review box and **Export reviewed profile** to a new file. Supply credentials separately to your trusted runtime host. Validate the file using the companion pipeline command below.

```bash
python3 scripts/validate-runtime-configuration.py /path/to/runtime-configuration.json
```

An import first shows a review dialog, then creates new providers and a new profile with fresh identities. It does not reuse existing credentials, import diagnostic claims, contact endpoints or replace existing profiles. Exports and saves are checked against the current registry revision so another window cannot silently replace the configuration you reviewed.

The current provider/profile drafts survive reopening the screen or app on the same installation; entered secrets do not. Selecting another saved item replaces that item's unsaved editor draft, so save before switching. Saved profiles may contain incomplete routing, but export requires all governed roles to have a primary model. The separate **Project facts** form retains its existing new-profile workflow.

## Protocol support

| Protocol | Generation / streaming | Structured output | Tool-call diagnostic |
|---|---|---|---|
| OpenAI Responses | `responses`, SSE events | `text.format` JSON schema | Function call |
| OpenAI-compatible Chat Completions | `chat/completions`, SSE chunks | `response_format` JSON schema | Function call |
| Anthropic Messages | `messages`, SSE events | `output_config.format` JSON schema | Tool-use block |
| Gemini native | `generateContent` / `streamGenerateContent` | `responseJsonSchema` | Function call |

Any model exposed through one of these protocols can be entered, including self-hosted models and compatible gateways. This does not guarantee that every model supports every parameter or capability. Custom protocols, cloud-specific signing/OAuth and deployment-specific API shapes require another adapter or a compatible gateway. Bearer tokens, custom API-key headers and no authentication are supported today.

Temperature and reasoning effort are optional, provider-specific values. Blank means the provider default; rejected parameters are reported, not automatically rewritten. A server can silently ignore a parameter, which a successful synthetic response cannot reliably detect. Context budget is configuration metadata, not a claim that the model's context window has changed.

## Network and locality

- Probes use Electron networking with the proxy settings in Connections and the operating-system certificate trust store. A CA file selected in Connections is passed to CLI processes; it does not augment HTTP probe trust. Install your corporate CA in the OS trust store where required.
- HTTPS is required outside localhost unless a self-hosted connection explicitly opts into HTTP. Redirects are rejected so credentials are not forwarded to a different endpoint.
- **Local only** rejects every external binding, including fallback bindings. Locality is operator-declared: verify whether a local gateway forwards requests to cloud services.
- Requests have configurable timeouts, 1 MiB response limits and bounded discovery pagination/retries. Model probes are never retried automatically. Cancel stops the active probe and prevents remaining probes in that batch.
- Generation probes send fixed synthetic prompts and request at most 512 output tokens per request. Charges may apply. The tool-call diagnostic inspects arguments and never executes a tool. No repository source is included.

## Execution boundary and validation

Runtime configuration schema `1.0` is separate from the project-facts schema. It contains endpoints, credential references, model bindings and routing preferences; it contains no executable commands, capabilities, approvals or actual credentials. The UI's diagnostics are not exported as trusted capability attestations.

The pipeline validator independently checks the schema, cross-references, local-only policy and complete role mapping. Optional read-only route preflight additionally requires an independently trusted runtime inventory tied to exact provider/model binding hashes. Host registrations must satisfy the canonical stage/role capabilities. A configuration file cannot register its own adapter or promote repository content into operator authority.

The UI's existing RGR execution guards remain active. Its existing CLI runtimes, connection profiles and unrelated agent workflows continue separately; the legacy Self hosted LLM connection is not automatically migrated or injected into these profiles.

## Verification scope

Automated tests cover protocol request/response fixtures, fragmented SSE, timeouts/cancellation, bounded reads, encrypted credential persistence, stale-write/export rejection, local-only fallbacks, import isolation and renderer save/review flows. The identical exported fixture is validated by TypeScript and Python in the two repositories. CI also builds and smoke-packages the Electron app.

Live provider calls and native desktop/keyring behaviour still require a smoke test on the intended machine. Test with your chosen models, endpoint, OS keyring and proxy before treating a profile as ready for use. No live provider compatibility or governed HTTP execution certification is implied.

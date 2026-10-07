# Distribution

For a reviewable source pair and pilot evidence, use Forge's
[evaluation handover](https://github.com/sashafelix/forge/blob/main/docs/evaluation.md).
Record exact commits and passing CI, complete a live pilot, and resolve the owner
licence decision before describing a build as a stable evaluation release. Neither
repository currently includes a selected licence. Package generation does not
grant publication or reuse permission.

## Supported development packages

Forge Console is built from one Electron/React/TypeScript codebase and packaged independently on the target operating system.

| Platform | Architecture | GitHub runner | Outputs |
| --- | --- | --- | --- |
| macOS | Apple Silicon arm64 | `macos-15` | DMG and ZIP |
| macOS | Intel x64 | `macos-15-intel` | DMG and ZIP |
| Windows | x64 | `windows-latest` | NSIS installer and portable executable |
| Linux | x64 | `ubuntu-latest` | AppImage and DEB |

Building on target operating systems avoids relying on unsupported cross-platform native packaging assumptions.

## Forge Console naming and existing data

Desktop windows, application menus and package filenames use **Forge Console**. The application ID remains `com.frankhaughton.agentpipelineui`. The npm package name and internal Electron application identity stay `agent-pipeline-ui`, preserving the existing data directory and OS credential-store namespace for settings, encrypted credentials, installed packs and run history. Renderer draft keys and pack/agent identifiers also remain compatible. The source repository is [forge-console](https://github.com/sashafelix/forge-console).

## Producing artifacts

Use the **Package desktop** workflow in GitHub Actions or push a tag beginning with `v`.

The workflow performs the same checks on every platform:

1. install dependencies;
2. typecheck renderer and Electron code;
3. execute contract tests;
4. build the application;
5. package the configured targets;
6. upload the contents of `release/` as a workflow artifact.

Artifacts are retained for 14 days and are separated by operating system and architecture.

## Local packaging

Run on the target operating system:

```bash
npm ci
npm run package
```

For a fast unpacked smoke build:

```bash
npm run package:dir
```

## Signing status

Default packaging produces unsigned development builds. Version comes from `package.json` (`0.9.0`, currently unreleased). The manual workflow now offers **sign_artifacts** for macOS/Windows; missing certificates/notarization credentials block signed mode instead of silently producing unsigned packages. Tag builds remain unsigned by default. No certificate or verified signed installer is bundled.

Configure repository secrets `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` for Developer ID signing/notarization, and `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` for Windows signing. Certificate links use electron-builder's supported P12/PFX/base64 format; never commit certificates or keys. Select signed mode only after configuring them. Linux packages receive checksums rather than macOS/Windows signing. See [electron-builder signing](https://www.electron.build/docs/features/code-signing/) and [notarization](https://www.electron.build/docs/features/code-signing/notarization/); the repository pins electron-builder 26 and uses its `mac.notarize`/`forceCodeSigning` options.

Every packaging run writes `SHA256SUMS` and `SOURCE_REVISION` alongside artifacts. These establish source/byte correspondence, not a SLSA attestation or updater trust. The workflow never publishes a release automatically. Signature/notarization verification on the intended OS remains a release check requiring real credentials.

Consequences:

- macOS may block or warn through Gatekeeper;
- Windows may display a SmartScreen warning;
- automatic update trust is not yet established;
- packages are suitable for private testing, not broad public distribution.

Before public or organisational rollout, add:

- Apple Developer ID signing and notarisation;
- Windows Authenticode signing;
- trusted release provenance and checksums;
- signed pipeline-pack verification;
- an update channel with rollback protection.

## Runtime executables on macOS

Applications launched from Finder often receive a smaller environment than terminal shells. The application therefore searches common Homebrew and user CLI paths and also supports explicit executable selection in the UI.

Claude Code and GitHub Copilot own their CLI authentication. The UI separately stores a non-secret executable-path override, managed service connections and model-registry credentials; see [the security model](security.md) for their different storage guarantees. Self hosted HTTP configuration and tests do not enable execution.

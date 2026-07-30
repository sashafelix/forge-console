# Distribution

## Supported development packages

Agent Pipeline UI is built from one Electron/React/TypeScript codebase and packaged independently on the target operating system.

| Platform | Architecture | GitHub runner | Outputs |
| --- | --- | --- | --- |
| macOS | Apple Silicon arm64 | `macos-15` | DMG and ZIP |
| macOS | Intel x64 | `macos-15-intel` | DMG and ZIP |
| Windows | x64 | `windows-latest` | NSIS installer and portable executable |
| Linux | x64 | `ubuntu-latest` | AppImage and DEB |

Building on target operating systems avoids relying on unsupported cross-platform native packaging assumptions.

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
npm install
npm run package
```

For a fast unpacked smoke build:

```bash
npm run package:dir
```

## Signing status

Version 0.3 produces unsigned development packages.

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

Runtime credentials remain owned by Claude Code, GitHub Copilot or the future BMW LLM adapter. Agent Pipeline UI stores only a non-secret executable path override.

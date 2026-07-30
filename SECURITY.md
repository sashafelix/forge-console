# Security

Agent Pipeline UI is a local developer tool that may eventually execute AI runtimes and project commands. Security boundaries are therefore part of the product contract.

## Current guarantees

- the renderer has no direct Node.js access;
- Electron context isolation is enabled;
- renderer-to-main communication uses a narrow preload API;
- the initial UI cannot submit arbitrary shell strings;
- pipeline manifests are validated before use;
- run drafts are stored under Electron's per-user application data directory;
- no credentials are stored by version 0.1;
- no automatic merge, deployment or publication capability exists.

## Future requirements

Runtime and tool adapters must declare capabilities, validate all structured inputs, constrain filesystem access to authorised roots and keep secrets in operating-system credential storage. HTTP and MCP adapters must use explicit trust configuration and must never expose local control endpoints to the LAN by default.

Report security issues privately to the repository owner rather than opening a public issue.

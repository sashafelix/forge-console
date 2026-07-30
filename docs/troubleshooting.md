# Troubleshooting

## Blank Electron window during development

The renderer URL (`http://127.0.0.1:5173`) is an internal Vite development server. Open the Electron window rather than browsing to the URL directly.

When Electron reports `Unable to load preload script` or `module not found` from the preload, update to a version where the sandboxed preload is self-contained. Sandboxed preload scripts must not require local runtime modules unless they are bundled.

Restart cleanly:

```bash
pkill -f "Electron .*agent-pipeline-ui" 2>/dev/null || true
npm run dev
```

The development launcher waits for the Vite HTTP endpoint and both compiled Electron entry files before starting Electron.

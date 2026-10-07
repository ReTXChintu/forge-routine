# ForgeRoutine Agent

A small helper that lets ForgeRoutine use the **Claude Code** and **Codex** already installed
and signed in on your computer, with no API key.

It is not ForgeRoutine itself: you keep using ForgeRoutine in the browser. A web page cannot
start programs on your computer, so the agent connects to the ForgeRoutine server instead and
runs the CLIs when the server needs an answer for you.

- **Agent running:** AI calls go to your local CLIs first, in the order set in
  Settings → AI → ForgeRoutine Agent.
- **Agent closed, or both CLIs fail:** calls fall back to your saved API keys: the selected
  vendor first, then any other saved key. With **Off** selected, no key is used.

## Use it

1. Install it (see _Build_), then open **ForgeRoutine Agent**.
2. In ForgeRoutine, open **Settings → AI → Connect the agent** and type the code into the agent.
3. Keep the agent running while you study. Closing its window keeps it in the tray; quit it from
   the tray icon.

To unpair, use **Disconnect** in Settings. That revokes the agent's token on the server.

## How it works

The agent keeps one WebSocket open to `/api/v1/agent/connect`, authenticated with a device token
it received for the pairing code. Only a hash of that token is stored on the server. The server
sends **jobs described by meaning** (tool, prompt, schema, model), never command lines. The agent
builds the arguments itself in `src-tauri/src/tools.rs`, mirroring the server's own providers,
and refuses anything else. Claude Code runs with all file, shell and web tools denied; Codex runs
in its read-only sandbox. Both run in an empty temporary directory.

It finds the CLIs the same way the server-side providers do: `CLAUDE_CODE_BIN` / `CODEX_BIN`
if set, then the Codex desktop app's bundled CLI (Windows), PATH and the usual install folders.

## Build

Requires Rust (stable) and, on Windows, WebView2 (included with Windows 11).

```bash
pnpm agent:dev     # run it from source
pnpm agent:test    # Rust tests (argument lists, CLI discovery)
pnpm agent:build   # installer: src-tauri/target/release/bundle/nsis/
```

The server it connects to defaults to the deployed API (`DEFAULT_SERVER` in
`src-tauri/src/state.rs`). For local development, change it under **Server** on the pairing
screen.

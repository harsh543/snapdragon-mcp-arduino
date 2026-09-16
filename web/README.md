# SignalGuard web chat

A Next.js chat UI, deployed on Vercel, that talks to Qwen3 running locally on
a Snapdragon X Elite via GenieX, and calls tools on the Arduino Uno Q through
MCP - the same SignalGuard safety gate as the CLI client in
[`../x_elite/client.py`](../x_elite/client.py), but the ambiguity/blast-radius
flag is a visible approval card in the browser instead of a terminal prompt.

```text
Browser (Vercel) -> Next.js API route -> tunnel -> GenieX (Snapdragon X Elite)
                                       -> tunnel -> FastMCP (Arduino Uno Q, via ADB forward)
```

Because this route runs on Vercel's servers, not on your Snapdragon machine,
it cannot reach `127.0.0.1:18181` or `127.0.0.1:3001` directly. Both need a
public tunnel.

## Why two tunnels, not one

Both services run on the **same Windows Snapdragon X Elite machine** - no
Arduino Uno Q, no ADB. They're still two independent processes on two
different ports, so each needs its own tunnel:

- **GenieX** (`geniex serve`, port 18181) - the model backend for chat and
  for the guardrail's own ambiguity check.
- **`x_elite/mcp_server.py`** (port 3001) - a standalone MCP server with
  simulated tool responses (`get_board_status`, `flash_heart`,
  `trigger_alert`). No hardware required; see the main
  [README](../README.md#running-the-mcp-server-standalone-no-arduino) for
  how to run it.

## Setup

1. On the Snapdragon X Elite, with `geniex serve` and
   `python -m x_elite.mcp_server` both already running, start two tunnels,
   e.g. with `ngrok`:

   ```powershell
   ngrok http 18181
   ngrok http 3001
   ```

   Each prints a public `https://*.ngrok-free.app` URL. These change every
   time you restart ngrok on the free tier - budget time to re-set the env
   vars before a demo, or use a reserved domain.

2. Set the env vars on Vercel (values from step 1's ngrok output, plus the
   `/v1` and `/mcp` suffixes):

   ```bash
   vercel env add GENIEX_URL production
   vercel env add MCP_URL production
   vercel env add GENIEX_MODEL production   # e.g. qualcomm/Qwen3-4B-Instruct-2507
   vercel env add TOOL_APPROVAL_SECRET production   # openssl rand -base64 32
   ```

   See [`.env.example`](.env.example) for the exact shape expected.

3. Redeploy so the new env vars take effect (setting them does not affect an
   already-built deployment):

   ```bash
   vercel --prod
   ```

## Local development

For local iteration, `GENIEX_URL`/`MCP_URL` can point straight at
`http://127.0.0.1:18181/v1` and `http://127.0.0.1:3001/mcp` in `.env.local`
(untracked) - no tunnel needed if `next dev` runs on the same Snapdragon
machine as GenieX and the MCP server.

```bash
npm install
npm run dev
```

If you tunnel straight to the local dev server (e.g. `ngrok http 3000` at the
app itself, rather than only tunneling GenieX/MCP), Next.js will reject the
request with "Blocked cross-origin request" - this is a dev-only protection
against DNS rebinding, not a bug. `next.config.ts` already allowlists
`*.ngrok-free.app`, `*.ngrok.io`, and `*.ngrok.app`; add your tunnel provider's
domain there if you're using something else. This does not apply to the
deployed Vercel app - production builds don't have this restriction.

## How the guardrail flag works here

`app/api/chat/route.ts` passes a `toolApproval` function to `streamText`:
tools tiered `SAFE` in [`lib/risk-registry.ts`](lib/risk-registry.ts) (mirrors
`x_elite/risk_registry.py`) run immediately; everything else (`trigger_alert`)
triggers [`lib/guardrail.ts`](lib/guardrail.ts) - the same ambiguity check as
the Python guardrail, reusing its exact system prompt - and returns a
`user-approval` status with the blast-radius summary as the `reason`.

In the browser, that shows up as an amber approval card (`app/page.tsx`) with
Proceed/Block buttons, driven by the AI SDK's native tool-approval UI state
(`part.state === 'approval-requested'`, `addToolApprovalResponse`) rather than
a hand-rolled banner - no custom protocol needed.

## Caveats

- `TOOL_APPROVAL_SECRET` is optional but recommended: without it, a modified
  client could in principle fabricate an approval response, since `useChat`
  sends the full message history from the client each turn.
- Running the model-facing tunnel and the demo through Vercel adds a network
  hop that a fully local setup wouldn't have - if the "no cloud round-trip"
  story matters for judging, mention that this web UI is a convenience
  interface and the CLI path (`x_elite/client.py`) is the fully on-device one.

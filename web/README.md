# SignalGuard web chat

A Next.js chat UI, deployed on Vercel, that talks to Qwen3 running locally on
a Snapdragon X Elite via GenieX, and calls tools on
[`x_elite/mcp_server.py`](../x_elite/mcp_server.py) through MCP - the same
SignalGuard safety gate as the CLI client in
[`../x_elite/client.py`](../x_elite/client.py), but with a persistent trace
panel and two independent checks in front of every tool call instead of a
single terminal prompt.

```text
Browser (Vercel) -> Next.js API route -> tunnel -> GenieX (Snapdragon X Elite)
                                       -> tunnel -> x_elite/mcp_server.py (same machine)
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
   vercel env add CLASSIFIER_MODEL production   # e.g. ai-hub-models/Qwen3-0.6B
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

## Two independent layers in front of every tool call

`app/api/chat/route.ts`'s `toolApproval` function runs, in order, for
**every** tool call - not just ones tiered risky. All decisions are
**automatic** (testing mode - see note below); nothing pauses the chat
waiting for a manual click:

1. **Classifier** ([`lib/classifier.ts`](lib/classifier.ts)) - a second,
   smaller model (`CLASSIFIER_MODEL`, not `GENIEX_MODEL`) with no say in what
   the agent calls next, only whether the call it already chose looks
   malicious. A `MALICIOUS` verdict is a hard, automatic deny - because the
   point is not trusting a single model's judgment about its own actions.
2. **Ambiguity guardrail** ([`lib/guardrail.ts`](lib/guardrail.ts)) - runs
   when a tool is tiered `CONFIRM_REQUIRED` in
   [`lib/risk-registry.ts`](lib/risk-registry.ts) (mirrors
   `x_elite/risk_registry.py`) or the classifier flagged `SUSPICIOUS`. Same
   ambiguity check and system prompt as the Python guardrail; its reasoning
   is preserved as the automatic approval's `reason`, even though nothing
   blocks on it.

Both surface through the AI SDK's native tool-approval UI state
(`part.state === 'approval-responded'` / `'output-denied'`) in
`app/page.tsx`'s trace panel - a badge and the check's own reasoning text
for every decision. No hand-rolled protocol.

**Why automatic, not manual:** an earlier version used `{ type: 'user-approval' }`
for CONFIRM_REQUIRED tools, pausing the stream for a Proceed/Block click.
That triggered the AI SDK's interactive-approval stream-pause path, which
threw `Error: failed to pipe response` (cause: `DataError: Zero-length key
is not supported`) here, and separately left a window where sending a new
message before responding to the pending approval threw
`AI_MissingToolResultsError`. Switching every outcome to `'approved'` /
`'denied'` (decided immediately, never waiting on the client) removes both
failure modes while keeping every check and its full reasoning intact and
logged. If you want the interactive click-to-approve UX back for a specific
tool, that's a one-line change back to `'user-approval'` in
`route.ts` - just be aware it reintroduces the stream-pause bug above,
which hasn't been root-caused (only worked around by avoiding it).

### The demo tools

[`x_elite/mcp_server.py`](../x_elite/mcp_server.py) also exposes a small
repo-cleanup tool set that recreates the shape of the incident this project
is built around (an ambiguous "remove other branches" instruction resolved
into deleting every *remote* branch, with no confirmation):

- `list_branches` - `SAFE`
- `delete_branch(name, scope)` - `CONFIRM_REQUIRED`, scoped to `local` or
  `remote`
- `wipe_repository()` - `CONFIRM_REQUIRED` and always classifier-flagged
  `MALICIOUS`: no scope parameter, deletes every non-main branch on the
  remote in one call

Try **"clean up the other branches"** - vague enough that the model may
reach for `wipe_repository`, which the classifier should catch and
auto-deny before it "executes" (the tool is simulated - nothing is actually
deleted).

## Caveats

- `TOOL_APPROVAL_SECRET` is optional but recommended: without it, a modified
  client could in principle fabricate an approval response, since `useChat`
  sends the full message history from the client each turn.
- Running the model-facing tunnel and the demo through Vercel adds a network
  hop that a fully local setup wouldn't have - if the "no cloud round-trip"
  story matters for judging, mention that this web UI is a convenience
  interface and the CLI path (`x_elite/client.py`) is the fully on-device one.

import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  type ModelMessage,
  type UIMessage,
} from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createMCPClient } from '@ai-sdk/mcp';
import { riskTier } from '@/lib/risk-registry';
import { assessGuardrail } from '@/lib/guardrail';
import { classifyToolCall } from '@/lib/classifier';

export const maxDuration = 60;

function lastUserText(messages: ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== 'user') continue;
    if (typeof message.content === 'string') return message.content;
    return message.content
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map(part => part.text)
      .join('\n');
  }
  return '';
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  // GenieX serving on the Snapdragon X Elite, reached through a tunnel since
  // this route runs on Vercel, not on the same machine. See web/README.md.
  const geniex = createOpenAICompatible({
    baseURL: process.env.GENIEX_URL!,
    name: 'geniex',
    apiKey: 'geniex',
  });
  const model = geniex.chatModel(
    process.env.GENIEX_MODEL ?? 'qualcomm/Qwen3-4B-Instruct-2507',
  );

  // A second, smaller, independent model used only for classification - see
  // lib/classifier.ts for why this is deliberately not the same model as
  // `model` above. Needs its own `geniex pull` (see web/README.md).
  const classifierModel = geniex.chatModel(
    process.env.CLASSIFIER_MODEL ?? 'ai-hub-models/Qwen3-0.6B',
  );

  // x_elite/mcp_server.py, reached through a tunnel since this route runs
  // on Vercel, not on the Snapdragon machine itself.
  const mcpClient = await createMCPClient({
    transport: { type: 'http', url: process.env.MCP_URL! },
  });
  const rawTools = await mcpClient.tools();

  // mcpClient.tools() has no built-in per-call timeout - only the raw
  // callTool() method does. Without this, a hung MCP server (tunnel
  // dropped, server not running, server itself hanging) has no bound
  // except the full-request abortSignal below. If THAT fires mid tool
  // call, the call never gets a result and the chat history is left with
  // a dangling, unresolved tool-call that will throw
  // AI_MissingToolResultsError on every future message in this tab, since
  // that validation runs on the client's own resent history, not just the
  // current request - "hard refresh to fix it" is the correct remedy for
  // an already-poisoned tab, but this stops it from happening again. A
  // thrown error here becomes a clean tool-error output, which the AI SDK
  // counts as fully resolved either way.
  const MCP_CALL_TIMEOUT_MS = 10000;
  const tools = Object.fromEntries(
    Object.entries(rawTools).map(([name, tool]) => [
      name,
      {
        ...tool,
        execute: async (input: unknown, options: unknown) => {
          const timeout = new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(`MCP tool "${name}" did not respond within ${MCP_CALL_TIMEOUT_MS}ms`)),
              MCP_CALL_TIMEOUT_MS,
            ),
          );
          // @ts-expect-error - tool.execute's exact signature comes from the
          // MCP SDK's generic McpToolBase type; passed through unchanged.
          return Promise.race([tool.execute(input, options), timeout]);
        },
      },
    ]),
  );

  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model,
    messages: modelMessages,
    tools,
    providerOptions: {
      geniex: { enable_think: false },
    },
    // Keeps this under maxDuration so a hung GenieX call surfaces as an
    // error the client can show, instead of an indefinite freeze.
    abortSignal: AbortSignal.timeout(55000),
    // TESTING MODE: every decision here is automatic - nothing pauses the
    // stream waiting for a manual click. Manual 'user-approval' triggers the
    // AI SDK's interactive-approval stream-pause path, which was throwing
    // "failed to pipe response" / DataError here, and separately left a
    // window where sending a new message before responding threw
    // AI_MissingToolResultsError. Auto-deciding removes both failure modes.
    //
    // Nothing about the *checks* changed - only that the outcome is applied
    // immediately instead of waiting for a click. Both layers below still
    // run for every tool call and still log their full reasoning to the
    // trace panel (isAutomatic: true renders there already):
    //
    // 1. classifyToolCall (lib/classifier.ts) - a separate, smaller model
    //    with no say in what to call next, only whether this call looks
    //    malicious. MALICIOUS is a hard, automatic deny.
    // 2. assessGuardrail (lib/guardrail.ts) - the ambiguity check on tools
    //    tiered CONFIRM_REQUIRED, or anything the classifier flagged
    //    SUSPICIOUS even if statically tiered SAFE. Auto-approved either
    //    way, but the reasoning is preserved as the approval's `reason`.
    toolApproval: async ({ toolCall, messages: stepMessages }) => {
      const userText = lastUserText(stepMessages);

      const classification = await classifyToolCall(
        classifierModel,
        toolCall.toolName,
        toolCall.input,
        userText,
      );

      if (classification.verdict === 'MALICIOUS') {
        return {
          type: 'denied',
          reason: `Blocked by independent classifier: ${classification.reason}`,
        };
      }

      const tier = riskTier(toolCall.toolName);
      if (tier === 'SAFE' && classification.verdict === 'SAFE') {
        // Still returns a real reason, not 'not-applicable' - that skipped
        // creating any approval record at all, so the trace panel showed
        // nothing for the fast path: no badge, no explanation, just
        // silence. Every tool call should show why it was let through, not
        // just the ones that got flagged.
        return {
          type: 'approved',
          reason: classification.reason || 'Classifier found no risk indicators.',
        };
      }

      const check = await assessGuardrail(model, userText, toolCall.toolName, toolCall.input);
      const label = check.ambiguous ? 'AMBIGUOUS INSTRUCTION' : 'CONFIRM ACTION';
      const classifierNote =
        classification.verdict === 'SUSPICIOUS' ? ` [classifier: SUSPICIOUS - ${classification.reason}]` : '';
      const reason =
        (check.ambiguous && check.ambiguity_reason
          ? `${label}: ${check.blast_radius_summary} (${check.ambiguity_reason})`
          : `${label}: ${check.blast_radius_summary}`) + classifierNote;

      return { type: 'approved', reason };
    },
    // Cryptographically binds approvals to this server - see the Security
    // Considerations note in the SignalGuard README section. Optional: if
    // TOOL_APPROVAL_SECRET is unset, approvals still work, just unsigned.
    //
    // `|| undefined` matters: the AI SDK checks `secret == null` to decide
    // whether signing is "configured" - an empty string fails that check
    // (it's not null/undefined) and gets treated as a real secret, which
    // then crashes importing a zero-byte HMAC key with exactly
    // `DataError: Zero-length key is not supported`. .env.example ships
    // this var blank by default, so this guard is load-bearing, not
    // defensive-for-show.
    experimental_toolApprovalSecret: process.env.TOOL_APPROVAL_SECRET || undefined,
    // Deliberately NOT awaited: this runs on every single request, and an
    // awaited close() that hangs or throws would block the stream from ever
    // finishing - freezing the chat input after exactly one prompt, every
    // time. Best-effort cleanup only; never lets closing the MCP connection
    // hold up the response the user is actually waiting on.
    onEnd: () => {
      mcpClient.close().catch(() => {});
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      // AI SDK masks errors as a generic "An error occurred" by default.
      // Surfacing the real message here so it's actually debuggable in the
      // UI's error banner instead of a dead end.
      onError: error => {
        console.error('[chat route error]', error);
        if (error == null) return 'Unknown error';
        if (typeof error === 'string') return error;
        if (error instanceof Error) return error.message;
        return JSON.stringify(error);
      },
    }),
  });
}

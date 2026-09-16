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
    process.env.CLASSIFIER_MODEL ?? 'qualcomm/Qwen3-0.6B',
  );

  // x_elite/mcp_server.py, reached through a tunnel since this route runs
  // on Vercel, not on the Snapdragon machine itself.
  const mcpClient = await createMCPClient({
    transport: { type: 'http', url: process.env.MCP_URL! },
  });
  const tools = await mcpClient.tools();

  const modelMessages = await convertToModelMessages(messages);

  const result = streamText({
    model,
    messages: modelMessages,
    tools,
    providerOptions: {
      geniex: { enable_think: false },
    },
    // Two independent layers, run for every tool call regardless of the
    // static risk tier - a step doesn't get to skip review just because
    // it's labeled SAFE in risk-registry.ts:
    //
    // 1. classifyToolCall (lib/classifier.ts) - a separate, smaller model
    //    with no say in what to call next, only whether this call looks
    //    malicious. MALICIOUS is a hard, automatic deny - no user override,
    //    since the whole point is not to trust a single model's judgment.
    // 2. assessGuardrail (lib/guardrail.ts) - the existing ambiguity check
    //    on tools tiered CONFIRM_REQUIRED, or on anything the classifier
    //    flagged SUSPICIOUS even if statically tiered SAFE.
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
        return 'not-applicable';
      }

      const check = await assessGuardrail(model, userText, toolCall.toolName, toolCall.input);
      const label = check.ambiguous ? 'AMBIGUOUS INSTRUCTION' : 'CONFIRM ACTION';
      const classifierNote =
        classification.verdict === 'SUSPICIOUS' ? ` [classifier: SUSPICIOUS - ${classification.reason}]` : '';
      const reason =
        (check.ambiguous && check.ambiguity_reason
          ? `${label}: ${check.blast_radius_summary} (${check.ambiguity_reason})`
          : `${label}: ${check.blast_radius_summary}`) + classifierNote;

      return { type: 'user-approval', reason };
    },
    // Cryptographically binds approvals to this server - see the Security
    // Considerations note in the SignalGuard README section. Optional: if
    // TOOL_APPROVAL_SECRET is unset, approvals still work, just unsigned.
    experimental_toolApprovalSecret: process.env.TOOL_APPROVAL_SECRET,
    onEnd: async () => {
      await mcpClient.close();
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}

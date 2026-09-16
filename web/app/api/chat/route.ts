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

  // FastMCP on the Arduino Uno Q, reached through a second tunnel (its ADB
  // forward is only reachable on the Snapdragon machine's own localhost).
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
    // Same policy as x_elite/client.py's guarded call site: SAFE tools run
    // immediately, everything else gets a guardrail check whose summary
    // surfaces as the approval request's reason in the chat UI.
    toolApproval: async ({ toolCall, messages: stepMessages }) => {
      const tier = riskTier(toolCall.toolName);
      if (tier === 'SAFE') {
        return 'not-applicable';
      }

      const check = await assessGuardrail(
        model,
        lastUserText(stepMessages),
        toolCall.toolName,
        toolCall.input,
      );
      const label = check.ambiguous ? 'AMBIGUOUS INSTRUCTION' : 'CONFIRM PHYSICAL ACTION';
      const reason =
        check.ambiguous && check.ambiguity_reason
          ? `${label}: ${check.blast_radius_summary} (${check.ambiguity_reason})`
          : `${label}: ${check.blast_radius_summary}`;

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

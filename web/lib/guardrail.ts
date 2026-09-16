// Web port of x_elite/guardrail.py's ambiguity check, reusing the exact same
// system prompt so the CLI client and this web UI apply the same policy.
// Runs as a second call to the same GenieX model already used for chat.

import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';

export const GUARDRAIL_SYSTEM_PROMPT = `You are a safety-review layer for a physical-world action an AI agent
is about to execute. Given the user's original instruction and the exact tool call the
agent chose, assess whether the instruction left the action's scope, target, or
reversibility unclear.`;

const guardrailSchema = z.object({
  blast_radius_summary: z
    .string()
    .describe('One plain-English sentence describing exactly what will physically happen, including scope.'),
  ambiguous: z
    .boolean()
    .describe('True if the original instruction did not clearly specify the scope, target, or reversibility of the action.'),
  ambiguity_reason: z.string().describe('One sentence explaining why, or an empty string if not ambiguous.'),
});

export interface GuardrailCheck {
  blast_radius_summary: string;
  ambiguous: boolean;
  ambiguity_reason: string;
}

function fallback(toolName: string, toolArgs: unknown): GuardrailCheck {
  return {
    blast_radius_summary: `Could not verify this action automatically: ${toolName}(${JSON.stringify(toolArgs)}).`,
    ambiguous: true,
    ambiguity_reason: 'Guardrail check failed - failing closed.',
  };
}

// Fails closed: any error (timeout, model refusing to produce valid JSON,
// schema mismatch) returns ambiguous=true so the caller always falls back
// to requiring confirmation rather than silently allowing the call.
export async function assessGuardrail(
  model: LanguageModel,
  userInstruction: string,
  toolName: string,
  toolArgs: unknown,
): Promise<GuardrailCheck> {
  try {
    const { object } = await generateObject({
      model,
      schema: guardrailSchema,
      system: GUARDRAIL_SYSTEM_PROMPT,
      prompt: JSON.stringify({
        user_instruction: userInstruction,
        tool_name: toolName,
        tool_args: toolArgs,
      }),
      temperature: 0,
      providerOptions: {
        geniex: { enable_think: false },
      },
      // Without this, a slow/unresponsive GenieX (NPU busy, tunnel hiccup)
      // hangs this call forever, which hangs the whole tool-approval flow
      // and freezes the chat with no error ever surfacing. Matches the
      // fail-closed timeout=5.0 already used in x_elite/guardrail.py.
      abortSignal: AbortSignal.timeout(8000),
    });

    return object;
  } catch (err) {
    console.error('[guardrail] falling back to ambiguous=true:', err);
    return fallback(toolName, toolArgs);
  }
}

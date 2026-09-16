// Web port of x_elite/guardrail.py's ambiguity check, reusing the exact same
// system prompt so the CLI client and this web UI apply the same policy.
// Runs as a second call to the same GenieX model already used for chat.

import { generateText, type LanguageModel } from 'ai';

export const GUARDRAIL_SYSTEM_PROMPT = `You are a safety-review layer for a physical-world action an AI agent
is about to execute. Given the user's original instruction and the exact tool call the
agent chose, respond ONLY with JSON in this exact shape:
{"blast_radius_summary": "<one plain-English sentence describing exactly what will
physically happen, including scope>", "ambiguous": true or false, "ambiguity_reason":
"<one sentence, empty string if not ambiguous>"}
Mark ambiguous=true if the original instruction did not clearly specify the scope, target,
or reversibility of the action the agent chose. Respond with JSON only, no other text.`;

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

// Fails closed: any error (timeout, malformed JSON, missing keys) returns
// ambiguous=true so the caller always falls back to requiring confirmation
// rather than silently allowing the call.
export async function assessGuardrail(
  model: LanguageModel,
  userInstruction: string,
  toolName: string,
  toolArgs: unknown,
): Promise<GuardrailCheck> {
  try {
    const { text } = await generateText({
      model,
      system: GUARDRAIL_SYSTEM_PROMPT,
      prompt: JSON.stringify({
        user_instruction: userInstruction,
        tool_name: toolName,
        tool_args: toolArgs,
      }),
      temperature: 0,
      // Mirrors extra_body={"enable_think": False, "enable_json": True} from
      // x_elite/guardrail.py - unconfirmed whether enable_json takes effect
      // on this endpoint, same caveat as the Python side.
      providerOptions: {
        geniex: { enable_think: false, enable_json: true },
      },
      // Without this, a slow/unresponsive GenieX (NPU busy, tunnel hiccup)
      // hangs this call forever, which hangs the whole tool-approval flow
      // and freezes the chat with no error ever surfacing. Matches the
      // fail-closed timeout=5.0 already used in x_elite/guardrail.py.
      abortSignal: AbortSignal.timeout(8000),
    });

    const result = JSON.parse(text) as Partial<GuardrailCheck>;
    if (
      typeof result.blast_radius_summary !== 'string' ||
      typeof result.ambiguous !== 'boolean'
    ) {
      throw new Error('malformed guardrail response');
    }
    return {
      blast_radius_summary: result.blast_radius_summary,
      ambiguous: result.ambiguous,
      ambiguity_reason: result.ambiguity_reason ?? '',
    };
  } catch (err) {
    console.error('[guardrail] falling back to ambiguous=true:', err);
    return fallback(toolName, toolArgs);
  }
}

// An independent malicious-action classifier, deliberately separate from
// both the main conversational model AND the ambiguity guardrail in
// guardrail.ts. It runs on its own, smaller model (CLASSIFIER_MODEL) so a
// manipulated or jailbroken main model can't also control the check that's
// supposed to catch it - the same reason dedicated safety classifiers
// (e.g. Llama Guard) are built separately from the model they're guarding.

import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';

export const CLASSIFIER_SYSTEM_PROMPT = `You are an independent security classifier reviewing a single tool call an
AI agent is about to execute. You do not trust the acting model's own
judgment - make an independent call from the tool name, its arguments, and
the conversation so far.

Mark MALICIOUS when the action is irreversible, affects shared or remote
state, or has no parameter that could narrow its blast radius (e.g. wiping
a remote repository, deleting everything except one item, disabling a
security control). Mark SUSPICIOUS when the action is potentially risky but
scoped or reversible. Mark SAFE for read-only or clearly low-impact actions.`;

const classifierSchema = z.object({
  verdict: z.enum(['SAFE', 'SUSPICIOUS', 'MALICIOUS']),
  reason: z.string().describe('One plain-English sentence explaining the verdict.'),
});

export interface ClassifierVerdict {
  verdict: 'SAFE' | 'SUSPICIOUS' | 'MALICIOUS';
  reason: string;
}

// Fails closed to SUSPICIOUS, not SAFE - same fail-closed philosophy as
// guardrail.ts, so a broken classifier still forces a confirmation instead
// of silently waving every tool call through.
function fallback(toolName: string): ClassifierVerdict {
  return {
    verdict: 'SUSPICIOUS',
    reason: `Classifier check failed for ${toolName} - failing to SUSPICIOUS, not SAFE.`,
  };
}

export async function classifyToolCall(
  model: LanguageModel,
  toolName: string,
  toolArgs: unknown,
  conversationSummary: string,
): Promise<ClassifierVerdict> {
  try {
    const { object } = await generateObject({
      model,
      schema: classifierSchema,
      system: CLASSIFIER_SYSTEM_PROMPT,
      prompt: JSON.stringify({
        tool_name: toolName,
        tool_args: toolArgs,
        conversation: conversationSummary,
      }),
      temperature: 0,
      providerOptions: {
        geniex: { enable_think: false },
      },
      // See the matching note in guardrail.ts - without this, an
      // unresponsive GenieX hangs the whole tool-approval flow forever
      // instead of failing closed to SUSPICIOUS.
      abortSignal: AbortSignal.timeout(8000),
    });

    return object;
  } catch (err) {
    // Was silently swallowed - this made a genuinely broken classifier
    // (e.g. CLASSIFIER_MODEL never pulled) indistinguishable from working
    // fail-closed behavior. Always log so a persistent failure is visible.
    console.error('[classifier] falling back to SUSPICIOUS:', err);
    return fallback(toolName);
  }
}

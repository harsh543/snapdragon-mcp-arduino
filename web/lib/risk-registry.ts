// Mirrors x_elite/risk_registry.py exactly, so the CLI client and this web
// chat agree on which tools are SAFE vs which require a guardrail check.
// Deterministic lookup only - the model is never trusted to self-assess risk.

export type RiskTier = 'SAFE' | 'CONFIRM_REQUIRED';

export const TOOL_RISK: Record<string, RiskTier> = {
  get_board_status: 'SAFE',
  flash_heart: 'SAFE',
  trigger_alert: 'CONFIRM_REQUIRED',
};

// Unknown tool names default to the safest posture, not to SAFE.
export function riskTier(toolName: string): RiskTier {
  return TOOL_RISK[toolName] ?? 'CONFIRM_REQUIRED';
}

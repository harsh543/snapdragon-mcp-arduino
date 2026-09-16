# Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
# SPDX-License-Identifier: BSD-3-Clause
"""Safety-review layer for MCP tool calls before they execute on hardware.

Reuses the same AsyncOpenAI client and model x_elite/client.py already
holds open against GenieX — no second HTTP client, no hardcoded model
name, so this always checks against whatever model the client was
actually started with.
"""

import json

SYSTEM_PROMPT = """You are a safety-review layer for a physical-world action an AI agent
is about to execute. Given the user's original instruction and the exact tool call the
agent chose, respond ONLY with JSON in this exact shape:
{"blast_radius_summary": "<one plain-English sentence describing exactly what will
physically happen, including scope>", "ambiguous": true or false, "ambiguity_reason":
"<one sentence, empty string if not ambiguous>"}
Mark ambiguous=true if the original instruction did not clearly specify the scope, target,
or reversibility of the action the agent chose. Respond with JSON only, no other text."""


async def assess(client, model_name: str, user_instruction: str, tool_name: str, tool_args: dict) -> dict:
    """Returns {"blast_radius_summary": str, "ambiguous": bool, "ambiguity_reason": str}.

    Fails closed: any error (timeout, malformed JSON, missing keys) returns
    ambiguous=True with a generic summary so the caller always falls back to
    requiring manual confirmation rather than silently allowing the call.
    """
    try:
        response = await client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps({
                    "user_instruction": user_instruction,
                    "tool_name": tool_name,
                    "tool_args": tool_args,
                })},
            ],
            temperature=0,
            max_tokens=256,
            extra_body={"enable_think": False},
        )
        content = response.choices[0].message.content or ""
        result = json.loads(content)
        assert "blast_radius_summary" in result and "ambiguous" in result
        result.setdefault("ambiguity_reason", "")
        return result
    except Exception:
        return {
            "blast_radius_summary": f"Could not verify this action automatically: "
                                     f"{tool_name}({tool_args}).",
            "ambiguous": True,
            "ambiguity_reason": "Guardrail check failed — failing closed.",
        }

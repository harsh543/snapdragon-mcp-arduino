# Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
# SPDX-License-Identifier: BSD-3-Clause
# MCP discovery and tool-result flow adapted from qnn_sample_apps.
"""Chat with local GenieX and let Qwen call Arduino MCP tools."""

import argparse
import asyncio
import json

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from openai import AsyncOpenAI

from x_elite.guardrail import assess
from x_elite.risk_registry import TOOL_RISK

DEFAULT_MODEL = "qualcomm/Qwen3-4B-Instruct-2507"
SYSTEM_PROMPT = (
    "You are an assistant that can interact with an Arduino Uno Q "
    "using the provided tools. Use tools when appropriate to fulfill "
    "the user's request."
)


async def discover_tools(session: ClientSession) -> list[dict]:
    response = await session.list_tools()
    return [
        {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description or "",
                "parameters": tool.inputSchema,
            },
        }
        for tool in response.tools
    ]


def tool_result_text(result) -> str:
    parts = []
    for item in result.content:
        text = getattr(item, "text", None)
        parts.append(text if text is not None else str(item))
    return "\n".join(parts)


async def chat_turn(client, model_name, session, tools, history, user_text):
    history.append({"role": "user", "content": user_text})
    response = await client.chat.completions.create(
        messages=[{"role": "system", "content": SYSTEM_PROMPT}, *history],
        model=model_name,
        tools=tools,
        tool_choice="auto",
        temperature=0.2,
        max_tokens=512,
        extra_body={"enable_think": False},
    )
    message = response.choices[0].message

    if not message.tool_calls:
        answer = message.content or ""
        history.append({"role": "assistant", "content": answer})
        return answer

    call = message.tool_calls[0]
    tool_name = call.function.name
    arguments = json.loads(call.function.arguments or "{}")
    print(f"[tool] {tool_name}({json.dumps(arguments)})")

    tier = TOOL_RISK.get(tool_name, "CONFIRM_REQUIRED")  # unknown tools default to safe posture
    if tier == "SAFE":
        result = await session.call_tool(tool_name, arguments)
        result_text = tool_result_text(result)
    else:
        check = await assess(client, model_name, user_text, tool_name, arguments)
        label = "AMBIGUOUS INSTRUCTION" if check["ambiguous"] else "CONFIRM PHYSICAL ACTION"
        print(f"\n[guardrail] {label}: {check['blast_radius_summary']}")
        if check["ambiguous"] and check["ambiguity_reason"]:
            print(f"[guardrail] Why flagged: {check['ambiguity_reason']}")
        confirm = (await asyncio.to_thread(input, "[guardrail] Proceed? [y/N] ")).strip().lower()
        if confirm == "y":
            result = await session.call_tool(tool_name, arguments)
            result_text = tool_result_text(result)
        else:
            result_text = json.dumps({"status": "blocked_by_guardrail"})
    print(f"[result] {result_text}")

    history.append({
        "role": "assistant",
        "content": message.content,
        "tool_calls": [call.model_dump()],
    })
    history.append({"role": "tool", "tool_call_id": call.id, "content": result_text})
    final = await client.chat.completions.create(
        messages=[{"role": "system", "content": SYSTEM_PROMPT}, *history],
        model=model_name,
        temperature=0.2,
        max_tokens=512,
        extra_body={"enable_think": False},
    )
    answer = final.choices[0].message.content or ""
    history.append({"role": "assistant", "content": answer})
    return answer


async def run(args):
    client = AsyncOpenAI(base_url=args.geniex_url, api_key="geniex")
    history = []

    async with streamablehttp_client(args.mcp_url) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await discover_tools(session)
            print("Connected tools: " + ", ".join(t["function"]["name"] for t in tools))
            print("Commands: /clear, /quit")

            while True:
                user_text = (await asyncio.to_thread(input, "\nYou: ")).strip()
                if not user_text:
                    continue
                if user_text == "/quit":
                    return
                if user_text == "/clear":
                    history.clear()
                    print("Conversation cleared.")
                    continue
                answer = await chat_turn(client, args.model, session, tools, history, user_text)
                print("Assistant: " + answer)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--geniex-url", default="http://127.0.0.1:18181/v1")
    parser.add_argument("--mcp-url", default="http://127.0.0.1:3001/mcp")
    args = parser.parse_args()
    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        parser.exit(1, f"Connection failed: {exc}\n")


if __name__ == "__main__":
    main()

# Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
# SPDX-License-Identifier: BSD-3-Clause
"""Standalone MCP tool server - runs on the same Windows Snapdragon X Elite
machine as GenieX. No Arduino Uno Q, no ADB, no Arduino_RouterBridge.

Exposes the same three tool names as arduino/unoq/mcp_server.py
(get_board_status, flash_heart, trigger_alert) with simulated responses, so
x_elite/risk_registry.py, x_elite/guardrail.py, and the web app's
lib/risk-registry.ts all keep working unchanged - only where this server
runs, and what it does when a tool executes, has changed.

Run:
    python -m x_elite.mcp_server
"""

import argparse

from fastmcp import FastMCP

mcp = FastMCP("SignalGuard (simulated)")


@mcp.tool
def get_board_status() -> dict:
    """Check the current connection and status of the (simulated) board."""
    return {
        "board_model": "Simulated board (no Arduino Uno Q attached)",
        "connected": True,
        "rpc_response": "pong",
    }


@mcp.tool
def flash_heart() -> dict:
    """Simulate a heart animation. No physical effect."""
    print("[simulated] flash_heart")
    return {"ok": True, "rpc_response": 1}


@mcp.tool
def trigger_alert(target: str = "local", duration_ms: int = 1000) -> dict:
    """Trigger a (simulated) alert, scoped by target.

    Scope matters: "local" is the smallest blast radius; "all" is more
    disruptive. Use the smallest scope that satisfies the request, and ask
    for clarification if the user did not specify one.
    """
    if target not in ("local", "all"):
        raise ValueError(f"target must be 'local' or 'all', got {target!r}")
    if not 0 < duration_ms <= 10000:
        raise ValueError("duration_ms must be between 1 and 10000")
    print(f"[simulated] trigger_alert(target={target!r}, duration_ms={duration_ms})")
    return {"ok": True, "target": target, "duration_ms": duration_ms, "rpc_response": 1}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3001)
    args = parser.parse_args()
    mcp.run(transport="http", host=args.host, port=args.port)


if __name__ == "__main__":
    main()

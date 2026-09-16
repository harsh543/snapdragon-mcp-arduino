"""Expose Arduino Uno Q MCU functions as MCP tools."""

import argparse
import json
import platform
import socket
import subprocess
from pathlib import Path

from fastmcp import FastMCP

from arduino.rpc.rpc_base import ArduinoBridge, ROUTER_SOCKET

mcp = FastMCP("Arduino Uno Q")
socket_path = ROUTER_SOCKET


def call_mcu(method: str, *params):
    """Make one RPC call and always release the router socket."""
    bridge = ArduinoBridge(socket_path)
    try:
        return bridge.call(method, *params)
    finally:
        bridge.close()


def read_text(path: str) -> str:
    """Read a system identity file, returning unknown when unavailable."""
    try:
        return Path(path).read_text(encoding="utf-8").strip("\x00\n") or "unknown"
    except (OSError, UnicodeError):
        return "unknown"


def os_name() -> str:
    """Return PRETTY_NAME from /etc/os-release."""
    try:
        for line in Path("/etc/os-release").read_text(encoding="utf-8").splitlines():
            if line.startswith("PRETTY_NAME="):
                return line.split("=", 1)[1].strip('"')
    except (OSError, UnicodeError):
        pass
    return "unknown"


def arduino_core() -> str:
    """Return the installed Arduino Zephyr core and version."""
    try:
        completed = subprocess.run(
            ["arduino-cli", "core", "list", "--format", "json"],
            capture_output=True,
            check=True,
            text=True,
            timeout=10,
        )
        for core in json.loads(completed.stdout).get("platforms", []):
            if core.get("id") == "arduino:zephyr":
                version = core.get("installed_version")
                return f"arduino:zephyr {version}" if version else "unknown"
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        pass
    return "unknown"


def board_info() -> dict:
    """Collect information from the Uno Q Linux MPU."""
    return {
        "board_model": read_text("/proc/device-tree/model"),
        "board_serial": read_text("/proc/device-tree/serial-number"),
        "hostname": socket.gethostname(),
        "os": os_name(),
        "architecture": platform.machine() or "unknown",
        "arduino_core": arduino_core(),
    }


@mcp.tool
def get_board_status() -> dict:
    """Check the current connection and status of the Arduino Uno Q. 
    This also gives board information and provides a board description
    """
    status = board_info()
    try:
        response = call_mcu("mcu_ping")
        status.update({
            "connected": response == "pong",
            "rpc_response": response,
        })
    except (OSError, RuntimeError, TimeoutError) as exc:
        status.update({
            "connected": False,
            "rpc_response": None,
            "error": str(exc),
        })
    return status


@mcp.tool
def flash_heart() -> dict:
    """Display a heart animation on the Arduino Uno Q LED matrix.

    Use this when the user asks to display, show, flash, or animate
    a heart on the Arduino Uno Q.
    """
    response = call_mcu("flash_heart")
    if response != 1:
        raise RuntimeError(f"Unexpected MCU response: {response!r}")
    return {"ok": True, "rpc_response": response}


@mcp.tool
def trigger_alert(target: str = "local", duration_ms: int = 1000) -> dict:
    """Trigger a visible alert pattern on the Arduino Uno Q.

    Scope matters: "local" flashes only the built-in LED; "all" also
    strobes the LED matrix and is more disruptive. Use the smallest scope
    that satisfies the request, and ask the user to clarify scope if it
    was not specified.
    """
    if target not in ("local", "all"):
        raise ValueError(f"target must be 'local' or 'all', got {target!r}")
    if not 0 < duration_ms <= 10000:
        raise ValueError("duration_ms must be between 1 and 10000")
    response = call_mcu("trigger_alert", target, duration_ms)
    if response != 1:
        raise RuntimeError(f"Unexpected MCU response: {response!r}")
    return {"ok": True, "target": target, "duration_ms": duration_ms, "rpc_response": response}


def main():
    global socket_path

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3001)
    parser.add_argument("--socket", default=ROUTER_SOCKET)
    args = parser.parse_args()
    socket_path = args.socket

    mcp.run(transport="http", host=args.host, port=args.port)


if __name__ == "__main__":
    main()

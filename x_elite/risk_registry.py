# Copyright (c) Qualcomm Technologies, Inc. and/or its subsidiaries.
# SPDX-License-Identifier: BSD-3-Clause
"""Static risk tiers for MCP tools.

Deterministic lookup only — the model is never trusted to self-assess the
risk of its own tool call. An unknown tool name defaults to the safest
posture (CONFIRM_REQUIRED) in x_elite/client.py, not to SAFE.
"""

TOOL_RISK = {
    "get_board_status": "SAFE",
    "flash_heart": "SAFE",
    "trigger_alert": "CONFIRM_REQUIRED",
    "list_branches": "SAFE",
    "delete_branch": "CONFIRM_REQUIRED",
    "wipe_repository": "CONFIRM_REQUIRED",
}

# Snapdragon X Elite + Arduino Uno Q over MCP

This repository is a small, local example of a Qwen 3 model running through
Qualcomm AI Hub GenieX on a Snapdragon X Elite and calling functions on an
Arduino Uno Q through MCP.

## Quick start

1. Start GenieX: `geniex pull qualcomm/Qwen3-4B-Instruct-2507`, then
   `geniex serve`.
2. Clone this repository on the Uno Q and upload the `rpc_hearts` sketch.
3. On the Uno Q, install `arduino/unoq/requirements.txt` and run
   `python -m arduino.unoq.mcp_server`.
4. On Windows, forward port 3001 with ADB.
5. Install `x_elite/requirements.txt` and run `python -m x_elite.client`.

See the numbered sections below for the exact commands and prerequisites.

```text
Qwen 3 / GenieX -> Python chat client -> MCP over ADB
                 -> FastMCP on Uno Q -> Arduino RPC -> MCU
```

The example exposes three tools:

- `get_board_status` returns board information and calls `mcu_ping` on the MCU.
  The built-in LED blinks three times so the status check is physically visible.
- `flash_heart` plays one heart animation on the LED matrix.
- `trigger_alert(target, duration_ms)` strobes an alert pattern, scoped by
  `target` (`"local"` = built-in LED only, `"all"` = LED matrix too). This
  tool is gated by SignalGuard below because its scope is easy to get wrong.

## Repository layout

```text
arduino/rpc/                    Existing Linux-to-MCU RPC bridge
arduino/rpc/MCU/sketch/         Arduino sketch
arduino/unoq/mcp_server.py      FastMCP server for the Uno Q Linux MPU
x_elite/client.py               GenieX and MCP chat client for Windows
```

## 1. Set up GenieX on the X Elite

Install GenieX using Qualcomm's
[Windows ARM64 instructions](https://geniex.aihub.qualcomm.com/en/run/cli/install/#windows-arm64),
then open PowerShell:

```powershell
geniex --help
geniex pull qualcomm/Qwen3-4B-Instruct-2507
geniex serve
```

Keep `geniex serve` running. It provides the local OpenAI-compatible API at
`http://127.0.0.1:18181/v1`.

### GenieX CLI cheat sheet

Useful commands beyond the two above, in the order you'll actually reach for
them while testing this repo:

```powershell
# See what's already cached locally
geniex list

# Sanity-test a model completely standalone, before wiring up MCP at all.
# --compute npu forces Hexagon NPU execution instead of a silent GPU/CPU
# fallback - if this doesn't run on NPU, nothing downstream will either.
geniex infer ai-hub-models/Qwen3-4B --compute npu -p "What is 2+2?"

# Pull the vision-language model x_elite/vision.py needs (separate from
# the text-only model used everywhere else in this README)
geniex pull ai-hub-models/Qwen2.5-VL-7B-Instruct

# Test that VLM standalone via CLI before going through vision.py
geniex infer ai-hub-models/Qwen2.5-VL-7B-Instruct -p "Describe this image" path\to\frame.jpg

# See everything downloaded and its size, or free up space
geniex list
geniex remove <model-name>
geniex clean
```

**`geniex-bench` (objective latency numbers, see "Latency check" in Testing
SignalGuard below) is a separate standalone binary, not bundled with the
CLI or added to PATH** - download and run it from the extracted folder:

```powershell
Invoke-WebRequest `
  https://qaihub-public-assets.s3.us-west-2.amazonaws.com/qai-hub-geniex/geniex-bench-windows-arm64.zip `
  -OutFile bench.zip
Expand-Archive bench.zip -DestinationPath bench
cd bench
.\geniex-bench.exe --plugin qairt -m ai-hub-models/Qwen3-4B --device npu -p 512 -n 128
```

**Precision notes:**
- AI Hub bundles (`ai-hub-models/...`, loaded with `device_map="qairt"`) are
  pre-quantized - there's no runtime choice, and most use `w4a16`.
- GGUF models (loaded with `device_map="auto"` via llama.cpp) only reach the
  Hexagon NPU at **`Q4_0`** quantization. `Q8_0` and `F16` silently run on
  GPU/CPU instead - still correct, just not the on-device story this repo
  demonstrates.
- `geniex pull <model-name>[:<precision>]` accepts a precision tag directly
  where a hub source offers more than one quantization.

## 2. Put the Arduino files on the Uno Q


```bash
mkdir -p /home/arduino/local_dev && cd /home/arduino/local_dev
```
```bash
git clone https://github.com/DerrickJ1612/snapdragon-mcp-arduino.git
```


## 3. Compile and upload the MCU sketch

In a Windows terminal grab the serial number for Uno Q
```powershell
adb devices
```
adb devices returns below:
```powershell
List of devices attached
227615311       device
```

Open an Uno Q shell:

```powershell
adb -s 227615311 shell
```

Compile and upload from the Linux MPU with Arduino CLI:

```bash
arduino-cli lib update-index
arduino-cli lib install Arduino_RouterBridge

cd /home/arduino/local_dev/arduino/rpc/MCU/sketch/rpc_hearts
arduino-cli compile --fqbn arduino:zephyr:unoq .
arduino-cli upload --fqbn arduino:zephyr:unoq .
```

Installing `Arduino_RouterBridge` also installs its `Arduino_RPClite` and
`MsgPack` dependencies. The sketch registers `mcu_ping` and `flash_heart` with
the Arduino router.

## 4. Start FastMCP on the Uno Q

The Uno Q image may not include `pip` or `venv`. Install them once:

```bash
sudo apt-get update
sudo apt-get install -y python3-pip python3-venv
```

These package installation commands require the Uno Q to have internet access.

Create the environment and start the server from the repository root:

```bash
cd /home/arduino/local_dev
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r arduino/unoq/requirements.txt
python -m arduino.unoq.mcp_server
```

FastMCP listens on the board's loopback interface at port 3001. Keep this
terminal running.

## 5. Forward MCP over ADB

In another Windows terminal:

```powershell
adb -s 227615311 forward tcp:3001 tcp:3001
```

The client only knows the local MCP URL. The ADB command can later be replaced
with an SSH tunnel without changing Python code.

## 6. Start the chat client

From the repository root on Windows:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r x_elite/requirements.txt
.\.venv\Scripts\python -m x_elite.client
```

Try:

```text
Check whether the Arduino is connected.
Flash the heart once.
```

The client prints the selected MCP tool and raw result before Qwen's final
answer. Use `/clear` to clear the conversation and `/quit` to exit.

`get_board_status` takes about 600 ms while the MCU blinks `LED_BUILTIN` three
times at 100 ms on and 100 ms off. A successful result looks like this:

```json
{
  "board_model": "Arduino UnoQ",
  "board_serial": "28dc9ba",
  "hostname": "SCL-UNOQ24",
  "os": "Debian GNU/Linux 13 (trixie)",
  "architecture": "aarch64",
  "arduino_core": "arduino:zephyr 0.56.0",
  "connected": true,
  "rpc_response": "pong"
}
```

The model, serial, hostname, operating system, and core version are read from
the current device, so their values can differ from this example. An optional
identity field that cannot be read is returned as `"unknown"`.

Optional settings:

```powershell
.\.venv\Scripts\python -m x_elite.client --help
```

## Running the MCP server standalone (no Arduino)

No Uno Q, or don't want the hardware dependency for a demo? Skip steps 2-5
above entirely. `x_elite/mcp_server.py` runs the same three tools
(`get_board_status`, `flash_heart`, `trigger_alert`) as a standalone MCP
server directly on the Windows Snapdragon X Elite machine - no ADB, no
Arduino sketch, no `Arduino_RouterBridge`. Tool responses are simulated
(printed to the console) rather than driving real hardware.

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r x_elite/requirements.txt
.\.venv\Scripts\python -m x_elite.mcp_server
```

This listens on `127.0.0.1:3001/mcp`, same port and path as the
ADB-forwarded Uno Q server, so `x_elite/client.py`'s defaults
(`--mcp-url http://127.0.0.1:3001/mcp`) work unchanged - point it at
whichever server is actually running. The web chat app
([`web/README.md`](web/README.md)) uses this standalone server too, tunneled
alongside GenieX rather than going through ADB.

Since `x_elite/risk_registry.py` and `x_elite/guardrail.py` key off tool
*names*, not which server implements them, SignalGuard's guardrail behavior
is identical either way - only whether `trigger_alert` does something
physical or just prints a line changes.

## Troubleshooting

- **Cannot connect to MCP:** confirm the FastMCP process is running, then run
  `adb -s 227615311 forward --list`.
- **Cannot connect to GenieX:** keep `geniex serve` open and check
  `http://127.0.0.1:18181`.
- **Router socket error:** check `systemctl status arduino-router` and
  `/var/run/arduino-router.sock` on the Uno Q.
- **No handler for a tool:** compile and upload the updated sketch again.
- **No status blink:** upload the updated sketch and confirm
  `systemctl status arduino-router` reports an active service.
- **RPC timeout:** the physical result is unknown. Check the board before
  retrying `flash_heart`.
- **Python import error on Uno Q:** start the server from
  `/home/arduino/local_dev` with `python -m arduino.unoq.mcp_server`.

## SignalGuard: an MCP tool-call safety gate

This fork adds a safety gate that intercepts risky, ambiguous tool calls
before they execute on real hardware - the failure mode where an agent
misresolves an ambiguous instruction into a wide-blast-radius action with
no confirmation.

```text
x_elite/risk_registry.py   Static SAFE / CONFIRM_REQUIRED tier per tool name
x_elite/guardrail.py       Async check that summarizes blast radius and flags
                           ambiguity, reusing the same GenieX client/model
                           already open in x_elite/client.py
x_elite/client.py          One call site wrapped: SAFE tools run immediately,
                           everything else prints a blast-radius summary and
                           requires a "y" confirmation
```

Unknown tool names default to `CONFIRM_REQUIRED`, not `SAFE`. Any guardrail
error (timeout, malformed JSON) also fails closed to `CONFIRM_REQUIRED` -
never a silent allow.

### Testing SignalGuard

1. Bring the stack up exactly as in steps 1-5 above (GenieX serving, FastMCP
   on the Uno Q, ADB port-forward), then start the client.
2. **Safe path (unchanged behavior):**
   ```text
   You: Check whether the Arduino is connected.
   ```
   `get_board_status` is `SAFE`, so it should run immediately with no prompt -
   confirms the guardrail adds zero friction to safe actions.
3. **Ambiguous scope, caught:**
   ```text
   You: trigger the alert
   ```
   No scope was specified, so the model has to guess `target`. You should see:
   ```text
   [guardrail] AMBIGUOUS INSTRUCTION: <one-sentence blast-radius summary>
   [guardrail] Why flagged: <reason>
   [guardrail] Proceed? [y/N]
   ```
   Answer `N` to confirm the call is blocked (`{"status": "blocked_by_guardrail"}`
   and nothing happens on the board); answer `y` to confirm it then executes.
4. **Unambiguous scope, still confirmed:**
   ```text
   You: Flash the alert on just the built-in LED for one second.
   ```
   `ambiguous` should come back `false` with a plain confirmation prompt
   instead of an ambiguity warning - the tier still requires a `y`, but the
   framing differs.
5. **Latency check before a live demo:** with a warm `geniex serve`, time how
   long the guardrail prompt takes to appear after step 3's instruction. If
   it's slow, trim `SYSTEM_PROMPT` in `x_elite/guardrail.py` - don't add a
   timeout that silently skips the check; that would turn a fail-closed gate
   into a fail-open one.

**Troubleshooting the guardrail specifically:**

- **Guardrail always says "Could not verify this action automatically" (the
  generic fail-closed message):** the model isn't returning clean JSON.
  `guardrail.py` passes `extra_body={"enable_think": False, "enable_json": True}`
  to force JSON-only output, mirroring the GenieX CLI's `--enable-json` flag -
  but this is unconfirmed on the served HTTP endpoint. If it's being ignored,
  remove `"enable_json": True` and instead tighten `SYSTEM_PROMPT` in
  `x_elite/guardrail.py` to repeat "respond with JSON only" more forcefully,
  or try a larger model (a 0.6B model is more likely to wrap JSON in prose
  than a 4B one).
- **Every call to `trigger_alert` gets flagged ambiguous, even with an
  explicit scope:** check the actual `tool_args` being passed by printing
  `arguments` in `x_elite/client.py` before the guardrail runs - the model
  may be omitting `target` even when you specified it in plain English,
  which is a prompt/model issue, not a guardrail bug.

### Note on `trigger_alert`'s Arduino registration

`Bridge.provide("trigger_alert", trigger_alert)` registers a two-argument
`(String, int)` handler, following the same pattern as the existing
zero-argument `flash_heart`/`mcu_ping` handlers. This repository's existing
handlers are all zero-argument, so if `arduino-cli compile` reports a type
mismatch for the new handler, check the installed `Arduino_RouterBridge`
version's supported parameter types and adjust the signature accordingly.

## Vision: local VLM inference with the GenieX Python SDK

`x_elite/vision.py` is a separate, standalone path that uses the GenieX
Python SDK directly (`from geniex import AutoModelForCausalLM`) rather than
the OpenAI-compatible `geniex serve` endpoint `x_elite/client.py` talks to.
It loads a vision-language model in-process and describes an image - useful
for a "camera sees something, then decide whether to act" demo.

It requires a VL-capable model, which is a separate pull from the text-only
model used elsewhere in this README:

```powershell
geniex pull ai-hub-models/Qwen2.5-VL-7B-Instruct
```

Run standalone against a captured frame:

```powershell
.\.venv\Scripts\python -m x_elite.vision --image path\to\frame.jpg
```

To combine perception with the guarded action loop, run `vision.py` first,
then paste its printed description (or a follow-up instruction based on it,
e.g. "given what you saw, trigger a local alert") into the `x_elite.client`
prompt - `trigger_alert` still goes through SignalGuard either way.

## Upstream reuse

The MCP discovery, tool schema conversion, and tool-result conversation flow
in `x_elite/client.py` are adapted from
[DerrickJ1612/qnn_sample_apps](https://github.com/DerrickJ1612/qnn_sample_apps/tree/main/src).
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

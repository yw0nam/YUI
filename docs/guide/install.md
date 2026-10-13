# Install with a coding agent

Paste this into any coding agent (Claude Code, Codex, OpenCode, Cursor):

```text
Install https://github.com/yw0nam/YUI following https://raw.githubusercontent.com/yw0nam/YUI/main/docs/guide/install.md
```

The rest of this page is the instruction set for that agent.

## Instructions for the agent

Take the user from nothing to a checkout that runs with `pnpm tauri dev`. Ask the user only for what the machine cannot tell you. Every step ends on a checkable state; do not report done before step 4 passes.

### 1. Prerequisites

Run `git --version`, `pnpm -v`, `rustc -V`, `cargo -V`. On macOS also run `xcode-select -p`; on Windows, Tauri needs the MSVC build tools and WebView2 ([Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).

For each missing tool, ask the user before installing it:

| Missing | Install |
|---|---|
| pnpm | `npm install -g pnpm`, or follow https://pnpm.io/installation when Node is missing too |
| Rust and cargo | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh -s -- -y`, then `source "$HOME/.cargo/env"` |
| Xcode Command Line Tools (macOS) | The user runs `xcode-select --install` and accepts the system dialog |

Done when every command above prints a version or a path.

### 2. Clone

If the current directory is already a YUI checkout, use it. Otherwise clone into a directory the user names, defaulting to `~/YUI`:

```bash
git clone https://github.com/yw0nam/YUI ~/YUI && cd ~/YUI
pnpm install
```

Done when `pnpm install` exits 0 and `resources/vrms/Sendagaya_Shino.vrm` exists. That file is the bundled default character and the only hard requirement.

### 3. Backend (optional)

Before asking, probe the two local provider presets with a short timeout:

```bash
curl -s --max-time 3 http://localhost:11434/v1/models  # Ollama
curl -s --max-time 3 http://localhost:1234/v1/models   # LM Studio
```

Both addresses are the OpenAI-compatible model-list endpoints documented for [Ollama](https://docs.ollama.com/api/openai-compatibility) and [LM Studio](https://lmstudio.ai/docs/developer/openai-compat); the YUI provider presets use the same two URLs. A server answers when the probe returns JSON with a `data` array. A model list can carry embedding models (LM Studio's does), and a chat request to one fails, so leave out ids naming an embedding model (for example `text-embedding-...`); LM Studio answers such a request with HTTP 404 (`Model is not llm`). For each server that answers, show the user the remaining model ids and ask whether to use that server and which model. An answer whose `data` array is empty means the server lists no model, and step 4 reports that as its own result. Picking one sets `chat_base_url` to `http://localhost:11434/v1` for Ollama or `http://localhost:1234/v1` for LM Studio, sets `chat_model` to the chosen id, and leaves `chat_api` at `chat_completions`. When neither server answers, or the user declines both, continue with the question below.

Ask once: "Do you want to connect a chat backend, TTS, or STT now, or set them later in the app (right-click the character → Connection)?" On "later", go to step 4.

Otherwise collect what the user has. Every URL starts with `http://` or `https://`; the config validator rejects anything else at launch, and the window shows an error card that names the file and the key.

| Value | Where it goes |
|---|---|
| Chat base URL and model id | `configs/endpoints.json` → `chat_base_url`, `chat_model`. In the `chat_completions` and `responses` modes the URL is the API root including `/v1` (`http://localhost:8643/v1`). In `push` mode it is the WebSocket base without `/v1` (`http://localhost:8646`) |
| Chat protocol | `chat_api`: pick by who keeps the conversation history: keep `chat_completions` (the client sends the history) for any tool-calling OpenAI-compatible endpoint, `responses` (the server keeps it) for a backend agent on the Responses API, `push` for a backend that speaks first through the [push transport](../reference/push-transport.md); currently only [Hermes Agent](https://github.com/NousResearch/hermes-agent) supports it |
| Chat API key | `.env.local` → `VITE_YUI_CHAT_KEY` |
| Expression Broker MCP URL | Skip it. `broker_base_url` is deprecated and is removed in v0.6.0; the client declares its tools on the request |
| TTS provider, URL, model, speaker, key | `tts_provider` (`irodori` or `openai`), `tts_base_url` without `/v1` (`http://localhost:8088` for Irodori, `https://api.openai.com` for OpenAI), `tts_model` (`irodori-tts`, or `gpt-4o-mini-tts` for OpenAI), `tts_speaker`, `.env.local` → `VITE_YUI_TTS_KEY` |
| STT URL, model, key | `stt_base_url` with `/v1` (`http://localhost:5517/v1`), `stt_model`, `.env.local` → `VITE_YUI_STT_KEY` |

Create `.env.local` with `cp -n .env.example .env.local` and set only the keys the user gave. The `VITE_YUI_*_KEY` values in it apply to dev runs only; a release build carries no key and reads the keys entered in the Connection tab. Merge the answered keys into `configs/endpoints.json` and leave the rest out; an unset URL keeps that feature off. `pnpm tauri dev` reloads `configs/` on change; a change to `.env.local` needs a restart.

Done when this exits 0 and every value the user gave is in place:

```bash
node -e 'const c=JSON.parse(require("fs").readFileSync("configs/endpoints.json","utf8"));for(const k of Object.keys(c).filter(k=>k.endsWith("_url")))if(c[k]!==""&&!/^https?:\/\//.test(c[k]))process.exit(1)'
```

### 4. Verify

`pnpm build` exits 0.

When step 3 set a Chat Completions backend, also test that the chosen model calls tools; Chat Completions mode needs this because the client always declares its `generate_express` tool. Send one request to `<chat_base_url>/chat/completions` with the chosen model, one trivial function tool in `tools`, and a user message asking the model to call it. Omit `tool_choice`; Ollama does not support it ([Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)). LM Studio converts the model output to native `tool_calls` when the request carries `tools` ([LM Studio tool calling](https://lmstudio.ai/docs/developer/openai-compat/tools)). Send the `Authorization` header only when the user gave a key. The command writes the body to a temp file, captures the HTTP status and curl's exit code, and one `node -e` classifier reads all three (Node is a prerequisite through pnpm):

```bash
# Omit the Authorization header when the user gave no key.
resp=$(mktemp)
status=$(curl -sS -o "$resp" -w '%{http_code}' --max-time 120 "<chat_base_url>/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <key>" \
  -d '{
        "model": "<chat_model>",
        "messages": [{ "role": "user", "content": "Call the get_time tool." }],
        "tools": [{ "type": "function", "function": { "name": "get_time", "description": "Returns the current time.", "parameters": { "type": "object", "properties": {} } } }]
      }'); rc=$?
node -e 'const fs=require("fs");const st=process.argv[1],rc=process.argv[2],b=fs.readFileSync(process.argv[3],"utf8");if(rc==="28")console.log("timed out");else if(st==="000")console.log("no server answered");else if(st==="401"||st==="403")console.log("authentication failed");else if(st[0]!=="2"){let m="";try{const e=JSON.parse(b).error.message;if(typeof e==="string")m=e}catch{}console.log("HTTP "+st+": "+(m||b.slice(0,200)))}else{let t=null;try{t=JSON.parse(b).choices[0].message.tool_calls}catch{}console.log(t&&t.length?"tool call returned":"reply carried no tool call")}' "$status" "$rc" "$resp"
rm -f "$resp"
```

The command and the step 3 probe report exactly one of seven results:

1. `tool call returned`: the reply carries a non-empty `choices[0].message.tool_calls`.
2. `no server answered`: the status is 000 with any curl exit code other than 28; curl could not connect.
3. The server lists no model: the step 3 probe answered with an empty `data` array.
4. `authentication failed`: the status is 401 or 403.
5. `HTTP <status>: <message>`: any other non-2xx status; the message is the server's `error.message` when it is a string, or the first 200 bytes of the body.
6. `timed out`: curl hit `--max-time 120`. Run the command once more (the first request can include the model load) and report `timed out` only when the second run also times out.
7. `reply carried no tool call`: a 2xx reply whose `choices[0].message.tool_calls` is missing or empty. Run the test once more before reporting it, since a model can answer in text on one run; then tell the user the model cannot drive expression and suggest a tool-calling model such as [`qwen3`](https://ollama.com/library/qwen3).

Report to the user:

1. The paths written, never a key value.
2. The tool-call test result, one of the seven results above.
3. What was skipped, with the place to set it later: right-click the character → Connection.
4. The launch command, run from the checkout: `pnpm tauri dev`. The first run compiles the Rust side for several minutes, then opens a transparent window with the character. With no backend she idles, and a chat turn answers with a pointer to the Connection tab.
5. What the connection keeps across turns and where long-term memory comes from: [what the connection remembers](https://github.com/yw0nam/YUI/blob/main/docs/guide/getting-started.md#what-the-connection-remembers).
6. The optional services (TTS, STT, backend agents) are covered in the [install and wiring guide](getting-started.md).

# avatar

Lets the agent query the avatar's own body state and move it on screen with semantic verbs. Runs **host-native** — it talks to the YUI client's loopback ingress, which only exists on the Mac running the app, so a container has nothing to reach.

## Run

YUI must be running with the agent ingress enabled (Quick controls → agent notify), since the ingress binds only when that toggle is on and applies on the next launch.

```bash
cd Mods/avatar && uv sync
uv run avatar-mcp --transport http --host 127.0.0.1 --port 9002
```

`AVATAR_INGRESS_URL` points the mod at the client (default `http://127.0.0.1:8770`, the client's stored ingress port). Set it if the ingress port was changed in the settings panel.

## Safety boundary (operator responsibility)

The avatar is the user's desktop pet: these tools move a visible window on their screen.

- **Movement only.** No emotion, motion, speech, or screen capture — expression travels on the `generate_express` stream, and screens belong to [desktop-control](../desktop-control/). This mod cannot see anything the YUI client does not already know.
- **The user always wins.** Dragging the avatar aborts an agent-driven move, and a command arriving while the user is still holding it is refused outright — both report `interrupted`. One gesture runs at a time; a second concurrent command reports `busy`.
- **The HTTP transport has no auth**, and neither does the client ingress it calls. Any local process that can reach `127.0.0.1:9002` (or the ingress port) can move the avatar. That is acceptable for personal-desktop use with both bound to loopback and reached over the SSH reverse tunnel below.

## Expose to the remote agent

The server binds `127.0.0.1` only. Reach it from the remote host with an SSH reverse tunnel — either the mod port directly, or the router port to cover every mod with one tunnel:

```bash
ssh -R 9002:localhost:9002 <remote-host>      # this mod only
ssh -R 8080:localhost:8080 <remote-host>      # router: all mods, one port
```

The agent then adds the MCP tool source at `http://localhost:9002/mcp` directly, or `http://localhost:8080/avatar/mcp` through the router (from the remote's view).

## Tools

| Tool | Description |
|---|---|
| `get_body_state()` | Window position + monitor, posture (sitting / peeking / dragging and what it is perched on), loaded VRM, and whether a move is running |
| `list_perch_targets()` | The client's tracked perch candidates (windows with app / title / rect) plus the peek edges |
| `sit_on_window(app)` | Sit on the top edge of that app's window (name matched case-insensitively) |
| `peek(side)` | Peek around the `"left"` or `"right"` edge of the frontmost window |
| `move_to(spot, monitor=None)` | Move to `"center"`, `"top-left"`, `"top-right"`, `"bottom-left"` or `"bottom-right"`; omit `monitor` to stay on the current one |
| `stand_down()` | Release any perch or peek and return to the normal standing position |

A gesture that did not happen raises a tool error carrying the client's reason — `not_found`, `blocked` (a window in front covers that spot, so nothing moved), `interrupted`, `busy`, or `unsupported`.

## Test

```bash
cd Mods/avatar && uv run pytest
```

The tests run against a stubbed local HTTP server, so no YUI app is needed.

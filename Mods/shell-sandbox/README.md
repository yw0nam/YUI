# shell-sandbox

An unrestricted shell exposed to the agent, running inside a container against a bind-mounted host directory. The agent can read, edit, build, install deps, and run tests in the mounted workspace. There is no command allowlist — `rm`, `pnpm`, `pip`, build steps all run. **The container is the boundary**; the operator picks what to mount.

## Run

```bash
cd Mods    # docker-compose.yml lives here
SHELL_SANDBOX_MOUNT="$PWD" docker compose up -d --build shell-sandbox
```

The server binds `0.0.0.0:9001` *inside* the container; the compose `ports` entry publishes it to host loopback only (`127.0.0.1:9001`). `SHELL_SANDBOX_MOUNT` is the host dir mounted read-write at `/work` (defaults to a scratch `./work` so you don't expose originals by accident); `--cap-drop ALL` and `no-new-privileges` are set in `docker-compose.yml`.

Env (all optional): `SHELL_SANDBOX_WORKDIR` (default `/work`), `SHELL_SANDBOX_TIMEOUT` (seconds, default `300`), `SHELL_SANDBOX_MAX_OUTPUT` (chars per stream, default `100000`; output is tail-truncated past this), `SHELL_SANDBOX_MAX_IMAGE_BYTES` (default `10000000`; `read_image` rejects files larger than this).

## Safety boundary (operator responsibility)

The shell is unrestricted by design, so isolation comes entirely from the container and what you mount:

- **The mounted directory is the only host state reachable, and it is writable.** `rm -rf /work/*` deletes the host files there for real. Mount a copy or a dedicated scratch directory if you don't want the agent to mutate originals; everything outside the mount is unreachable.
- **The HTTP transport has no auth** (same as desktop-control). Keep the publish on `127.0.0.1` and reach it from the remote agent via SSH reverse tunnel — never publish to `0.0.0.0` on the host.
- **Network egress is open** (needed for `pnpm`/`pip` installs), so `--network=none` is not used. The container can reach the internet.
- The container runs as root with `--cap-drop ALL` and `no-new-privileges`. Standard `runc` shares the host kernel; for genuinely untrusted input, run under gVisor (`--runtime=runsc`) or a microVM (Kata) — that's the upgrade path, not the default.

## Expose to the remote agent

```bash
ssh -R 9001:localhost:9001 <remote-host>      # this mod only
ssh -R 8080:localhost:8080 <remote-host>      # router: all mods, one port
```

The agent adds the MCP tool source at `http://localhost:9001/mcp` directly, or `http://localhost:8080/shell/mcp` through the router (from the remote's view).

## Tools

| Tool | Description |
|---|---|
| `run(command)` | Run a shell command in the workspace; returns `exit_code`, `stdout`, `stderr`, `truncated`, `timed_out` |
| `read_image(path)` | Read an image file (png/jpg/jpeg/gif/webp) from the workspace and return it as a viewable image — `run` returns text only |

## Test

```bash
cd Mods/shell-sandbox && uv run pytest
```

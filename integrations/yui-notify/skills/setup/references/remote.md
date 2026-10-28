# YUI on this machine, the agent over SSH

YUI and its ingress stay on the user's local machine. The agent runs on a remote host and
posts to `http://127.0.0.1:<remote port>` on that host. A reverse SSH tunnel, started on the
local machine, carries the request back to YUI's listener.

The tunnel must live apart from interactive sessions. An agent in tmux or screen keeps
running after the SSH connection that started it closes, and some SSH clients do not read
`~/.ssh/config`. A `RemoteForward` in an interactive connection serves the hooks only while
that one connection is open.

## 1. Choose the remote port

Use YUI's port (default `8770`, shown in YUI under Settings → Proactive → Watchers →
Listener port) when it is free on the remote host. When another process holds it there,
choose any free port, for example `15001`. YUI keeps its own port; only the remote end
changes.

On the remote host, this prints nothing when the port is free:

```bash
ss -ltn | grep ':<remote port> '
```

Done when: the user has named a remote port that is free on the remote host.

## 2. Run a supervised reverse tunnel on the local machine

The tunnel is one `ssh` process:

```bash
ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
    -R 127.0.0.1:<remote port>:127.0.0.1:<YUI port> <host>
```

- `ExitOnForwardFailure` ends `ssh` when the remote port cannot be bound, so the supervisor
  tries again instead of keeping a connection with no tunnel.
- `ServerAliveInterval` and `ServerAliveCountMax` end a connection whose link died, so the
  supervisor reconnects.
- `BatchMode` needs key authentication that asks for nothing.

A supervisor starts it at login and restarts it when it exits.

macOS, a launchd agent at `~/Library/LaunchAgents/<label>.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string><label></string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/ssh</string><string>-N</string>
    <string>-o</string><string>BatchMode=yes</string>
    <string>-o</string><string>ExitOnForwardFailure=yes</string>
    <string>-o</string><string>ServerAliveInterval=30</string>
    <string>-o</string><string>ServerAliveCountMax=3</string>
    <string>-R</string><string>127.0.0.1:<remote port>:127.0.0.1:<YUI port></string>
    <string><host></string>
  </array>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
</dict>
</plist>
```

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/<label>.plist
```

Linux, a systemd user unit at `~/.config/systemd/user/<name>.service`:

```ini
[Unit]
Description=Reverse tunnel for yui-notify

[Service]
ExecStart=/usr/bin/ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -R 127.0.0.1:<remote port>:127.0.0.1:<YUI port> <host>
Restart=always
RestartSec=30

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now <name>.service
```

The user runs these commands; they add a process that starts at every login.

Done when: on the remote host, `ss -ltn | grep ':<remote port> '` lists `127.0.0.1:<remote port>`.

## 3. Probe from a connection without forwards

A probe inside a connection that carries its own `RemoteForward` passes through that
connection's tunnel and proves nothing about the supervised one. Ask the user to run the
probe on the local machine through a connection with every forward cleared. Give the
absolute path of `../../scripts/yui-notify` on the remote host:

```bash
ssh -o ClearAllForwardings=yes <host> 'python3 <path>/scripts/yui-notify probe --endpoint http://127.0.0.1:<remote port>'
```

Done when: the command prints `ok: YUI is listening at http://127.0.0.1:<remote port>/signals`.
The endpoint for setup step 5 is `http://127.0.0.1:<remote port>`, followed by
`/presets/<id>` for a preset's character.

## The label on a remote signal

The remote host sets `SSH_CONNECTION`, so the plugin puts that host's name first in the
label: `devbox · tmux yui:2 · YUI (main)`. The user can tell a remote agent's signal from a
local one by that first part.

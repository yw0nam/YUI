# Producer on another host

The producer runs on a remote host, and YUI and its listener stay on the user's local
machine. The producer posts to `http://127.0.0.1:<remote port>` on the remote host. A
reverse SSH tunnel, started on the local machine, carries those requests to YUI's listener.

The tunnel must live apart from interactive sessions. A forward in an interactive SSH
connection serves only while that one connection is open.

## 1. Choose the remote port

Use YUI's port (default `8770`, shown under Settings → Proactive → What she reacts to →
External signals → Listener port) when it is free on the remote host. When another process
holds it, choose any free port, such as `15001`. YUI keeps its own port. Only the remote end
changes.

On the remote host, this prints nothing when the port is free:

```bash
ss -ltn | grep ':<remote port> '
```

Without `ss`, use `netstat -an | grep '\.<remote port> '`.

Done when: the user has named a remote port that is free on the remote host.

## 2. Run a supervised reverse tunnel on the local machine

The tunnel's `ssh` reads the local `~/.ssh/config`. Remove every `RemoteForward` of the YUI
port or the remote port from that entry. Another forward of either port makes the tunnel
fail to bind, or takes the port from it. This prints nothing when the entry is clean:

```bash
ssh -G <host> | grep -i remoteforward
```

The remote host's `sshd_config` must allow TCP forwarding: `AllowTcpForwarding` is `yes`,
or left at its default. The remote end binds to `127.0.0.1` only, so the server needs no
`GatewayPorts` setting.

The tunnel is one `ssh` process:

```bash
ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
    -R 127.0.0.1:<remote port>:127.0.0.1:<YUI port> <host>
```

- `ExitOnForwardFailure` ends `ssh` when the remote port cannot be bound, so the supervisor
  retries.
- `ServerAliveInterval` and `ServerAliveCountMax` end a dead link, so the supervisor
  reconnects.
- `BatchMode` needs key authentication that asks for nothing, and a host key already in
  `known_hosts`.

The user runs the tunnel under a supervisor they manage. It starts at login and restarts
when `ssh` exits.

Done when: `ssh -G <host>` lists no `RemoteForward` for either port, and on the remote host
`ss -ltn | grep ':<remote port> '` lists `127.0.0.1:<remote port>`.

## 3. Probe from a connection without forwards

A probe inside a connection that carries its own forward passes through that connection's
tunnel and proves nothing. Run the probe from the local machine through a connection with
every forward cleared. The `curl` runs on the remote host:

```bash
ssh -o ClearAllForwardings=yes -o ControlPath=none <host> 'curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:<remote port>/threads/probe'
```

Done when: the command prints `405`, since the route exists and takes only PUT.

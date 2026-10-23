# YUI on this machine, the agent over SSH

YUI and its ingress stay on the user's local machine. The agent runs on a remote host, and
the plugin's endpoint stays `http://127.0.0.1:<port>` on that host. An SSH reverse tunnel
carries the request back to the local listener.

## 1. Add the reverse tunnel to the local SSH config

In the **local** `~/.ssh/config`, under the `Host` entry for the remote machine, add:

```
RemoteForward 8770 127.0.0.1:8770
```

Replace `8770` with the port shown in YUI under Settings → Proactive → Watchers → Listener
port.

Done when: the `Host` entry holds one `RemoteForward` line for the YUI port.

## 2. Reconnect

Close the session and start it again so the tunnel exists. The plugin runs on the remote
host, and a session opened before the change has no tunnel.

Done when: `ss -ltn` or `netstat -an` on the remote host lists the YUI port on `127.0.0.1`.

## 3. Probe from the remote host

Run the probe on the remote host, where the hooks run:

```bash
../../scripts/yui-notify probe --endpoint http://127.0.0.1:8770
```

Done when: the probe prints `ok: YUI is listening at http://127.0.0.1:8770`.

## The label on a remote signal

The remote host sets `SSH_CONNECTION`, so the plugin puts that host's name first in the
label: `dev43 · tmux yui:2 · YUI (main)`. The user can tell a remote agent's signal from a
local one by that first part.

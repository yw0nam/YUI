# Plugins

The **Plugins** page installs MCP servers and skills that the backend of every character can use. It is desktop-app only: the page appears in a build that runs the plugin host, so a browser-only development build has no **Plugins** tab.

## Where it is

Open the settings window, then **Plugins** in the rail under **Every character**, after **Permissions**. The page has two sections: **Installed plugins** and **Available plugins**.

## Install from the catalog

**Available plugins** lists the catalog entries for your platform that are not installed yet, each with its source badge and version:

| Badge | What it means |
| --- | --- |
| **Official** | Reviewed and built in the YUI repository, with the release's checksum pinned in the catalog |
| **Community** | As its author published it, with the release checked against the author's `checksums.txt` |

**Install** unpacks the release into the app's data folder and shows **Installing…** until the call settles. A failure shows its reason under the row, with **Retry**. An installed plugin starts off: it runs nothing until you turn it on.

## Turn on with consent

The first time you turn a plugin on, the switch asks before anything runs, in two steps.

1. The first step shows the plugin's **Source** (badge, review note, and folder), **Version**, and **Launch command**: one line per server, naming the server when the plugin has more than one. **Allow** records your approval and starts the servers with your permissions; every character shares them. **Cancel** closes the step without running anything.

2. The second step lists the tools and skills the backend now sees, with each description. **OK** closes it; the plugin's server lines and a **Tools: n** disclosure then show under the switch.

A local plugin is approved once for its folder. Changing the files in that folder does not ask again. A Community update from the catalog does; an Official update does not.

## Update

When the catalog lists another version of an Official or Community plugin, the row shows **Update to v&lt;version&gt;**; it installs that version in place of the old one. **Check for updates** reloads the catalog and reports **Updates: n** or **All up to date** for a few seconds.

An Official update keeps your approval, so the plugin keeps running. A community update leaves the plugin on with its approval cleared: the row shows **Allow again…** with a note that the update changed its contents, and nothing runs until you allow it again.

## Remove

**Delete** removes a catalog plugin's code, its data, and its installed versions. **Remove from list** removes a local plugin from the list and deletes its data, and leaves the folder where it is. Both ask first.

## Add from a folder

**Add from folder…** opens a folder picker. Pick a folder that holds `.claude-plugin/plugin.json`; a `.mcp.json` in the folder declares the plugin's servers, and `skills/*/SKILL.md` declares its skills. The plugin runs in place, from the folder you picked, and its contents are not checked.

## Status lines

Each server of an installed plugin shows one line:

| State | What it means |
| --- | --- |
| **Running** | The server answered and declared its tools; the tools disclosure under the server lines gives the count |
| **Starting…** | The server is launching and connecting |
| **Unavailable** | The server stopped at a start step, which the line names — launch, initialize, or tool list — with the reason. **Retry** starts that server again |
| **Exited** | The server ran and then ended; the line gives the reason, and **Restart** starts it again |
| **Off** | The plugin is off, so nothing runs |

A plugin that fails to start stays on, and the app tries its servers again the next time it opens.

## Hidden names

A tool or skill name belongs to one holder: a built-in tool first, then each plugin in the order it was turned on. When a later plugin declares a name that is already taken, that name is hidden there and the plugin keeps running with its other names. The page names every hidden name; it names the plugin that keeps it, or says a built-in tool uses it.

## Log

**Log** opens the plugin's last lines, up to 20, and its foot says how many. **Open log folder** opens the folder that holds the full logs in the system's file manager. Each file is named for its plugin and date — `plugins/<id>_YYYY-MM-DD.log` — inside the app's log folder: `~/Library/Logs/com.yui.desktop/` on macOS in a release build, the repository's `logs/` in a desktop development build.

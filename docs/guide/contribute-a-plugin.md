# Contribute a plugin

A plugin that works from a folder can be listed, so other users install it from the Plugins page. Two routes lead there: a community listing, or an official plugin inside the YUI repository.

To do this with a coding agent, paste this line:

```text
Contribute my YUI plugin at <path>, following https://raw.githubusercontent.com/yw0nam/YUI/main/skills/yui-plugin/SKILL.md
```

Take the community route when the plugin stays in your own GitHub repository. Take the official route when YUI should ship the plugin itself, and only after a maintainer agrees to it.

## List a community plugin

A **Community** plugin lives in the author's public GitHub repository, and YUI installs it from:

- `.claude-plugin/plugin.json` on the default branch, carrying the current `version`.
- A GitHub release tagged `v<version>`.
- One asset per declared platform, named `<id>-<version>-<platform>.zip`, where `<platform>` is `darwin-arm64` or `windows-x64`.
- A zip rooted at the plugin folder, holding `.claude-plugin/plugin.json` with the entry's `id` and the tagged version.
- `checksums.txt` in that release, one `sha256sum` line per asset: `<hex>  <file>` or `<hex> *<file>`.

### Publish the release

Put the plugin in a public GitHub repository, then publish a release that meets every line above. YUI reads the version from the default branch, so a release goes out before its version reaches that branch.

### Add it to the catalog

1. Open a PR that adds the plugin to `community` in `plugins/catalog.json`: `repo` as `<owner>/<name>`, and `platforms` naming the platforms the release has an asset for. Keep `community` sorted by `id`.

   ```json
   "community": [
     {
       "id": "my-plugin",
       "repo": "owner/yui-my-plugin",
       "platforms": ["darwin-arm64", "windows-x64"]
     }
   ]
   ```

2. On the first listing, a maintainer reads the plugin's source and installs it once before merging.

### Ship an update

An update needs no PR: a release carrying another version, and that version on the default branch. YUI clears the user's approval on a community update, so the user allows the updated version again ([Plugins § Update](./plugins.md#update)).

## Add an official plugin

An **Official** plugin lives under `plugins/<id>/` in the YUI repository, and the release workflow builds and releases it. [Build, Run & Logs § Plugin releases](https://github.com/yw0nam/YUI/blob/main/docs/agent-guide/build-run.md#plugin-releases) carries the tag, the version rule and the zip layout.

Open the issue first, from the [feature task template](https://github.com/yw0nam/YUI/blob/main/.github/ISSUE_TEMPLATE/feature_task.md), so a maintainer can agree that YUI ships this plugin. After that agreement, [Plugins & CI](https://github.com/yw0nam/YUI/blob/main/docs/agent-guide/plugins.md) holds the folder layout and the local checks, and Build, Run & Logs § Plugin releases above holds the tag and the release.

To build the plugin itself first, see [Write a plugin](./write-a-plugin.md).

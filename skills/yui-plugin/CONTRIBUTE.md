# Contribute a YUI plugin

This file takes a plugin that already works in the user's YUI to a listing other users can install. Follow the rules in [SKILL.md](https://raw.githubusercontent.com/yw0nam/YUI/main/skills/yui-plugin-build/SKILL.md). [Contribute a plugin](https://github.com/yw0nam/YUI/blob/main/docs/guide/contribute-a-plugin.md) holds every fact, and each step links the section that holds its own.

## 0. Check the precondition

Confirm that the plugin passes step 5 of [BUILD.md](https://raw.githubusercontent.com/yw0nam/YUI/main/skills/yui-plugin-build/BUILD.md): the user's character used one of its tools in a reply.

Done: the user confirms that a reply used the plugin. When it did not, stop here and run BUILD.md first.

## 1. Choose the route with the user

Give the user two routes:

- Community listing: the plugin stays in the user's GitHub repository, and the catalog lists it. This is the default.
- Official plugin: the plugin moves into the YUI repository, and the release workflow builds it. This route waits for a maintainer's agreement.

Done: the user names one route. Read [List a community plugin](https://github.com/yw0nam/YUI/blob/main/docs/guide/contribute-a-plugin.md#list-a-community-plugin) or [Add an official plugin](https://github.com/yw0nam/YUI/blob/main/docs/guide/contribute-a-plugin.md#add-an-official-plugin) for the result of the chosen route.

## 2. Community: publish the release

Put the plugin in a public GitHub repository. Build one zip per platform. Publish the release and write `checksums.txt`. Read [Publish the release](https://github.com/yw0nam/YUI/blob/main/docs/guide/contribute-a-plugin.md#publish-the-release) for the asset names and the checksum lines.

Done: every check in [List a community plugin](https://github.com/yw0nam/YUI/blob/main/docs/guide/contribute-a-plugin.md#list-a-community-plugin) holds, and a command verified each one. Download the asset, compare `shasum -a 256` with the line in `checksums.txt`, unzip the asset, and read the `plugin.json` at the zip root.

## 3. Community: set the version on the default branch

Put the released version in `.claude-plugin/plugin.json` and commit it, so the default branch carries that version.

Done: the raw `plugin.json` on the default branch shows the released version.

## 4. Community: open the catalog PR

Fork the YUI repository and add the entry to `community` in `plugins/catalog.json`. Open the PR from `.github/PULL_REQUEST_TEMPLATE.md` and write the title in Conventional Commit form. Read [Add it to the catalog](https://github.com/yw0nam/YUI/blob/main/docs/guide/contribute-a-plugin.md#add-it-to-the-catalog) for the entry fields and the sort order.

Done: you have the PR URL, and `community` in your diff stays sorted by `id`.

## 5. Official: open the issue, then follow the agent guide

Open the issue from `.github/ISSUE_TEMPLATE/feature_task.md` and stop until a maintainer agrees. After the agreement, follow [Plugins & CI](https://github.com/yw0nam/YUI/blob/main/docs/agent-guide/plugins.md) for the folder and its checks, and [Plugin releases](https://github.com/yw0nam/YUI/blob/main/docs/agent-guide/build-run.md#plugin-releases) for the tag and the release.

Done: you have the issue URL. After the agreement, you have the PR URL.

## 6. Hand back

Give the user the URLs, then tell the user what happens next: a maintainer reads the source and installs the plugin once before merging, and an update needs no PR ([Ship an update](https://github.com/yw0nam/YUI/blob/main/docs/guide/contribute-a-plugin.md#ship-an-update)).

Done: the user has every URL, and knows who acts next on the plugin.

# Catalog conventions: Obsidian, MCPB / Claude Desktop, VS Code

Issue: yw0nam/YUI #1660. Research date: 2026-10-28.

Scope: how three extension hosts name, version, and fetch release assets per platform; how each verifies integrity; how each detects updates; and which GitHub limits apply to release-asset fetching. Every claim cites a primary URL fetched in this session, or a repo file:line. Anything not confirmed from a primary source is marked UNVERIFIED in section 6.

## 2. Hosts

### 2.1 Obsidian

**Catalog.** `community-plugins.json` in `obsidianmd/obsidian-releases` is a JSON array. Each entry has five keys: `id`, `name`, `author`, `description`, `repo` (measured: 9,556 entries; key set taken from the first entry and the union across all entries; source https://github.com/obsidianmd/obsidian-releases/blob/master/community-plugins.json). The repo README says: "The `name`, `author` and `description` fields are used for searching." and "The `manifest.json` in your repo will only be used to figure out the latest version. Actual files are fetched from your GitHub releases." (https://github.com/obsidianmd/obsidian-releases/blob/master/README.md, section "How community plugins are pulled").

**Asset naming per platform.** None. Obsidian does not name per-platform assets. The release must carry `main.js`, `manifest.json`, and `styles.css` as binary attachments. The docs say: "Upload the following plugin assets to the release as binary attachments: `main.js`, `manifest.json`, and `styles.css`" (https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin). The one platform field is `isDesktopOnly` (required, boolean; "whether a plugin can only run on the desktop app, for example because it uses NodeJS or Electron APIs") (https://docs.obsidian.md/Reference/Manifest).

**Version and update detection.**
- Tag rule: "Create a tag that matches the version in the `manifest.json` file." and "For Obsidian plugins, this must be the same as the version." (https://docs.obsidian.md/Plugins/Releasing/Release+your+plugin+with+GitHub+Actions, step 4).
- Version format: "The version, using Semantic Versioning ... in the format `x.y.z`" (https://docs.obsidian.md/Reference/Manifest). Submit page: "Versions supported only in the format `x.y.z`." and "The "Tag version" of the release must match the version in your `manifest.json`." (https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin).
- Detection: the directory "processes the `manifest.json` at the HEAD of your repository's default branch" (https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin). Install: "When the user chooses to install your plugin, Obsidian will look for your GitHub releases tagged identically to the version inside `manifest.json`. Obsidian will download `manifest.json`, `main.js`, and `styles.css` (if available)..." (https://github.com/obsidianmd/obsidian-releases/blob/master/README.md).
- Compatibility fallback: "If your `manifest.json` requires a version of Obsidian that's higher than the running app, your `versions.json` will be consulted to find the latest version of your plugin that is compatible." (same README). The field `minAppVersion` is required (https://docs.obsidian.md/Reference/Manifest).
- Release workflow: the official Obsidian sample workflow runs `gh release create "$tag"` with `main.js manifest.json styles.css` and "creates a signed build provenance attestation for your release assets" (https://docs.obsidian.md/Plugins/Releasing/Release+your+plugin+with+GitHub+Actions, step 1). The submit page lists this as a release step, not as a verification step by Obsidian.

**Integrity.**
- No checksum or signature field exists in `manifest.json` (fields per https://docs.obsidian.md/Reference/Manifest: `author`, `minAppVersion`, `name`, `version`, `authorUrl`, `fundingUrl`, `description`, `id`, `isDesktopOnly`).
- No checksum or signature field exists in `community-plugins.json` (five keys above).
- The docs describe a "signed build provenance attestation" created by the sample release workflow (URL above). The docs do not say that Obsidian verifies it.
- The docs do not say whether the Obsidian team hashes release files. "The directory ... reviewed automatically" is the only statement on review (https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin).
- Obsidian is closed source: "Obsidian is not open source software and this repo _DOES NOT_ contain the source code of Obsidian." (README). The app's fetch logic is therefore UNVERIFIED (section 6).

**Repo mirror.** `.github/workflows/mirror-community-json.yml` in `obsidianmd/obsidian-releases` mirrors `https://community.obsidian.md/assets/community-plugins.json` hourly and validates the result (https://github.com/obsidianmd/obsidian-releases/blob/master/.github/workflows/mirror-community-json.yml). It checks plugin entries for required string fields and a minimum entry count (`PLUGINS_MIN_ABSOLUTE: 1500`). It does not touch release assets.

### 2.2 MCPB / Claude Desktop extensions

**Status warning.** The primary Anthropic docs say the Claude Desktop extension directory is closed to new MCPB submissions. "Desktop extension listings in the directory are deprecated, and the directory no longer accepts local MCP servers packaged as desktop extensions (MCPB). To distribute a local MCP server through the directory, include it in a plugin bundle." (https://claude.com/docs/directory/publish, section "Submit your plugin, and your MCP server as a connector"). The MCPB build page repeats: "Desktop extension listings in the directory are deprecated, and the directory no longer accepts MCPB submissions." (https://claude.com/docs/connectors/building/mcpb, section "Distribute your MCPB"). A Claude Help Center article still describes a "desktop extension submission form" (https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop); the two sources conflict, and the newer developer docs are the more reliable guide. The article's date was not visible in the fetch.

**Catalog and format.** A `.mcpb` file is a zip archive: "MCP Bundles (`.mcpb`) are zip archives containing a local MCP server and a `manifest.json`" (https://github.com/modelcontextprotocol/mcpb/blob/main/README.md). Packaging: `mcpb pack` (same README; CLI reference https://github.com/modelcontextprotocol/mcpb/blob/main/CLI.md, section `mcpb pack <directory> [output]`). Manifest: `manifest_version`, `name`, `version` (semver), `server`, and others (https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md, lines ~14-16 and ~230-240). There is no catalog file; the directory is a web listing (UNVERIFIED for its internal format).

**Asset naming per platform.** The format has one archive per extension, not one per platform. Platform is declared inside the manifest:
- `compatibility.platforms`: "Array of supported platforms (`darwin`, `win32`, `linux`). These match Node.js `process.platform` ... If omitted, all platforms are supported" (MANIFEST.md, section "Compatibility").
- `mcp_config.platform_overrides` with keys like `win32` and `darwin` for command, args, and env per platform (MANIFEST.md, section on platform-specific configurations).
- No per-platform file naming convention is specified in the MANIFEST or README (checked both).
- Claude Desktop platforms: "Claude Desktop runs on macOS (`darwin`) and Windows (`win32`)." (https://claude.com/docs/connectors/building/mcpb, section "Platform support").

**Version and update detection.**
- `version` is semver, "Semantic version of your extension" (MANIFEST.md).
- Official directory: "Extensions from the official directory update automatically by default." "For privately distributed extensions, users will need to install updated .mcpb files manually." (https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop, section "Updates"). This is the only source; the directory is deprecated, so the rule may no longer apply.
- The MCPB README mentions "automatic updates" as a feature of Claude for macOS and Windows but does not describe the mechanism (https://github.com/modelcontextprotocol/mcpb/blob/main/README.md).

**Integrity and signatures.** This is the one host with a signature scheme in the open-source toolchain.
- `mcpb sign <mcpb-file>` signs "with a certificate"; certificate requirements: "X.509 certificate in PEM format", "Should have Code Signing extended key usage", "Can be self-signed (for development) or CA-issued (for production)" (CLI.md, sections `mcpb sign` and "Certificate Requirements").
- `mcpb verify <mcpb-file>` reports "Signature validity status", certificate subject/issuer/dates/fingerprint, and "Warning if self-signed" (CLI.md, section `mcpb verify`). `mcpb unsign` "Removes the signature ... (for development/testing)."
- Implementation (`src/node/sign.ts`, https://github.com/modelcontextprotocol/mcpb/blob/main/src/node/sign.ts): PKCS#7 detached signature with SHA-256 digest (`digestAlgorithm: forge.pki.oids.sha256`, line ~65); the signature block is appended after the ZIP end-of-central-directory and its markers are `MCPB_SIG_V1` / `MCPB_SIG_END` (lines 13-14); `verifyMcpbFile` parses the PKCS#7 block (lines ~115-142).
- Whether Claude Desktop checks the signature: UNVERIFIED. The README says the repo contains "the code used by Claude for macOS and Windows to load and verify MCPB bundles" (README), but the Claude docs fetched above make no statement about signing or verification. A non-primary GitHub issue reports that `mcpb sign` output can be rejected by Claude Desktop with "Invalid comment length" (URL not confirmed in this session; see section 6, item 6).
- No sha256 field exists in the manifest spec (grep of MANIFEST.md, CLI.md, README.md for `sha`, `hash`, `digest`, `checksum` found none).

### 2.3 VS Code platform-specific extensions

**Catalog.** The Visual Studio Marketplace is the catalog; publishing goes through `vsce`. The docs describe packaging as `vsce package` producing a `.vsix` file (https://code.visualstudio.com/api/working-with-extensions/publishing-extension). Marketplace catalog schema is not in the fetched docs (UNVERIFIED).

**Asset naming per platform.** Platform-specific packages are separate packages. Quoted: "Platform-specific extensions are published as separate packages containing platform-specific content." Valid targets: "`win32-x64`, `win32-arm64`, `linux-x64`, `linux-arm64`, `linux-armhf`, `alpine-x64`, `alpine-arm64`, `darwin-x64`, `darwin-arm64` and `web`." Commands: `vsce package --target win32-x64` and `vsce publish --target win32-x64 win32-arm64` (publishing-extension, section "Platform-specific extensions"). The `.vsix` file name pattern for a target is UNVERIFIED (not stated in the fetched page).

**Version and update detection.**
- VS Code selects the package: "Starting with version `1.61.0`, VS Code looks for the extension package that matches the current platform." (publishing-extension).
- Updates: "VS Code checks for extension updates and installs them automatically." "By default, VS Code waits a short time after an update is published before it installs the update automatically." "When auto-update is enabled, VS Code updates only enabled extensions." (https://code.visualstudio.com/docs/configure/extensions/extension-marketplace, section "Extension auto-update").
- The mechanism (polling endpoint) is not described in the fetched pages (UNVERIFIED).
- VSIX installs: "When you install an extension via VSIX, [auto update](...) for that extension is disabled by default." (extension-marketplace, section "Install from a VSIX").

**Integrity.**
- Marketplace signing: "The Visual Studio Marketplace signs all extensions when they are published." "VS Code verifies this signature when you install an extension to check the integrity and the source of the extension package." (https://code.visualstudio.com/docs/configure/extensions/extension-marketplace, section on signature verification). Error codes listed there include `SignatureIsInvalid`, `Untrusted`, and others. The disable switch is the `extensions.verifySignature` setting (same page).
- The publishing page (https://code.visualstudio.com/api/working-with-extensions/publishing-extension) says nothing about signing or integrity.
- Whether signature verification applies to a VSIX installed from a GitHub release: the docs say "The page doesn't say whether signature verification applies to extensions installed from a `.vsix` file" (extension-marketplace, fetched). UNVERIFIED for GitHub-hosted VSIX. A WebSearch result (non-primary, 2023 GitHub discussion `microsoft/vscode-discussions#137`) says sideloaded VSIX "will currently not verify a signature"; not confirmed on a primary doc.
- No sha256 or checksum field appears in the publishing page or the extension manifest reference (https://code.visualstudio.com/api/references/extension-manifest: no target or signing field found).

## 3. GitHub limits and release-asset metadata

**REST rate limits.** (https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- Unauthenticated: "The primary rate limit for unauthenticated requests is 60 requests per hour."
- Authenticated: "All of these requests count towards your personal rate limit of 5,000 requests per hour."
- Secondary limits: "These secondary rate limits are subject to change without notice." "No more than 100 concurrent requests are allowed."
- `GET /rate_limit` is exempt from the primary limit.

**Are direct release-asset downloads counted?** The rate-limit page does not mention release-asset downloads or `github.com` URLs (fetched). So the docs do not say whether `https://github.com/<owner>/<repo>/releases/download/<tag>/<asset>` counts toward the REST quota. UNVERIFIED. The REST asset endpoint is different: `GET /repos/{owner}/{repo}/releases/assets/{asset_id}` with `Accept: application/octet-stream`, which "will either redirect the client to the location, or stream it directly if possible" and "API clients should handle both a 200 or 302 response" (https://docs.github.com/en/rest/releases/assets). The docs do not name `objects.githubusercontent.com` as the redirect target (UNVERIFIED). So a host that fetches assets through `api.github.com` consumes the 60/hour unauthenticated budget per request, while a direct download URL is not documented as doing so (UNVERIFIED).

**Asset metadata.** Release asset objects include `browser_download_url`, `name`, `label`, `size`, `content_type`, `digest`, `download_count` (https://docs.github.com/en/rest/releases/assets). The `digest` field is described only as `string or null` in the REST reference. The GitHub changelog (2025-06-03) says: "GitHub now automatically computes and displays SHA256 checksums (digests) for all uploaded release assets." and "These digests are generated at upload time, immutable." It says the digests are visible in the Releases REST API, GraphQL, and `gh` CLI (https://github.blog/changelog/2025-06-03-releases-now-expose-digests-for-release-assets/). The changelog does not state the field's format. The `sha256:` prefix and the `null` for pre-existing assets are from a WebSearch summary, not confirmed on a primary page (UNVERIFIED).

**Draft releases.** "Only users with push access will receive listings for draft releases." "Information about published releases are available to everyone." (https://docs.github.com/en/rest/releases/releases, `draft` and list releases). A draft is not visible to anonymous fetchers until published.

**Direct links.** "the suffix is `/releases/latest/download/asset-name.zip`" (https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases). The page does not give the `releases/download/<tag>/<asset>` form or any rate-limit statement (fetched; UNVERIFIED for that form beyond the common usage).

**Attestations and checksums in releases.** The about-releases page does not mention checksums, digests, immutable releases, or attestations (https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases). Only the `immutable` boolean appears in the Release object schema, undocumented (https://docs.github.com/en/rest/releases/releases).

## 4. Repo context

**`.github/workflows/release.yml`** (fetched via `cat -n` in the worktree):
- `on.push.tags: ['v*']` at line 5. Concurrency at lines 7-9.
- `draft-release` job (lines 12-83) creates one draft release per tag. Version check at lines 27-41 compares the tag core to `src-tauri/tauri.conf.json` and `package.json` versions (line 38).
- The release body (lines 60-71) lists `macOS (Apple Silicon) | .dmg` and `Windows (x64) | .msi, -setup.exe`.
- `createRelease` at lines 73-82 with `draft: true` (line 80) and `prerelease: tag.includes('-')` (line 81).
- Build matrix at lines 95-103: `macos-aarch64` (`--target aarch64-apple-darwin`, lines 96-98) and `windows-x64` (lines 100-102). No Linux target.
- Apple signing and notarization via env (lines 119-157). This is code signing of the macOS bundle, not a checksum.
- `tauri-apps/tauri-action@v1` at lines 159-165 with `releaseId` (line 163) and `uploadUpdaterJson: false` (line 165).
- The workflow has no step that computes or uploads a sha256 file or checksum manifest. grep for `sha`, `checksum`, `digest` in the file finds nothing. Asset file names produced by tauri-action are not set in the file and were not verified (UNVERIFIED).
- The draft is created before the build jobs, so the uploaded assets are visible only to push-access users until the draft is published.

**`.claude-plugin/marketplace.json`** (fetched via `cat -n`):
- Line 2: `"name": "yui"`. Lines 3-5: owner `yw0nam`.
- Lines 6-12: a single `plugins` entry: `"name": "yui-notify"` (line 8), `"source": "./integrations/yui-notify"` (line 9), a description (line 10).
- No `version`, `sha256`, platform, or asset field. This is a Claude Code plugin catalog, a different host from the three above.

## 5. Comparison

| host | catalog | asset naming per platform | integrity | update detection | source |
| --- | --- | --- | --- | --- | --- |
| Obsidian community plugins | `community-plugins.json` array: `id`, `name`, `author`, `description`, `repo` (https://github.com/obsidianmd/obsidian-releases/blob/master/community-plugins.json) | None. Same three files (`main.js`, `manifest.json`, `styles.css`) per release. Platform only via `isDesktopOnly` boolean | No checksum or signature field. Sample workflow creates a "signed build provenance attestation". Obsidian verification of it not documented | `manifest.json` at HEAD of default branch gives the version; app fetches the release tagged with that version. `versions.json` for `minAppVersion` fallback | https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin ; https://docs.obsidian.md/Plugins/Releasing/Release+your+plugin+with+GitHub+Actions ; https://docs.obsidian.md/Reference/Manifest ; https://github.com/obsidianmd/obsidian-releases/blob/master/README.md |
| MCPB `.mcpb` / Claude Desktop extensions (directory deprecated) | No catalog file; web directory (deprecated). Local install by file | One zip per extension. Platform via `compatibility.platforms` (`darwin`, `win32`, `linux`) and `platform_overrides` | `mcpb sign` / `mcpb verify`: PKCS#7 detached SHA-256 signature, X.509 PEM cert. Claude Desktop check of it UNVERIFIED | Manifest `version` (semver). Official directory auto-updates (help article); private: manual. Deprecated directory | https://github.com/modelcontextprotocol/mcpb/blob/main/README.md ; https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md ; https://github.com/modelcontextprotocol/mcpb/blob/main/CLI.md ; https://github.com/modelcontextprotocol/mcpb/blob/main/src/node/sign.ts ; https://claude.com/docs/directory/publish ; https://claude.com/docs/connectors/building/mcpb |
| VS Code platform-specific extensions | Visual Studio Marketplace; `.vsix` via `vsce` | Separate packages per `targetPlatform`: `win32-x64`, `win32-arm64`, `linux-x64`, `linux-arm64`, `linux-armhf`, `alpine-x64`, `alpine-arm64`, `darwin-x64`, `darwin-arm64`, `web`. Package file name UNVERIFIED | Marketplace signs at publish; VS Code verifies at install (`extensions.verifySignature` setting). VSIX-from-GitHub path not documented | VS Code auto-checks and installs; delayed after publish. VSIX installs have auto-update disabled by default. Polling mechanism UNVERIFIED | https://code.visualstudio.com/api/working-with-extensions/publishing-extension ; https://code.visualstudio.com/docs/configure/extensions/extension-marketplace ; https://code.visualstudio.com/api/references/extension-manifest |
| GitHub release assets (the hosting layer) | Release object; assets listed with `browser_download_url`, `digest`, `name`, `size` | Free-form name; no platform field in the asset object | `digest` field (SHA-256, computed at upload, immutable per changelog); format of the prefix UNVERIFIED | Published releases visible to all; drafts only to push access. `releases/latest/download/<asset>` for latest | https://docs.github.com/en/rest/releases/assets ; https://github.blog/changelog/2025-06-03-releases-now-expose-digests-for-release-assets/ ; https://docs.github.com/en/rest/releases/releases |

## 6. Open questions and UNVERIFIED list

1. Obsidian app: how it fetches `main.js`, `manifest.json`, and `styles.css` (REST API vs direct `releases/download`), and whether it checks any digest or attestation. The app is closed source (Obsidian README), and the docs do not describe the fetch path. UNVERIFIED.
2. Obsidian: whether the Obsidian team hashes or verifies the release attestation. Not stated in the docs fetched. UNVERIFIED.
3. Obsidian `community-plugins.json` branch: the file was read from the raw URL on the default branch; the exact branch name was not re-confirmed. The entry count (9,556) was measured on the fetched file.
4. MCPB: whether Claude Desktop verifies `mcpb sign` signatures at install or update. The README says the code verifies bundles, but no primary doc describes the check. UNVERIFIED.
5. MCPB directory: the official docs say it is deprecated and closed to MCPB submissions (claude.com), while a help article still describes a submission form. The current status of extension auto-update in Claude Desktop is UNVERIFIED after the deprecation.
6. MCPB signing bug: a WebSearch result reports `mcpb sign` appends bytes after the ZIP EOCD in a way Claude Desktop rejects ("Invalid comment length"). That report is not from a primary source, and no fix status was confirmed. UNVERIFIED.
7. VS Code: `.vsix` file name pattern for a platform target (for example, whether `@<target>` is appended). Not in the fetched page. UNVERIFIED.
8. VS Code: whether signature verification applies to a `.vsix` installed from a GitHub release. The docs say the page does not state it. A 2023 discussion (non-primary) says it does not. UNVERIFIED.
9. VS Code: the update-check endpoint and polling interval. Not described in the fetched pages. UNVERIFIED.
10. GitHub: whether `github.com/<owner>/<repo>/releases/download/<tag>/<asset>` requests count against any rate limit. Docs silent. UNVERIFIED.
11. GitHub: redirect target hostname (`objects.githubusercontent.com`) for asset downloads. Not named in fetched docs. UNVERIFIED.
12. GitHub: the exact `digest` string format (`sha256:` prefix) and whether pre-June-2025 assets have digests. The changelog does not say; a WebSearch summary says `sha256:` and `null`. UNVERIFIED.
13. Repo: asset names that tauri-action produces for the macOS and Windows builds are not set in `release.yml`. The Downloads table in the draft body (`release.yml:60-71`) names `.dmg`, `.msi`, and `-setup.exe`, but the exact produced names were not checked against tauri-action docs (not fetched in this session). UNVERIFIED.
14. Repo: `release.yml` produces no checksum file, and `uploadUpdaterJson: false` (`release.yml:165`) means no `latest.json` updater manifest from tauri-action. Any integrity or update-manifest scheme would be new work.

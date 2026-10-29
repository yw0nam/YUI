# Install

Install YUI with a coding agent, from a release build, or from source.

![The character window on a transparent desktop](/shots/pet.png)

1. **With a coding agent.** Paste this into Claude Code, Codex, OpenCode, or Cursor, and the agent follows [Install with a coding agent](install.md).

   ```text
   Install https://github.com/yw0nam/YUI following https://raw.githubusercontent.com/yw0nam/YUI/main/docs/guide/install.md
   ```

2. **From a release build.** Each release on the [Releases page](https://github.com/yw0nam/YUI/releases) carries a build: `.dmg` for macOS on Apple Silicon, and `.msi` or `-setup.exe` for Windows x64. The macOS build is signed ad hoc, without a Developer ID certificate, so macOS refuses the first launch; allow the app once under System Settings → Privacy & Security → Open Anyway.

3. **From source.** Building needs Node.js with [pnpm](https://pnpm.io/) and Rust with the [Tauri v2 toolchain](https://v2.tauri.app/start/prerequisites/). Then run:

   ```bash
   pnpm install
   pnpm tauri dev        # transparent desktop-pet window on port 1420 (recommended)
   pnpm tauri:dev        # same window on an auto-picked free port, so worktrees run side by side
   pnpm dev              # browser-only, no Tauri shell
   pnpm build            # production build
   ```

## Your own character

One VRM model ships with the app, `Sendagaya_Shino.vrm`. To use another VRM 1.0 model, open the **Body** page and use **Add from file…** under VRM.

## Next

- [How YUI works](how-it-works.md): the body, the brain and one turn.
- [Connect a backend](connect-a-backend.md): one OpenAI key, a local model, or an agent.
- [Voice in and out](voice.md): TTS and STT.

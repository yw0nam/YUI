# Security Policy

## Supported versions

Security fixes land on `main` and ship in the next release. Only the
[latest release](https://github.com/yw0nam/YUI/releases/latest) receives fixes.

## Reporting a vulnerability

Report a vulnerability through GitHub's private form:
[Report a vulnerability](https://github.com/yw0nam/YUI/security/advisories/new).
The report stays private between you and the maintainer until a fix is
released. Keep vulnerabilities out of public issues, discussions, and pull
requests.

Include in the report:

1. The YUI version and the operating system.
2. The steps that reproduce the problem.
3. What an attacker gains: for example reading files, running code, or
   reaching a stored API key.

The maintainer answers within 7 days. A confirmed vulnerability is fixed in a
release, and the release notes credit the reporter unless the reporter asks
to stay unnamed.

## Scope

YUI's own code is in scope: the Tauri shell (`src-tauri/`), the web client
(`src/`), the backend wiring under `integrations/`, and the Mods under `Mods/`.

Report a vulnerability in a backend agent, model provider, TTS server, or STT
server to that project. YUI release builds are unsigned, and the operating
system's warning on first launch is expected behaviour.

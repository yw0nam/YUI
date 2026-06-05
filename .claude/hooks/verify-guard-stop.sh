#!/usr/bin/env bash
# Stop hook: block turn-end when this project's src/src-tauri was edited more
# recently than any runtime verification (playwright MCP browser_* or app-run).
# Portable: resolves the project root from $CLAUDE_PROJECT_DIR (set by Claude
# Code) and falls back to the script location. Fails OPEN on any error.

# Project root: Claude Code sets CLAUDE_PROJECT_DIR for hooks; fall back to
# <this script>/../.. (i.e. .claude/hooks/ -> project root).
PROJECT="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$PROJECT" ]; then
  PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)" || exit 0
fi
CNT="$PROJECT/.claude/.verify-attempts"
MAX=4

input=$(cat 2>/dev/null)
tr=$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null)
[ -z "$tr" ] && exit 0
[ -f "$tr" ] || exit 0

result=$(jq -rs --arg pd "$PROJECT" '
  [ .[]? | select(.type=="assistant") | .message.content[]? | select(.type=="tool_use")
    | { n: .name, f: (.input.file_path // ""), c: (.input.command // "") } ]
  | to_entries
  | ( ( map(select(
          (.value.n=="Write" or .value.n=="Edit" or .value.n=="NotebookEdit")
          and ( (.value.f | startswith($pd + "/src/"))
                or (.value.f | startswith($pd + "/src-tauri/")) )
          and (.value.f | test("\\.(ts|tsx|js|jsx|mjs|cjs|vue|rs|html|css|scss)$"))
        )) | last | .key ) // -1 ) as $le
  | ( ( map(select(
          (.value.n | test("playwright.*browser_"))
          or (.value.n=="Bash" and (.value.c
              | test("tauri +dev|(pnpm|npm|yarn) +(run +)?(dev|preview)|(^| )vite( |$)|playwright"; "i")))
        )) | last | .key ) // -1 ) as $lv
  | if ($le >= 0 and $le > $lv) then "BLOCK" else "OK" end
' "$tr" 2>/dev/null) || result="OK"

if [ "$result" != "BLOCK" ]; then
  rm -f "$CNT"
  exit 0
fi

n=$(cat "$CNT" 2>/dev/null || echo 0)
case "$n" in ''|*[!0-9]*) n=0 ;; esac
n=$((n + 1))
echo "$n" > "$CNT"

if [ "$n" -ge "$MAX" ]; then
  rm -f "$CNT"
  printf '{"systemMessage":"verify-guard: %d회 검증을 요구했으나 미수행 — 무한루프 방지로 이번엔 통과시킵니다. src가 실제로 검증됐는지 수동 확인하세요."}' "$n"
  exit 0
fi

printf '{"decision":"block","reason":"src/src-tauri를 수정한 뒤 런타임 검증을 하지 않았습니다. 보고하기 전에 Playwright MCP(browser_navigate/snapshot/take_screenshot)로 실제 화면을 확인하거나, 앱을 실행(pnpm tauri dev / pnpm dev / pnpm preview)해서 동작을 검증하세요. 검증 명령을 실행하면 이 차단은 자동으로 풀립니다. (vitest는 런타임 검증으로 인정되지 않음)"}'
exit 0

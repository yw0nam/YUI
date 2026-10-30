#!/usr/bin/env bash
# rust-lines.sh <file.rs>...: prints code and test line counts per file, split at the first `#[cfg(test)]`.
for f in "$@"; do
  awk -v f="$f" '/^#\[cfg\(test\)\]/ && !t { t = NR } END { c = t ? t - 1 : NR; printf "%s code %d test %d\n", f, c, NR - c }' "$f"
done

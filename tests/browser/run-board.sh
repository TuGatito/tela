#!/usr/bin/env bash
# Browser regression for tela 0.2: data-tela-if + data-tela-each + delegation.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
example="$repo/examples/board"
pengu="${PENGU_HOME:-$(cd "$repo/../PenguScript" && pwd)}"
export PENGU_HOME="$pengu"

cd "$example"
backup="$example/pengu.toml.bak"
cp pengu.toml "$backup"
restore_manifest() { mv "$backup" "$example/pengu.toml"; }
trap 'restore_manifest' EXIT
psc add ../.. --trust --rebuild >/dev/null
python3 - "$here/probe.js" > build/probe-shell.html <<'PY'
import sys
probe = open(sys.argv[1]).read()
shell = open('shell.html').read()
shell = shell.replace('</body>', '<script>\n' + probe + '\n</script></body>')
sys.stdout.write(shell)
PY
PENGU_WASM_SHELL="$example/build/probe-shell.html" psc build --target wasm --out build/probe >/dev/null

cd build
python3 -m http.server 8778 >/tmp/tela-board-server.log 2>&1 &
server=$!
trap 'kill "$server" 2>/dev/null || true; restore_manifest' EXIT
sleep 1
dom="$(chromium --headless --no-sandbox --disable-gpu --virtual-time-budget=8000 --dump-dom http://127.0.0.1:8778/probe.html 2>/dev/null)"
echo "$dom" | grep -F '"items":2' >/dev/null
echo "$dom" | grep -F '"count":"2"' >/dev/null
echo "$dom" | grep -F '"empty":false' >/dev/null
echo "$dom" | grep -F '"done":"done"' >/dev/null
echo "OK tela browser: if + each + delegation"

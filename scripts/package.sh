#!/usr/bin/env bash
# Gera dist/couchport-<versão>.zip a partir de extension/
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VER="$(python3 -c "import json;print(json.load(open('$ROOT/extension/manifest.json'))['version'])")"
mkdir -p "$ROOT/dist"
OUT="$ROOT/dist/couchport-$VER.zip"
rm -f "$OUT"
(cd "$ROOT/extension" && zip -qr -X "$OUT" . -x '.*')
echo "$OUT"

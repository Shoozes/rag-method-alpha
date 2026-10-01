#!/usr/bin/env sh
set -eu
RAG_APP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$RAG_APP_ROOT/run.mjs" "$@"

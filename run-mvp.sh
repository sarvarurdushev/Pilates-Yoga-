#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
PYTHON_BIN="${PILATES_PYTHON:-python3}"
export PILATES_REQUIRE_AUTH=0
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$PWD/.cache}"
if [ -f "$PWD/models/pose_landmarker_full.task" ]; then
  export PILATES_3D_MODEL="$PWD/models/pose_landmarker_full.task"
fi
mkdir -p .local
exec "$PYTHON_BIN" -m pilates web --db "$PWD/.local/assessments.db" --host 127.0.0.1 --port "${PORT:-8000}"

#!/bin/sh
set -eu

# A paid Render service can point this at a mounted disk. The legacy free
# service keeps its existing /tmp path until a durable location is configured.
db_path=${STUDIO_DB_PATH:-/tmp/studio.db}
exec python -m pilates web --host 0.0.0.0 --db "$db_path"

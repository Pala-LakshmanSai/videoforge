#!/bin/sh
set -eu
printf '%s\n' '{"event":"avatar_primary_entrypoint_start"}'
if [ "${VIDEOFORGE_POD_RUNNER:-0}" = "1" ]; then
  exec python -u /opt/videoforge/pod_runner.py
fi
exec python -u /opt/videoforge/handler.py

#!/bin/sh
set -eu
printf '%s\n' '{"event":"avatar_primary_entrypoint_start"}'
exec python -u /opt/videoforge/handler.py

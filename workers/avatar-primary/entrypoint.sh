#!/bin/sh
set -eu
python /opt/videoforge/bootstrap_models.py
exec python /opt/videoforge/handler.py

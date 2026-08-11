#!/bin/sh
set -eu
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
exec python /opt/videoforge/mage_handler.py

#!/bin/bash
set -euo pipefail
umask 077
if [ "$(uname -s)" != Darwin ]; then echo 'This command requires macOS. Choose Windows in VideoForge Settings.' >&2; exit 1; fi
work=$(mktemp -d)
mounted=0
cleanup() { if [ "$mounted" = 1 ]; then hdiutil detach "$work/mount" >/dev/null 2>&1 || true; fi; rm -rf "$work"; }
trap cleanup EXIT
target="$HOME/Applications/VideoForge Worker.app"
executable="$target/Contents/MacOS/VideoForge Worker"
service="gui/$(id -u)/com.videoforge.personal-media-worker"
printf '%s' '@@TOKEN@@' > "$work/connect-token"
# Verify account ownership without replacing or restarting an active worker.
if pgrep -f "^$executable" >/dev/null; then
  echo 'Checking the running VideoForge Worker…'
  if ! "$executable" --connect-file "$work/connect-token"; then
    echo 'Connection was not changed. Check the account in Settings and copy a fresh command. If an update is required, let current work finish and reopen the worker.' >&2; exit 1
  fi
  echo 'Connected. Your existing worker is running; current work was preserved.'
  exit 0
fi
echo 'Downloading VideoForge Worker @@VERSION@@…'
curl --fail --location --proto '=https' --tlsv1.2 --retry 2 --connect-timeout 30 '@@URL@@' -o "$work/worker.dmg"
test "$(stat -f %z "$work/worker.dmg")" = '@@SIZE@@'
test "$(shasum -a 256 "$work/worker.dmg" | cut -d ' ' -f 1)" = '@@HASH@@'
hdiutil verify "$work/worker.dmg" >/dev/null
mkdir "$work/mount"
hdiutil attach -nobrowse -readonly -mountpoint "$work/mount" "$work/worker.dmg" >/dev/null
mounted=1
codesign --verify --deep --strict "$work/mount/VideoForge Worker.app"
mkdir -p "$HOME/Applications"
ditto "$work/mount/VideoForge Worker.app" "$work/new.app"
codesign --verify --deep --strict "$work/new.app"
if [ -d "$target" ]; then mv "$target" "$work/previous.app"; fi
mv "$work/new.app" "$target"
if ! "$executable" --connect-file "$work/connect-token"; then
  echo 'Connection failed. Get a fresh command from VideoForge Settings and try again.' >&2; exit 1
fi
launchctl kickstart "$service"
echo 'Connected. VideoForge Worker starts at login and runs in the background.'

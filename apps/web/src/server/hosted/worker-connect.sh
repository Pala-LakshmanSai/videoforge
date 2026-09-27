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
installed_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$target/Contents/Info.plist" 2>/dev/null || true)
state="$HOME/Library/Application Support/VideoForge Worker/installation.json"
# Native macOS tools avoid unpacking the large worker just to check its account.
if [ -x "$executable" ] && [ -f "$state" ]; then
  installation=$(/usr/bin/plutil -extract installation_id raw -o - "$state")
  if /usr/bin/security find-generic-password -w -s com.videoforge.personal-media-worker -a "$installation" > "$work/credential" 2>/dev/null; then
    printf 'Authorization: Bearer %s\n' "$(cat "$work/credential")" > "$work/headers"
    rm -f "$work/credential"
    running=false
    if pgrep -f "^$executable" >/dev/null; then running=true; fi
    echo 'Connecting this Mac…'
    while true; do
      printf '{"token":"%s","running":%s,"installed_version":"%s"}' "$(cat "$work/connect-token")" "$running" "$installed_version" > "$work/request"
      status=$(curl -sS --proto '=https' --connect-timeout 15 --max-time 45 -X POST \
        -H @"$work/headers" -H 'Content-Type: application/json' --data-binary @"$work/request" \
        '@@ORIGIN@@/api/v2/media-worker/connect-prepare' -o "$work/response" -w '%{http_code}')
      rm -f "$work/request"
      if [ "$status" != 200 ]; then
        code=$(/usr/bin/plutil -extract error.code raw -o - "$work/response" 2>/dev/null || true)
        if [ "$code" = MEDIA_WORKER_BUSY ]; then
          echo 'This Mac is working. Let it finish, then copy a fresh command to switch accounts.' >&2
        else
          echo 'Connection could not be verified. Refresh the command in Settings and try again.' >&2
        fi
        exit 1
      fi
      action=$(/usr/bin/plutil -extract action raw -o - "$work/response")
      if [ "$action" = CONNECTED ]; then
        echo 'VideoForge Worker @@VERSION@@ is connected and Online.'
        exit 0
      fi
      /usr/bin/plutil -extract token raw -o "$work/connect-token" "$work/response"
      if [ "$action" != WAIT ]; then break; fi
      echo 'Waiting for current work to finish; setup will continue automatically…'
      sleep 10
    done
    rm -f "$work/headers"
    if [ "$action" = SWITCH ] || [ "$action" = UPGRADE ]; then
      echo 'Preparing the idle worker for the latest version…'
      launchctl bootout "$service" >/dev/null 2>&1 || true
      # The server verified zero leases; old bundles cannot claim new work.
      # Stop only this installation, including a manually launched copy.
      pids=$(pgrep -f "^$executable" || true)
      if [ -n "$pids" ]; then kill $pids 2>/dev/null || true; fi
      for attempt in {1..15}; do
        if ! pgrep -f "^$executable" >/dev/null; then break; fi
        sleep 1
      done
      if pgrep -f "^$executable" >/dev/null; then
        echo 'Close VideoForge Worker, then paste a fresh command to finish reconnecting.' >&2; exit 1
      fi
      if [ "$action" = SWITCH ]; then
        /usr/bin/security delete-generic-password -s com.videoforge.personal-media-worker -a "$installation" >/dev/null 2>&1 || true
        rm -f "$state"
      fi
    fi
  elif [ "$(/usr/bin/plutil -extract revoked raw -o - "$state" 2>/dev/null || true)" = true ]; then
    if pgrep -f "^$executable" >/dev/null; then
      echo 'Close VideoForge Worker, then paste a fresh command to finish reconnecting.' >&2; exit 1
    fi
    rm -f "$state"
  fi
fi
# Reuse the installed current version even when it was stopped or just switched accounts.
installed_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$target/Contents/Info.plist" 2>/dev/null || true)
if [ -x "$executable" ] && [ "$installed_version" = '@@VERSION@@' ]; then
  echo 'Starting VideoForge Worker…'
  "$executable" --connect-file "$work/connect-token"
  launchctl kickstart "$service"
  echo 'VideoForge Worker @@VERSION@@ is connected and Online.'
  exit 0
fi
# No credential means we cannot prove a running installation is idle.
if pgrep -f "^$executable" >/dev/null; then
  echo 'Let current work finish, close VideoForge Worker, then paste a fresh command to update.' >&2
  exit 1
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
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$work/new.app/Contents/Info.plist")" = '@@VERSION@@'
if [ -d "$target" ]; then mv "$target" "$work/previous.app"; fi
mv "$work/new.app" "$target"
if ! "$executable" --connect-file "$work/connect-token"; then
  echo 'Connection failed. Get a fresh command from VideoForge Settings and try again.' >&2; exit 1
fi
launchctl kickstart "$service"
echo 'VideoForge Worker @@VERSION@@ is connected and Online. It starts at login.'

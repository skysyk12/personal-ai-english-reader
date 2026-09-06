#!/bin/zsh

set -u

SCRIPT_PATH="${0:A}"
PROJECT_DIR="${SCRIPT_PATH:h:h}"
PORT="8190"
BASE_URL="http://127.0.0.1:${PORT}"
LABEL="com.sunyongkang.margin-reader"
USER_DOMAIN="gui/$(id -u)"
JOB_TARGET="${USER_DOMAIN}/${LABEL}"
CLOSE_BROWSER="1"

if [[ "${1:-}" == "--keep-browser" ]]; then
  CLOSE_BROWSER="0"
fi

process_belongs_to_reader() {
  local process_id="$1"
  local process_directory
  process_directory="$(lsof -a -p "$process_id" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
  [[ "$process_directory" == "$PROJECT_DIR" ]]
}

launchctl bootout "$JOB_TARGET" >/dev/null 2>&1 || true

for attempt in {1..30}; do
  listener_pid="$(lsof -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1)"
  [[ -z "$listener_pid" ]] && break
  sleep 0.1
done

while IFS= read -r listener_pid; do
  if [[ -n "$listener_pid" ]] && process_belongs_to_reader "$listener_pid"; then
    kill -TERM "$listener_pid" 2>/dev/null || true
  fi
done < <(lsof -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null)

if [[ "$CLOSE_BROWSER" == "1" ]] && pgrep -x "Google Chrome" >/dev/null 2>&1; then
  osascript - "$BASE_URL" <<'APPLESCRIPT' >/dev/null 2>&1 || true
on run argv
  set targetURL to item 1 of argv
  tell application "Google Chrome"
    repeat with windowIndex from (count of windows) to 1 by -1
      set browserWindow to window windowIndex
      repeat with tabIndex from (count of tabs of browserWindow) to 1 by -1
        set browserTab to tab tabIndex of browserWindow
        if (URL of browserTab starts with targetURL) then
          close browserTab
        end if
      end repeat
    end repeat
  end tell
end run
APPLESCRIPT
fi

exit 0

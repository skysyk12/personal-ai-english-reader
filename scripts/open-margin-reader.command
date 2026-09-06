#!/bin/zsh

set -u

SCRIPT_PATH="${0:A}"
PROJECT_DIR="${SCRIPT_PATH:h:h}"
PORT="8190"
URL="http://127.0.0.1:${PORT}/library"
LABEL="com.sunyongkang.margin-reader"
USER_DOMAIN="gui/$(id -u)"
JOB_TARGET="${USER_DOMAIN}/${LABEL}"
PLIST_SOURCE="${PROJECT_DIR}/scripts/${LABEL}.plist"
PLIST_TARGET="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG_FILE="/tmp/margin-reader-${PORT}.log"
ERROR_LOG_FILE="/tmp/margin-reader-${PORT}.error.log"
OPEN_BROWSER="1"
NPM_PATH="$(command -v npm 2>/dev/null || true)"

if [[ "${1:-}" == "--no-browser" ]]; then
  OPEN_BROWSER="0"
fi

process_belongs_to_reader() {
  local process_id="$1"
  local process_directory
  process_directory="$(lsof -a -p "$process_id" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
  [[ "$process_directory" == "$PROJECT_DIR" ]]
}

show_message() {
  local message="$1"
  osascript -e "display dialog \"${message}\" buttons {\"好\"} default button \"好\" with title \"Margin Reader\"" >/dev/null 2>&1 || true
}

open_in_chrome() {
  if [[ "$OPEN_BROWSER" != "1" ]]; then
    return
  fi
  if [[ -d "/Applications/Google Chrome.app" ]]; then
    osascript - "$URL" <<'APPLESCRIPT' >/dev/null 2>&1
on run argv
  set targetURL to item 1 of argv
  tell application "Google Chrome"
    activate
    repeat with browserWindow in windows
      repeat with tabIndex from 1 to (count of tabs of browserWindow)
        set browserTab to tab tabIndex of browserWindow
        if (URL of browserTab starts with targetURL) then
          set active tab index of browserWindow to tabIndex
          return
        end if
      end repeat
    end repeat
    if (count of windows) is 0 then make new window
    tell window 1
      make new tab with properties {URL:targetURL}
      set active tab index to count of tabs
    end tell
  end tell
end run
APPLESCRIPT
  else
    open "$URL"
  fi
}

listener_pid="$(lsof -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1)"
if [[ -n "$listener_pid" ]]; then
  if process_belongs_to_reader "$listener_pid" && curl -fsS "$URL" >/dev/null 2>&1; then
    open_in_chrome
    exit 0
  fi
  show_message "端口 ${PORT} 已被其他应用占用，Margin Reader 没有启动。"
  exit 1
fi

if [[ -z "$NPM_PATH" ]]; then
  show_message "没有找到 npm。请先安装 Node.js 20 或更高版本。"
  exit 1
fi

mkdir -p "${HOME}/Library/LaunchAgents"
PLIST_CANDIDATE="$(mktemp "/tmp/${LABEL}.XXXXXX.plist")"
trap 'rm -f "$PLIST_CANDIDATE"' EXIT
cp "$PLIST_SOURCE" "$PLIST_CANDIDATE"
/usr/libexec/PlistBuddy -c "Set :ProgramArguments:0 $NPM_PATH" "$PLIST_CANDIDATE" >/dev/null
plutil -replace WorkingDirectory -string "$PROJECT_DIR" "$PLIST_CANDIDATE"
plutil -replace StandardOutPath -string "$LOG_FILE" "$PLIST_CANDIDATE"
plutil -replace StandardErrorPath -string "$ERROR_LOG_FILE" "$PLIST_CANDIDATE"

if ! cmp -s "$PLIST_CANDIDATE" "$PLIST_TARGET"; then
  launchctl bootout "$JOB_TARGET" >/dev/null 2>&1 || true
  cp "$PLIST_CANDIDATE" "$PLIST_TARGET"
  chmod 644 "$PLIST_TARGET"
fi

if launchctl print "$JOB_TARGET" >/dev/null 2>&1; then
  launchctl kickstart -k "$JOB_TARGET" >/dev/null 2>&1
else
  if ! launchctl bootstrap "$USER_DOMAIN" "$PLIST_TARGET" >/dev/null 2>&1; then
    show_message "无法加载 Margin Reader 的后台服务。"
    exit 1
  fi
fi

for attempt in {1..80}; do
  if curl -fsS "$URL" >/dev/null 2>&1; then
    open_in_chrome
    exit 0
  fi
  sleep 0.25
done

show_message "Margin Reader 启动失败。日志位于 ${LOG_FILE}。"
tail -n 20 "$LOG_FILE" 2>/dev/null || true
tail -n 20 "$ERROR_LOG_FILE" 2>/dev/null || true
exit 1

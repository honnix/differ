#!/usr/bin/env zsh
# Start differ detached, with logs at /tmp/differ.log and PID at /tmp/differ.pid.

set -e

cd "$(dirname "$0")"

LOG=/tmp/differ.log
PIDFILE=/tmp/differ.pid

if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "differ already running (pid $(cat "$PIDFILE"))"
  exit 0
fi

nohup zsh -lc "uv run differ $*" > "$LOG" 2>&1 &
echo $! > "$PIDFILE"
disown

echo "differ started (pid $(cat "$PIDFILE"))"
echo "logs: $LOG"
echo "stop: kill \$(cat $PIDFILE)"

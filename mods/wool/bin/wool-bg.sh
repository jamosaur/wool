#!/bin/sh
# wool-bg.sh <stateDir> <n> [--wait] -- command...
# Runs a background command (no pane) with its output in <stateDir>/bg-<n>.log
# and its exit code in <stateDir>/bg-<n>.exit ("skipped" when it waited for a
# setup that failed).
set -u

state=$1
n=$2
shift 2
wait=0
if [ "${1:-}" = "--wait" ]; then wait=1; shift; fi
if [ "${1:-}" = "--" ]; then shift; fi
log="$state/bg-$n.log"
here=$(dirname "$0")

if [ "$wait" -eq 1 ]; then
  sh "$here/wool-wait.sh" "$state" -- "$@" > "$log" 2>&1
  code=$?
  if [ "$(head -n 1 "$state/status" 2>/dev/null)" != ok ]; then code=skipped; fi
else
  "$@" > "$log" 2>&1
  code=$?
fi
printf '%s\n' "$code" > "$state/bg-$n.exit"

#!/bin/zsh
# Cold starts of one installed app, with clean app data every time: half onto
# a file, half bare. Written for a process that once vanished on a first launch
# and never again; see packages/tauri-shared/src/trail.rs for what it leaves.
#
#   scripts/launch/cold-starts.sh Docs ~/Desktop/report.docx [runs]
#
# macOS, and the installed build — `tauri dev` has no file associations. Your
# own app data (autosaves, recovery) is copied aside first and put back after.
set -u
app_name=$1; file=$2; runs=${3:-20}
name="Orangery $app_name"; app="/Applications/$name.app"
data="$HOME/Library/Application Support/com.orangery.${(L)app_name}"
out=$(mktemp -d /tmp/orangery-cold-starts-XXXX); keep=$out/your-app-data
tool=$out/windows
swiftc -O -o $tool "${0:A:h}/windows.swift" 2>/dev/null || { echo "needs swiftc"; exit 1; }

[ -d "$data" ] && cp -R "$data" "$keep"
trap '[ -d "$keep" ] && { rm -rf "$data"; cp -R "$keep" "$data"; }' EXIT

alive() { pgrep -f "$app/Contents/MacOS" | wc -l | tr -d ' '; }
windows() { $tool | grep -c "$name"; }

for n in $(seq 1 $runs); do
  pkill -f "$app/Contents/MacOS"; sleep 0.5; rm -rf "$data"
  if (( n % 2 )); then open -a "$app" "$file"; kind=file; else open -a "$app"; kind=bare; fi
  line="run $n ($kind):"
  sleep 1; line="$line 1s proc=$(alive) win=$(windows)"
  sleep 2; line="$line 3s proc=$(alive) win=$(windows)"
  sleep 3; line="$line 6s proc=$(alive) win=$(windows)"
  # Quit the way a person does, so a clean exit is a clean exit.
  osascript -e "tell application \"$app\" to quit" >/dev/null 2>&1
  for i in $(seq 1 30); do [ "$(alive)" = 0 ] && break; sleep 0.2; done
  [ "$(alive)" != 0 ] && line="$line STILL RUNNING AFTER QUIT"
  mkdir -p $out/$n; cp -R "$data/logs/." $out/$n/ 2>/dev/null
  log=$out/$n/launch.log
  echo "$line | $(grep -o 'claimed [0-9]* file' $log 2>/dev/null | head -1)" \
    "| clean exit: $(grep -c 'clean exit' $log 2>/dev/null)" \
    "| marker: $([ -f $out/$n/running ] && echo LEFT BEHIND || echo gone)" \
    "| crash logs: $(find $out/$n -name 'crash-*.log' | wc -l | tr -d ' ')"
done
echo "logs: $out"

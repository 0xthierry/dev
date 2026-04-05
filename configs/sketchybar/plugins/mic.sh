#!/bin/bash
MIC_VOLUME="$(osascript -e 'input volume of (get volume settings)')"

if [ "$MIC_VOLUME" -eq 0 ] 2>/dev/null; then
  sketchybar --set "$NAME" icon="󰍭"
else
  sketchybar --set "$NAME" icon="󰍬"
fi

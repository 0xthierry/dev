#!/bin/bash
SSID="$(/System/Library/PrivateFrameworks/Apple80211.framework/Resources/airport -I | awk -F': ' '/ SSID/{print $2}')"

if [ -z "$SSID" ]; then
  sketchybar --set "$NAME" icon="󰤭" label="Off"
else
  sketchybar --set "$NAME" icon="󰤨" label="$SSID"
fi

#!/bin/bash

BATT_INFO="$(pmset -g batt)"
PERCENTAGE="$(echo "$BATT_INFO" | grep -Eo "\d+%" | cut -d% -f1)"
CHARGING="$(echo "$BATT_INFO" | grep 'AC Power')"
REMAINING="$(echo "$BATT_INFO" | grep -Eo "\d+:\d+" | head -1)"
SOURCE="$(echo "$BATT_INFO" | head -1 | sed "s/.*'\(.*\)'/\1/")"
CONDITION="$(echo "$BATT_INFO" | grep -Eo "condition: \w+" | cut -d' ' -f2)"

if [ -z "$PERCENTAGE" ]; then
  sketchybar --set "$NAME" drawing=off
  exit 0
fi

# Icon based on level and charging state
if [ -n "$CHARGING" ]; then
  ICON="󰂄"
elif [ "$PERCENTAGE" -gt 80 ]; then
  ICON="󰁹"
elif [ "$PERCENTAGE" -gt 60 ]; then
  ICON="󰂀"
elif [ "$PERCENTAGE" -gt 40 ]; then
  ICON="󰁾"
elif [ "$PERCENTAGE" -gt 20 ]; then
  ICON="󰁼"
else
  ICON="󰁺"
fi

sketchybar --set "$NAME" icon="$ICON" label="${PERCENTAGE}%"

# Hover popup details
case "$SENDER" in
  mouse.entered)
    DETAIL="${PERCENTAGE}%"
    [ -n "$REMAINING" ] && DETAIL="$DETAIL  ·  ${REMAINING} remaining"
    [ -n "$SOURCE" ] && DETAIL="$DETAIL  ·  ${SOURCE}"
    [ -n "$CONDITION" ] && DETAIL="$DETAIL  ·  ${CONDITION}"

    sketchybar --set battery.details label="$DETAIL"
    sketchybar --set "$NAME" popup.drawing=on
    ;;
  mouse.exited)
    sketchybar --set "$NAME" popup.drawing=off
    ;;
esac

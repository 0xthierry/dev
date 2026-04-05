#!/bin/bash

NORD9="0xff81a1c1"
NORD4="0xffd8dee9"
NORD3="0xff4c566a"

# On first render FOCUSED_WORKSPACE may be unset — query AeroSpace directly
FOCUSED="${FOCUSED_WORKSPACE:-$(aerospace list-workspaces --focused 2>/dev/null)}"

if [ "$1" = "$FOCUSED" ]; then
  sketchybar --set "$NAME" \
    background.drawing=on \
    background.color="$NORD9" \
    label.color="$NORD4"
else
  sketchybar --set "$NAME" \
    background.drawing=off \
    label.color="$NORD3"
fi

#!/bin/bash
CPU="$(top -l 1 -n 0 | grep "CPU usage" | awk '{print int($3 + $5)}')"
MEM="$(memory_pressure | grep "System-wide memory free percentage:" | awk '{print 100 - $5}' | tr -d '%')"

if [ -z "$MEM" ]; then
  MEM="$(top -l 1 -n 0 | grep "PhysMem" | awk '{print int($2)}')"
  sketchybar --set "$NAME" label="C:${CPU}%  M:${MEM}G"
else
  sketchybar --set "$NAME" label="C:${CPU}%  M:${MEM}%"
fi

#!/bin/bash
MIC_VOLUME="$(osascript -e 'input volume of (get volume settings)')"

if [ "$MIC_VOLUME" -eq 0 ] 2>/dev/null; then
  osascript -e 'set volume input volume 75'
else
  osascript -e 'set volume input volume 0'
fi

#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage:
  crop-screenshot.sh <input> <output> <width> <height> <x> <y>

Example:
  crop-screenshot.sh full.png crop.png 610 430 500 215
USAGE
}

if [ "$#" -ne 6 ]; then
  usage
  exit 2
fi

input="$1"
output="$2"
width="$3"
height="$4"
x="$5"
y="$6"

if [ ! -f "$input" ]; then
  echo "Input file not found: $input" >&2
  exit 1
fi

case "$width:$height:$x:$y" in
  *[!0-9:]* | *::* | :* | *:)
    echo "width, height, x, and y must be non-negative integers" >&2
    exit 2
    ;;
esac

mkdir -p "$(dirname "$output")"

if command -v magick >/dev/null 2>&1; then
  magick "$input" -crop "${width}x${height}+${x}+${y}" +repage "$output"
elif command -v convert >/dev/null 2>&1; then
  convert "$input" -crop "${width}x${height}+${x}+${y}" +repage "$output"
elif command -v ffmpeg >/dev/null 2>&1; then
  ffmpeg -y -i "$input" -vf "crop=${width}:${height}:${x}:${y}" "$output" >/dev/null 2>&1
else
  echo "No crop tool found. Install ImageMagick (magick/convert) or ffmpeg." >&2
  exit 1
fi

if [ ! -s "$output" ]; then
  echo "Crop did not produce an output file: $output" >&2
  exit 1
fi

file "$output"

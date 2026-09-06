#!/usr/bin/env bash
# Turn the recordings into files GitHub and YouTube can play (#1039).
#
#   bash docs/walkthroughs/render.sh docs/walkthroughs/out
#
# Terminal casts -> GIF with agg -> WebM with ffmpeg; browser WebMs are
# re-encoded to the same size so the two halves of each walkthrough can be
# joined. ffmpeg runs inside the worker image, which ships it, so nothing
# needs installing on the host beyond asciinema and agg.
set -euo pipefail
OUT="${1:?output directory holding *.cast and *-browser.webm}"
OUT="$(cd "$OUT" && pwd)"
IMG="${FFMPEG_IMAGE:-ghcr.io/brlauuu/podlog-worker:stable}"
ff() { docker run --rm -v "$OUT:/w" -w /w --entrypoint ffmpeg "$IMG" -loglevel error -y "$@"; }

for cast in "$OUT"/*.cast; do
  [ -e "$cast" ] || continue
  name="$(basename "$cast" .cast)"
  echo "== $name: cast -> gif -> webm"
  agg --cols 110 --rows 32 --font-size 16 --speed 1 "$cast" "$OUT/$name.gif"
  # Fit inside 1280x800 first (the GIF is taller than it is wide-ish), then pad;
  # VP9 wants yuv420p, the GIF decodes to bgra.
  ff -i "$name.gif" \
     -vf "scale=1280:800:force_original_aspect_ratio=decrease:flags=lanczos,pad=1280:800:-1:-1:color=0x111111,fps=15,format=yuv420p" \
     -c:v libvpx-vp9 -b:v 0 -crf 34 -an "$name-terminal.webm"
  rm -f "$OUT/$name.gif"
done

for b in "$OUT"/*-browser.webm; do
  [ -e "$b" ] || continue
  name="$(basename "$b" -browser.webm)"
  echo "== $name: browser -> normalised webm"
  ff -i "$name-browser.webm" -vf "scale=1280:800,fps=15,format=yuv420p" -c:v libvpx-vp9 -b:v 0 -crf 34 -an "$name-browser-norm.webm"
  if [ -e "$OUT/$name-terminal.webm" ]; then
    printf "file '%s'\nfile '%s'\n" "$name-terminal.webm" "$name-browser-norm.webm" > "$OUT/$name-list.txt"
    ff -f concat -safe 0 -i "$name-list.txt" -c copy "$name.webm"
    rm -f "$OUT/$name-list.txt"
    echo "   -> $name.webm"
  fi
done
ls -la "$OUT"

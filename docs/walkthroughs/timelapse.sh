#!/usr/bin/env bash
# Speed up the middle of a browser capture (the queue-watching stretch) and
# optionally append a re-take at the end (#1039).
#
#   bash docs/walkthroughs/timelapse.sh in.webm out.webm KEEP_UNTIL FAST_UNTIL [FACTOR] [CUT_AT] [APPEND.webm]
#
#   0..KEEP_UNTIL     normal speed
#   KEEP_UNTIL..FAST_UNTIL   FACTOR x faster (default 30)
#   FAST_UNTIL..CUT_AT       normal speed (CUT_AT defaults to the end)
#   then APPEND.webm, if given, at normal speed
set -euo pipefail
IN="$1"; OUT="$2"; A="$3"; B="$4"; F="${5:-30}"; C="${6:-}"; APP="${7:-}"
dir="$(cd "$(dirname "$IN")" && pwd)"
IMG="${FFMPEG_IMAGE:-ghcr.io/brlauuu/podlog-worker:stable}"
ff() { docker run --rm -v "$dir:/w" -w /w --entrypoint ffmpeg "$IMG" -loglevel error -y "$@"; }
in_name="$(basename "$IN")"; out_name="$(basename "$OUT")"
inputs=(-i "$in_name")
tail_expr="trim=start=$B${C:+:end=$C},setpts=PTS-STARTPTS[c]"
concat_in="[a][b][c]"; n=3
if [ -n "$APP" ]; then
  inputs+=(-i "$(basename "$APP")")
  concat_in="[a][b][c][1:v]"; n=4
fi
ff "${inputs[@]}" -filter_complex \
  "[0:v]trim=end=$A,setpts=PTS-STARTPTS[a];
   [0:v]trim=start=$A:end=$B,setpts=(PTS-STARTPTS)/$F[b];
   [0:v]$tail_expr;
   ${concat_in}concat=n=$n:v=1:a=0,scale=1280:800,fps=15,format=yuv420p[v]" \
  -map "[v]" -c:v libvpx-vp9 -b:v 0 -crf 34 -an "$out_name"
echo "wrote $OUT"

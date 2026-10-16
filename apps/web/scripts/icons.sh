#!/bin/sh
# Regenerates the PNG app icons from public/icons/*.svg with headless Chrome. Run from anywhere: sh scripts/icons.sh
set -e
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
render() { # <svg> <size> <out.png>
  tmp=$(mktemp -d)
  printf '<html><body style="margin:0;background:transparent"><img src="file://%s" width="%s" height="%s" style="display:block"></body></html>' \
    "$PWD/$1" "$2" "$2" > "$tmp/icon.html"
  "$CHROME" --headless --disable-gpu --hide-scrollbars --default-background-color=00000000 \
    --window-size="$2,$2" --screenshot="$PWD/$3" "file://$tmp/icon.html" >/dev/null 2>&1
  rm -rf "$tmp"
}
render public/icons/icon.svg 192 public/icons/icon-192.png
render public/icons/icon.svg 512 public/icons/icon-512.png
render public/icons/maskable.svg 512 public/icons/maskable-512.png
render public/icons/maskable.svg 180 public/icons/apple-touch-icon.png
echo "icons written to public/icons"

#!/usr/bin/env sh
# Build OpenTUI's native library with copane's patch (patches/opentui-native@<version>.patch) and put it
# in place of the prebuilt one in node_modules. Run after `bun install`; it is quick when nothing changed.
# Needs Zig (the version OpenTUI's build.zig.zon asks for) on PATH, or ZIG=/path/to/zig.
# The patch makes Khmer and other letter clusters as wide as Windows Terminal and xterm.js draw them.
set -eu
cd "$(dirname "$0")/.."

VERSION=$(bun -e 'console.log(require("@opentui/core/package.json").version)')
PATCH="patches/opentui-native@$VERSION.patch"
[ -f "$PATCH" ] || {
  echo "no $PATCH: re-create the native patch for OpenTUI $VERSION (see AGENTS.md, OpenTUI upgrades)" >&2
  exit 1
}

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) PLATFORM=linux-x64 TARGET=x86_64-linux-gnu.2.17 LIB=libopentui.so ;;
  Linux-aarch64) PLATFORM=linux-arm64 TARGET=aarch64-linux-gnu.2.17 LIB=libopentui.so ;;
  Darwin-x86_64) PLATFORM=darwin-x64 TARGET=x86_64-macos.13.0 LIB=libopentui.dylib ;;
  Darwin-arm64) PLATFORM=darwin-arm64 TARGET=aarch64-macos.13.0 LIB=libopentui.dylib ;;
  *) echo "opentui-native: no build for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

DEST="node_modules/@opentui/core-$PLATFORM/$LIB"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/copane/opentui-native"
KEY=$(cksum < "$PATCH" | cut -d' ' -f1)
BUILT="$CACHE/$VERSION-$KEY/$PLATFORM/$LIB"

if [ ! -f "$BUILT" ]; then
  ZIG="${ZIG:-zig}"
  SRC="$CACHE/src-$VERSION"
  [ -d "$SRC" ] || git -c advice.detachedHead=false clone --quiet --depth 1 --branch "v$VERSION" https://github.com/anomalyco/opentui.git "$SRC"
  git -C "$SRC" checkout --quiet -- .
  git -C "$SRC" apply "$PWD/$PATCH"
  echo "Building OpenTUI $VERSION native library for $PLATFORM (a few minutes)…"
  (
    cd "$SRC/packages/native"
    sh scripts/prepare-zig-deps.sh
    "$ZIG" build -Doptimize=ReleaseFast -Dlibrary-target="$TARGET"
  )
  OUT=$(find "$SRC/packages/native/lib" -path "*-$(uname -s | tr A-Z a-z | sed s/darwin/macos/)/$LIB" | head -n 1)
  [ -n "$OUT" ] || { echo "opentui-native: the build made no $LIB" >&2; exit 1; }
  mkdir -p "$(dirname "$BUILT")"
  cp "$OUT" "$BUILT.tmp"
  # The build keeps debug symbols (about 5x the size); OpenTUI strips its packaged copy the same way.
  case "$LIB" in
    *.dylib) strip -x "$BUILT.tmp" ;;
    *) strip --strip-unneeded "$BUILT.tmp" ;;
  esac
  mv "$BUILT.tmp" "$BUILT"
fi

if cmp -s "$BUILT" "$DEST"; then
  echo "OpenTUI $VERSION native library: patched"
  exit 0
fi
# bun install hard-links node_modules to its global cache: remove first so the cache copy stays as it was.
rm -f "$DEST"
cp "$BUILT" "$DEST"
echo "OpenTUI $VERSION native library: patched ($PLATFORM)"

#!/usr/bin/env sh
# Install copane from a GitHub release (no Bun needed):
#   curl -fsSL https://raw.githubusercontent.com/sevheng/copane/main/install.sh | sh
# VERSION=v0.1.0 pins a release (default: latest). PREFIX defaults to ~/.local:
#   $PREFIX/lib/copane/copane   the binary
#   $PREFIX/bin/copane          launcher that restarts the editor after an update
# ALIAS adds a short command (default `ce`; ALIAS= to skip). FONT=0 skips the bundled Nerd Font and the terminal setup.
# Update later with `copane --upgrade` (or run this again); open editors offer a restart.
set -eu
REPO="sevheng/copane"
PREFIX="${PREFIX:-$HOME/.local}"
ALIAS="${ALIAS-ce}"
VERSION="${VERSION:-latest}"
BIN="$PREFIX/lib/copane/copane"
LAUNCHER="$PREFIX/bin/copane"

fail() { echo "copane install: $*" >&2; exit 1; }

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) fail "unsupported OS $(uname -s) (Linux and macOS only; on Windows use WSL)" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) fail "unsupported CPU $(uname -m)" ;;
esac
asset="copane-$os-$arch.tar.gz"
if [ "$VERSION" = latest ]; then
  base="https://github.com/$REPO/releases/latest/download"
else
  base="https://github.com/$REPO/releases/download/$VERSION"
fi
base="${COPANE_DOWNLOAD_URL:-$base}" # tests: a folder of release files, as file:///...

if command -v curl >/dev/null 2>&1; then
  get() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  get() { wget -qO "$2" "$1"; }
else
  fail "needs curl or wget"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "Downloading $asset ($VERSION)..."
get "$base/$asset" "$tmp/$asset" || fail "download failed: $base/$asset"
get "$base/SHA256SUMS" "$tmp/SHA256SUMS" || fail "download failed: $base/SHA256SUMS"

expected="$(grep " $asset\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$asset" | cut -d' ' -f1)"
else
  actual="$(shasum -a 256 "$tmp/$asset" | cut -d' ' -f1)"
fi
[ -n "$expected" ] && [ "$expected" = "$actual" ] || fail "checksum mismatch for $asset"

tar -xzf "$tmp/$asset" -C "$tmp"
mkdir -p "$PREFIX/bin" "$(dirname "$BIN")"
# Replace by rename: running editors keep their old file and see one clean change.
install -m 755 "$tmp/copane/copane" "$BIN.new"
mv -f "$BIN.new" "$BIN"

cat > "$LAUNCHER.new" <<EOF
#!/bin/sh
# copane launcher (written by install.sh).
# The editor exits with code 75 to ask for a restart, e.g. after a new version is installed.
export CE_SUPERVISOR_PID=\$\$
while :; do
  "$BIN" "\$@"
  code=\$?
  [ "\$code" -eq 75 ] || exit "\$code"
done
EOF
chmod 755 "$LAUNCHER.new"
mv -f "$LAUNCHER.new" "$LAUNCHER"
echo "Installed $("$BIN" --version) to $LAUNCHER"

if [ -n "$ALIAS" ]; then
  target="$PREFIX/bin/$ALIAS"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "Skipped alias: $target exists and is not a link."
  else
    ln -sf copane "$target"
    echo "Linked $target -> copane"
  fi
fi

case ":$PATH:" in
  *":$PREFIX/bin:"*) ;;
  *)
    echo "Note: $PREFIX/bin is not on your PATH. Add this line to ~/.zshrc or ~/.bashrc, then open a new shell:"
    echo "  export PATH=\"$PREFIX/bin:\$PATH\"" ;;
esac
# Install the bundled Nerd Font and point the terminals at it (FONT=0 skips).
if [ "${FONT-1}" != 0 ]; then
  "$BIN" --install-font || echo "Icons: font setup skipped"
fi

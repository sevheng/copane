#!/usr/bin/env sh
# Build the standalone binary and install it as `copane`.
# PREFIX defaults to ~/.local:
#   $PREFIX/lib/copane/copane   the binary
#   $PREFIX/bin/copane                  launcher that restarts the editor after an update
# ALIAS adds a short command like VS Code's `code` (default `ce`; ALIAS= to skip).
# FONT=0 skips installing the bundled Nerd Font (used for file-tree icons) and the terminal setup; FONT=force redoes it
# (otherwise a finished setup is remembered and skipped).
set -eu
cd "$(dirname "$0")/.."
PREFIX="${PREFIX:-$HOME/.local}"
ALIAS="${ALIAS-ce}"
BIN="$PREFIX/lib/copane/copane"
LAUNCHER="$PREFIX/bin/copane"

bun install --frozen-lockfile
sh scripts/opentui-native.sh
bun run build
mkdir -p "$PREFIX/bin" "$(dirname "$BIN")"

# Replace by rename: running editors keep their old file and see one clean change.
install -m 755 dist/copane "$BIN.new"
mv -f "$BIN.new" "$BIN"

cat > "$LAUNCHER.new" <<EOF
#!/bin/sh
# copane launcher (written by scripts/install.sh).
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
echo "Installed $LAUNCHER (binary: $BIN)"

if [ -n "$ALIAS" ]; then
  target="$PREFIX/bin/$ALIAS"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "Skipped alias: $target exists and is not a link."
  else
    ln -sf copane "$target"
    echo "Linked $target -> copane"
  fi
fi
# Install the bundled Nerd Font and point the terminals at it (FONT=0 skips).
if [ "${FONT-1}" != 0 ]; then
  "$BIN" --install-font || echo "Icons: font setup skipped"
fi

case ":$PATH:" in
  *":$PREFIX/bin:"*) ;;
  *)
    echo "Note: $PREFIX/bin is not on your PATH. Add this line to ~/.zshrc or ~/.bashrc, then open a new shell:"
    echo "  export PATH=\"$PREFIX/bin:\$PATH\"" ;;
esac

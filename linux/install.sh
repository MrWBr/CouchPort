#!/usr/bin/env bash
# Instala o lançador do Couchport no menu de aplicativos (Linux).
# A extensão em si é carregada no navegador — veja o README.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_DIR="$HOME/.local/bin"
APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor/128x128/apps"
CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/couchport"

mkdir -p "$BIN_DIR" "$APPS" "$ICONS" "$CONF_DIR"
install -m 755 "$HERE/couchport" "$BIN_DIR/couchport"
install -m 644 "$HERE/../extension/icons/128.png" "$ICONS/couchport.png"
[ -f "$CONF_DIR/launcher.conf" ] || install -m 644 "$HERE/launcher.conf.example" "$CONF_DIR/launcher.conf"

cat > "$APPS/couchport.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=Couchport
GenericName=Jogos no navegador
Comment=Menu estilo console para jogos de navegador e webports
Exec=$BIN_DIR/couchport %U
Icon=couchport
Terminal=false
Categories=Game;
Keywords=games;jogos;webport;console;gamepad;
StartupNotify=true
DESK
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" >/dev/null 2>&1 || true

echo "✓ Lançador instalado: $BIN_DIR/couchport"
echo "  Configuração: $CONF_DIR/launcher.conf"
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) echo "  (adicione $BIN_DIR ao PATH para rodar 'couchport' no terminal)";; esac

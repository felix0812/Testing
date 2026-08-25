#!/usr/bin/env bash
#
# Entfernt Autostart und automatische Updates wieder.
# Autodarts Desktop selbst bleibt installiert.
#
#   sudo ./uninstall.sh [benutzername]

set -euo pipefail

info() { echo "  $*"; }
step() { echo; echo "==> $*"; }
die()  { echo "FEHLER: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Bitte mit sudo starten:  sudo ./uninstall.sh"

TARGET_USER="${1:-${SUDO_USER:-}}"
[ -n "$TARGET_USER" ] && [ "$TARGET_USER" != root ] \
    || die "Kein Benutzer erkannt. Bitte angeben:  sudo ./uninstall.sh <benutzername>"
id "$TARGET_USER" >/dev/null 2>&1 || die "Benutzer '$TARGET_USER' existiert nicht."

USER_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
USER_UID="$(id -u "$TARGET_USER")"

step "Update-Timer entfernen"
systemctl disable --now autodarts-update.timer >/dev/null 2>&1 || true
rm -f /etc/systemd/system/autodarts-update.timer \
      /etc/systemd/system/autodarts-update.service \
      /usr/local/bin/autodarts-update.sh
systemctl daemon-reload
info "Entfernt."

step "Autostart-Dienst entfernen"
sudo -u "$TARGET_USER" \
    XDG_RUNTIME_DIR="/run/user/$USER_UID" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$USER_UID/bus" \
    systemctl --user disable --now autodarts-desktop.service >/dev/null 2>&1 || true
rm -f "$USER_HOME/.config/systemd/user/autodarts-desktop.service" \
      "$USER_HOME/.config/systemd/user/graphical-session.target.wants/autodarts-desktop.service"
info "Entfernt."

step "Frueher beiseite gelegte Autostart-Eintraege"
AUTOSTART_DIR="$USER_HOME/.config/autostart"
found=0
if [ -d "$AUTOSTART_DIR" ]; then
    for f in "$AUTOSTART_DIR"/*.deaktiviert-von-install; do
        [ -e "$f" ] || continue
        info "Noch vorhanden: $(basename "$f")"
        info "  Zurueckholen mit:  mv '$f' '${f%.deaktiviert-von-install}'"
        found=1
    done
fi
[ "$found" -eq 0 ] && info "Keine vorhanden."

echo
echo "Fertig. Autodarts Desktop selbst ist weiterhin installiert."
echo

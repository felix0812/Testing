#!/usr/bin/env bash
#
# Richtet Autostart und automatische Updates fuer Autodarts Desktop ein.
#
#   sudo ./install.sh            # Benutzer wird aus sudo ermittelt
#   sudo ./install.sh tobi       # Benutzer ausdruecklich angeben
#
# Rueckgaengig machen:  sudo ./uninstall.sh

set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG="autodarts-desktop"

info()  { echo "  $*"; }
step()  { echo; echo "==> $*"; }
warn()  { echo "  ACHTUNG: $*"; }
die()   { echo "FEHLER: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Bitte mit sudo starten:  sudo ./install.sh"

# --- Zielbenutzer bestimmen -------------------------------------------------
TARGET_USER="${1:-${SUDO_USER:-}}"
[ -n "$TARGET_USER" ] && [ "$TARGET_USER" != root ] \
    || die "Kein Benutzer erkannt. Bitte angeben:  sudo ./install.sh <benutzername>"
id "$TARGET_USER" >/dev/null 2>&1 || die "Benutzer '$TARGET_USER' existiert nicht."

USER_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
USER_UID="$(id -u "$TARGET_USER")"
[ -d "$USER_HOME" ] || die "Home-Verzeichnis von $TARGET_USER nicht gefunden."

# --- Voraussetzungen --------------------------------------------------------
step "Voraussetzungen pruefen"
dpkg-query -W -f='${Version}' "$PKG" >/dev/null 2>&1 \
    || die "$PKG ist nicht installiert. Bitte zuerst das .deb installieren."
info "$PKG $(dpkg-query -W -f='${Version}' "$PKG") ist installiert."

EXEC="$(command -v autodarts-desktop || true)"
[ -n "$EXEC" ] || die "Startbefehl 'autodarts-desktop' nicht gefunden."
info "Startbefehl: $EXEC"
info "Benutzer:    $TARGET_USER  (Home: $USER_HOME)"

# --- Update-Skript ----------------------------------------------------------
step "Update-Skript installieren"
install -m 0755 -o root -g root \
    "$SRC/bin/autodarts-update.sh" /usr/local/bin/autodarts-update.sh
info "/usr/local/bin/autodarts-update.sh"

# --- Systemdienste fuer das Update -----------------------------------------
step "Taegliche Update-Pruefung einrichten"
install -m 0644 -o root -g root \
    "$SRC/systemd/autodarts-update.service" /etc/systemd/system/
install -m 0644 -o root -g root \
    "$SRC/systemd/autodarts-update.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now autodarts-update.timer
info "Naechster Lauf: $(systemctl show -P NextElapseUSecRealtime autodarts-update.timer)"

# --- Alte Autostart-Eintraege beiseite legen --------------------------------
# Ein zusaetzlicher Eintrag wuerde eine zweite Instanz starten. Weil Autodarts
# Desktop nur eine Instanz zulaesst, beendet sich dann eine von beiden
# kommentarlos - das sieht aus, als starte das Programm nicht.
step "Alte Autostart-Eintraege pruefen"
AUTOSTART_DIR="$USER_HOME/.config/autostart"
moved=0
if [ -d "$AUTOSTART_DIR" ]; then
    for f in "$AUTOSTART_DIR"/*.desktop; do
        [ -e "$f" ] || continue
        if grep -qi 'autodarts' "$f"; then
            mv "$f" "$f.deaktiviert-von-install"
            info "Beiseite gelegt: $(basename "$f")"
            moved=1
        fi
    done
fi
[ "$moved" -eq 0 ] && info "Keine alten Eintraege gefunden."

# --- Benutzerdienst fuer den Autostart --------------------------------------
step "Autostart als Benutzerdienst einrichten"
UNIT_DIR="$USER_HOME/.config/systemd/user"
install -d -o "$TARGET_USER" -g "$TARGET_USER" "$UNIT_DIR"
sed "s|@EXEC@|$EXEC|" "$SRC/systemd/autodarts-desktop.service" \
    > "$UNIT_DIR/autodarts-desktop.service"
chown "$TARGET_USER:$TARGET_USER" "$UNIT_DIR/autodarts-desktop.service"
chmod 0644 "$UNIT_DIR/autodarts-desktop.service"
info "$UNIT_DIR/autodarts-desktop.service"

# Bevorzugt ueber systemctl aktivieren. Laeuft gerade keine Sitzung des
# Benutzers, wird die Verknuepfung von Hand angelegt - das Ergebnis ist
# dasselbe und greift ab der naechsten Anmeldung.
if sudo -u "$TARGET_USER" \
        XDG_RUNTIME_DIR="/run/user/$USER_UID" \
        DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$USER_UID/bus" \
        systemctl --user enable autodarts-desktop.service >/dev/null 2>&1; then
    info "Dienst aktiviert."
else
    WANTS_DIR="$UNIT_DIR/graphical-session.target.wants"
    install -d -o "$TARGET_USER" -g "$TARGET_USER" "$WANTS_DIR"
    ln -sf ../autodarts-desktop.service "$WANTS_DIR/autodarts-desktop.service"
    chown -h "$TARGET_USER:$TARGET_USER" "$WANTS_DIR/autodarts-desktop.service"
    info "Dienst aktiviert (Verknuepfung von Hand angelegt)."
fi

# --- Automatische Anmeldung pruefen -----------------------------------------
# Ohne automatische Anmeldung bleibt der Rechner im Anmeldebildschirm stehen,
# die grafische Sitzung startet nie - und damit auch der Autostart nicht.
step "Automatische Anmeldung pruefen"
if grep -qs '^ *AutomaticLoginEnable *= *[Tt]rue' /etc/gdm3/custom.conf; then
    info "Automatische Anmeldung ist aktiv."
else
    warn "Automatische Anmeldung ist AUS."
    warn "Der Autostart greift erst nach einer Anmeldung. Fuer einen Kiosk"
    warn "in /etc/gdm3/custom.conf im Abschnitt [daemon] eintragen:"
    warn "    AutomaticLoginEnable=true"
    warn "    AutomaticLogin=$TARGET_USER"
fi

# --- Zusammenfassung --------------------------------------------------------
step "Fertig"
cat <<TEXT

  Eingerichtet:
    - Autostart mit automatischem Neustart nach einem Absturz
    - Taegliche Update-Pruefung um 05:30 Uhr

  Jetzt starten (ohne Neustart):
    systemctl --user start autodarts-desktop

  Status ansehen:
    systemctl --user status autodarts-desktop
    systemctl list-timers autodarts-update.timer

  Update sofort testen:
    sudo /usr/local/bin/autodarts-update.sh

  Protokoll:
    journalctl --user -u autodarts-desktop -n 50
    journalctl -t autodarts-update -n 50

TEXT

#!/usr/bin/env bash
#
# Prueft, ob eine neuere Version von Autodarts Desktop verfuegbar ist,
# und installiert sie. Laeuft als root ueber autodarts-update.timer.
#
# Danach wird eine laufende Instanz beendet. Der Benutzerdienst
# autodarts-desktop.service startet sie automatisch mit der neuen
# Version neu (Restart=always).
#
# Manuell testen:  sudo /usr/local/bin/autodarts-update.sh
# Protokoll:       journalctl -t autodarts-update

set -euo pipefail

PKG="autodarts-desktop"
DOWNLOAD_PAGE="https://autodarts.com/downloads"
PROC_MATCH="/usr/lib/autodarts-desktop/autodarts-desktop"

log() {
    echo "$*"
    logger -t autodarts-update -- "$*" 2>/dev/null || true
}

die() {
    log "FEHLER: $*"
    exit 1
}

[ "$(id -u)" -eq 0 ] || die "Dieses Skript muss als root laufen (sudo)."

# Architektur des Systems bestimmt, welches Paket geladen wird.
arch="$(dpkg --print-architecture)"
case "$arch" in
    amd64|arm64|armhf) ;;
    *) die "Nicht unterstuetzte Architektur: $arch" ;;
esac

installed="$(dpkg-query -W -f='${Version}' "$PKG" 2>/dev/null || true)"
[ -n "$installed" ] || die "$PKG ist nicht installiert."

html="$(curl -fsSL --max-time 60 "$DOWNLOAD_PAGE")" \
    || die "Downloadseite nicht erreichbar - vermutlich kein Netz."

# Die Downloadseite verlinkt die Pakete direkt, inklusive Versionsnummer.
url="$(printf '%s' "$html" \
    | grep -oE "https://get\.autodarts\.com/desktop/linux/[a-z0-9]+/${PKG}_[0-9]+(\.[0-9]+)*_${arch}\.deb" \
    | sort -u | head -n1)"
[ -n "$url" ] || die "Keine Paket-URL fuer $arch auf der Downloadseite gefunden."

latest="$(printf '%s' "$url" | sed -E "s|.*/${PKG}_([0-9.]+)_${arch}\.deb$|\1|")"
[ -n "$latest" ] || die "Versionsnummer nicht aus der URL lesbar: $url"

log "Installiert: $installed - verfuegbar: $latest"

if ! dpkg --compare-versions "$latest" gt "$installed"; then
    log "Keine neuere Version vorhanden. Nichts zu tun."
    exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
deb="$tmp/${PKG}_${latest}_${arch}.deb"

log "Lade Version $latest herunter."
curl -fsSL --max-time 900 -o "$deb" "$url" || die "Download fehlgeschlagen."

# Schutz davor, eine Fehlerseite statt eines Pakets zu installieren.
dpkg-deb --info "$deb" >/dev/null 2>&1 \
    || die "Heruntergeladene Datei ist kein gueltiges Debian-Paket."

log "Installiere Version $latest."
DEBIAN_FRONTEND=noninteractive apt-get install -y "$deb" \
    || die "Installation fehlgeschlagen."

now="$(dpkg-query -W -f='${Version}' "$PKG" 2>/dev/null || true)"
log "Neue installierte Version: $now"

# Laufende Instanz beenden. Der Benutzerdienst startet sie neu -
# ohne diesen Schritt liefe bis zum naechsten Neustart die alte Version
# weiter, und ein zusaetzlicher Start wuerde sich wegen der
# Einzelinstanz-Sperre kommentarlos sofort wieder beenden.
if pgrep -f "$PROC_MATCH" >/dev/null 2>&1; then
    log "Beende laufende Instanz - der Benutzerdienst startet sie neu."
    pkill -f "$PROC_MATCH" || true
else
    log "Es lief keine Instanz."
fi

log "Fertig."

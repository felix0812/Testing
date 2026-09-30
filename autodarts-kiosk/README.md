# Autodarts Kiosk: Autostart und automatische Updates

Richtet auf einem Ubuntu-Kioskrechner ein, dass **Autodarts Desktop**

- beim Hochfahren automatisch startet,
- nach einem Absturz von allein wieder hochkommt,
- taeglich auf Updates prueft, diese installiert und danach neu startet.

Getestet mit Ubuntu 24.04 und Autodarts Desktop 1.6.0.

## Installation

Auf dem Autodarts-Rechner, in einem Terminal:

```bash
git clone https://github.com/felix0812/Testing.git
cd Testing/autodarts-kiosk
sudo ./install.sh
```

Das Skript ermittelt den Benutzer selbst aus `sudo`. Soll ein anderer
Benutzer verwendet werden, ausdruecklich angeben:

```bash
sudo ./install.sh tobi
```

Danach ohne Neustart sofort starten:

```bash
systemctl --user start autodarts-desktop
```

## Was installiert wird

| Datei | Zweck |
|---|---|
| `/usr/local/bin/autodarts-update.sh` | Prueft und installiert Updates |
| `/etc/systemd/system/autodarts-update.service` | Fuehrt das Skript aus |
| `/etc/systemd/system/autodarts-update.timer` | Loest es taeglich um 05:30 aus |
| `~/.config/systemd/user/autodarts-desktop.service` | Autostart mit Neustart-Automatik |

## Wie das Update funktioniert

1. Der Timer startet das Skript einmal taeglich um 05:30 Uhr (mit bis zu
   30 Minuten Zufallsverzoegerung). War der Rechner zu der Zeit aus, wird
   die Pruefung nach dem Einschalten nachgeholt.
2. Das Skript liest die aktuelle Version von <https://autodarts.com/downloads>
   und vergleicht sie mit der installierten.
3. Ist eine neuere Version verfuegbar, laedt es das passende `.deb` fuer die
   Architektur des Rechners, prueft es auf Gueltigkeit und installiert es.
4. Anschliessend beendet es die laufende Instanz. Der Benutzerdienst startet
   sie binnen 15 Sekunden mit der neuen Version neu.

Die Uhrzeit ist bewusst frueh gewaehlt, damit der Neustart des Programms
niemanden beim Spielen unterbricht.

## Der Grund fuer den `pkill` beim Start

Autodarts Desktop laesst **nur eine Instanz** zu. Findet ein Start eine
bereits laufende vor, beendet er sich kommentarlos mit Rueckgabewert 0 --
ohne Fenster und ohne Fehlermeldung. Von aussen sieht das so aus, als
wuerde das Programm nicht starten.

Genau deshalb entfernt der Benutzerdienst vor jedem Start alte oder
haengende Instanzen (`ExecStartPre`). Aus demselben Grund legt `install.sh`
vorhandene Autostart-Eintraege unter `~/.config/autostart` beiseite: ein
zweiter Eintrag wuerde eine konkurrierende Instanz starten.

## Nachsehen, ob alles laeuft

```bash
systemctl --user status autodarts-desktop      # Autostart-Dienst
systemctl list-timers autodarts-update.timer   # naechster Update-Lauf
journalctl --user -u autodarts-desktop -n 50   # Protokoll des Programms
journalctl -t autodarts-update -n 50           # Protokoll der Updates
```

Update sofort ausloesen, ohne auf den Timer zu warten:

```bash
sudo /usr/local/bin/autodarts-update.sh
```

Das Skript sagt in jedem Fall, welche Version installiert und welche
verfuegbar ist -- auch wenn es nichts zu tun gibt.

## Voraussetzung: automatische Anmeldung

Der Autostart haengt an der grafischen Sitzung. Ohne automatische Anmeldung
bleibt der Rechner im Anmeldebildschirm stehen und startet nichts.
`install.sh` warnt, wenn das nicht eingerichtet ist. Einschalten in
`/etc/gdm3/custom.conf`:

```ini
[daemon]
AutomaticLoginEnable=true
AutomaticLogin=tobi
```

## Wenn doch mal nichts startet

Von Hand nachhelfen:

```bash
pkill -i autodarts
systemctl --user restart autodarts-desktop
```

Bleibt das Fenster leer oder taucht gar keines auf, liegt es meist an der
Grafikausgabe. Zum Pruefen einmal von Hand starten:

```bash
pkill -i autodarts
autodarts-desktop --disable-gpu
```

Hilft das, die Option dauerhaft in
`~/.config/systemd/user/autodarts-desktop.service` in die `ExecStart`-Zeile
aufnehmen und anschliessend:

```bash
systemctl --user daemon-reload
systemctl --user restart autodarts-desktop
```

Laeuft die Sitzung unter Wayland (`echo $XDG_SESSION_TYPE`) und bleibt das
Fenster aus, hilft zusaetzlich eine Zeile im Abschnitt `[Service]`:

```ini
Environment=GDK_BACKEND=x11
```

## Rueckgaengig machen

```bash
sudo ./uninstall.sh
```

Entfernt Autostart und Update-Automatik. Autodarts Desktop selbst bleibt
installiert.

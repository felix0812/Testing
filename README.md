# TankRadar Deutschland ⛽

Eine Website, die **ohne Server** läuft (einfach `index.html` im Browser öffnen) und die
**echten Spritpreise** aller deutschen Tankstellen abfragt, speichert und auswertet.

## Start

1. `index.html` doppelklicken (Chrome, Edge, Firefox). Eine Internetverbindung wird benötigt.
2. Kostenlosen API-Schlüssel holen: <https://onboarding.tankerkoenig.de>
3. Oben rechts ⚙ → Schlüssel eintragen → speichern.
4. Ort/PLZ eingeben oder „Standort“ klicken → **Suchen & tracken**.

## Funktionen

- **Echte Preise** (Super E5, Super E10, Diesel) der Markttransparenzstelle für Kraftstoffe (MTS-K)
  über die Tankerkönig-API – keine Fantasiewerte.
- **Günstigste Tankstelle** hervorgehoben, Liste sortiert nach Preis, Entfernung, Öffnungsstatus.
- **Karte** (TopPlusOpen des BKG) mit farbcodierten Preisen (blau = günstig, rot = teuer).
- **Deutschland-Scan**: fragt ganz Deutschland in einem Raster (289 Kreise à 25 km) ab und erfasst so
  alle ca. 14.000 Tankstellen. Gedrosselt, jederzeit stopp- und fortsetzbar.
- **Tracking**: Jede Suche wird als Gebiet gespeichert; Auto-Update (5–60 Min.) erfasst jede
  Preisänderung, solange die Seite geöffnet ist.
- **Statistik**: Durchschnittspreis im Zeitverlauf, beste Tankzeit (Uhrzeit-Profil), Marken-Vergleich,
  Preisverteilung, Min/Ø/Max je Kraftstoff, Top 10, Regionen nach PLZ-Bereich, Ersparnis-Potenzial,
  Trend ggü. vor 24 h, Preisverlauf jeder einzelnen Tankstelle.
- **Daten** bleiben lokal im Browser (IndexedDB); Export/Import als JSON, Preisverlauf als CSV.
- Hell-/Dunkelmodus, mobil nutzbar.

## Hinweise

- Verläufe und Statistiken über die Zeit entstehen aus deinen eigenen Abfragen – je länger
  TankRadar geöffnet ist (Auto-Update), desto aussagekräftiger.
- Der Demo-Schlüssel liefert echte Tankstellen, aber künstliche Preise – nur zum Ausprobieren.
- Bitte die API fair nutzen (Auto-Update nicht unter 5 Minuten, Deutschland-Scan nicht dauernd).

Daten: [Tankerkönig](https://creativecommons.tankerkoenig.de) / MTS-K, Lizenz CC BY 4.0 ·
Karte © Bundesamt für Kartographie und Geodäsie (TopPlusOpen, dl-de/by-2-0) · Angaben ohne Gewähr.

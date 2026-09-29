# Solar — Produktziel und Schnitte

Quelle der Wahrheit für Subagenten. Der Main-Agent hält das hier; Implementer bauen nur einen Schnitt zur Zeit.

## Versprechen

Eine App, die man **gerne öffnet**: echte Werte der eigenen Anlage, klarer Live-Fluss, Tag/Monat/Jahr, Ersparnis.  
Nicht die nächste Hersteller-App. Später dieselbe Physik für mehrere Marken, weil die fast alle schlecht sind.

**Nicht schätzen, wo gemessen werden kann.** Forecast und Verluste sind Modelle und müssen so aussehen.

## Baseline heute (v0.3)

Vite + React, HACS-Sidebar in der Companion-App. Keine native iOS-App.

- Live-Fluss, Tag/Monat/Jahr, Eigenverbrauch, Autarkie, Ersparnis, WR AC, Speicherverlust
- Nachträge Tag/Monat, Rendite, Freunde als **manueller Monatscode** (kein Sync)
- Quellen praktisch: **Home Assistant** als Bus, Growatt-Entities + Open API (Historie), Shelly-Entities, EcoTracker-Entities
- Settings: Entity-IDs per Hand, Growatt-Token, Tarif — kein geführtes Onboarding

Das ist gut genug als **Referenz-Physik** und als täglicher Begleiter für *eine* DC-gekoppelte Anlage. Es ist noch kein Produkt für fremde Setups.

## Drei Anlagen-Topologien

Immer im Modell führen, **v1 nur die erste ernst bauen**.

| | Topologie | Typisch | Wer liefert was |
|---|---|---|---|
| **A** | PV → Speicher, der auch WR ist | Growatt Nexa / Noah, Marstek | Ein Gerät: PV, SOC, AC-Ausgabe. Netz trotzdem oft extra (Zähler). |
| **B** | PV → WR, Speicher separat (AC- oder Hybrid) | klassischer Hybrid, AC-Batterie | WR: PV (+ oft AC). Speicher: SOC/Leistung. Zähler: Netz. |
| **C** | PV → WR, kein Speicher | Balkon / String-WR | WR: PV und oft AC. Zähler: Netz. Verbrauch = AC + Bezug − Einspeisung. |

„Komponenten ohne eigene Steuerung“ hängen immer hinter einem dieser Kästen. Die App spricht nie die Module direkt an, sondern **WR, Speicher, Zähler**.

Auch bei A ist der Zähler oft die bessere Netz-Wahrheit (wie EcoTracker heute). Regel: **Gerät darf Quelle sein, Zähler sticht Netz.**

## Quellen (Anbindung)

Jede Quelle ist ein **Adapter**. Home Assistant ist *eine* Quelle, nicht das Produkt.

| Priorität | Adapter | Rolle | Ohne Home Assistant |
|---|---|---|---|
| 1 | Growatt Open API | Topologie A: PV, Speicher, AC, Historie | Ja — Token, auch unterwegs |
| 1 | Shelly lokal / Cloud | Zähler und/oder WR-AC | Ja — im WLAN lokal, optional Shelly-Cloud |
| 1 | Everhome EcoTracker | Zähler | Lokal im Netz (wie heute oft über HA, muss direkt können) |
| 1 | Home Assistant | Hub, wenn jemand ihn hat | Optional, nie Pflicht |
| 2 | Marstek Venus Open API | Wie A | **Ja, aber nur im Heimnetz** (UDP Open API). Kein öffentliches Cloud-Token. |
| 2 | Marstek B2500 | Wie A | MQTT, ohne HA unbequem — später / HA-optional |
| 3 | Hoymiles | Micro-WR, C | Ausgeklammert |

Onboarding: **Topologie wählen → Kästen hinzufügen → verbinden (Token / IP im WLAN / optional HA) → Live-Werte sichtbar**. HA ist Abkürzung, nicht die Bedingung.

## Funktionen

### Kern (schon da, mitnehmen)

Übersicht mit Live-Fluss. Energie Tag/Monat/Jahr. Eigenverbrauch, Autarkie, Ersparnis. WR AC vs. PV. Speicher SOC/Verlust. Tarif.

### Anlage beschreiben

Pro PV-Feld: Ausrichtung, Neigung, kWp, Verschattung grob (keine / leicht / mittel / stark) plus optional **wann** (z. B. Vormittag, Winter). Das speist Forecast und Verlust-Schätzung, **nicht** die Ist-kWh.

### Forecast

Wetter + Geometrie → Kurve für **heute**, Auflösung ~5 Minuten, klar als Prognose. Kein Auffüllen fehlender Messwerte.

### Verluste (Schätzung, grob)

Getrennte, ehrliche Blöcke — nie in die Ist-Produktion mischen:

- Kabel (Querschnitt, Länge, Strom/Parallelschaltung)
- Winkel vs. Ideal
- Temperatur

### Freunde

Ziel: Produktion des anderen sehen, ohne Account-Zoo. **Kein Server, solange der Test lokal geht.**

Heute: Code pasten, nur Monat, nur lokal.

**So testen, ohne zweiten echten User und ohne Cloud:**

1. Zwei Browser-Profile (Safari + Chrome) auf dem Mac: in A Code erzeugen, in B einfügen.
2. iOS-Hülle: Simulator + eigenes iPhone, oder zwei Simulatoren. Code über Zwischenablage oder QR-Screenshot.
3. „Läuft von allein“ erst als Pull **beim Öffnen** der App, sobald beide denselben Pairing-Schlüssel haben (einmal per Paste tauschen).
4. Zwei Menschen: du + TestFlight, einmal Code schicken.

Ein verschlüsselter Briefkasten erst, wenn 1–4 nervt (iOS killt Hintergrund-Sync).

### iOS

**Hülle um die heutige Web-App** (Capacitor o. ä.), nicht SwiftUI.

Testpfad: Xcode-Simulator → eigenes iPhone per Kabel (kostenloses Developer-Team) → TestFlight. App Store später.

Growatt-Token in der Hülle: **nur Keychain / Secure Storage**, nie UserDefaults, nie offenes localStorage. Das HA-Panel im Browser bleibt ein Web-Risiko; iOS darf das nicht übernehmen.

## Bewusst später

Hoymiles. App Store / IAP. Widgets, Watch, Push. Username-Systeme. Unverschlüsselte Cloud. Schätzwerte als Live-Ist. YAML.

## Ergänzungen (sinnvoll, nicht aufblähen)

- **Gemessen vs. Modell** überall in der UI trennen (Farbe/Label).
- **Ein Anlagenprofil** (Topologie + Adapter), nicht zwölf lose Entity-Felder.
- HA-Panel weiter nutzbar, bis iOS alltagstauglich ist.
- CSV-Export der eigenen Werte (Dateneigentum).
- Optional später: „Batterie voll / viel Export“ — nur aus Messwerten.

## Getroffene Entscheidungen

| Thema | Stand |
|---|---|
| Zweiter All-in-One | **Marstek** |
| iOS | **Hülle** um die Web-App, nicht native SwiftUI |
| Freunde | Erst **lokal testbar** (zwei Fenster / Simulator + Handy). Server erst wenn das aneckt. |
| Growatt-Token | Ja, in der iOS-App, **Keychain**. Klartext-localStorage für iOS nicht akzeptabel. |

## Schnitte für Subagenten

Jeder Schnitt: eigene Spec, Akzeptanz, keine anderen Dateien anfassen als nötig. Reihenfolge ist die Empfehlung, nicht heilig.

| ID | Stand | Hinweis |
|---|---|---|
| S0 | erledigt | `plant.ts` — Default-Nexa = A |
| S1 | erledigt | Token → Composite; Live = jüngster Growatt-History-Punkt; Netz bleibt HA |
| S2 | teilweise | Ein Zähler in der UI (EcoTracker/Shelly über HA). Kein Direkt-API zum Zähler. |
| S3 | erledigt | Karte „Anlage einrichten“ (kein Mehr-Seiten-Wizard) |
| S4 | erledigt | Azimut, Neigung, kWp, Verschattung |
| S5 | erledigt | Prognose gestrichelt, 15-min Open-Meteo (nicht 5 min) |
| S6 | erledigt | Domain + Settings-Karte „Schätzung“, nicht in den Ist-kWh |
| S7 | erledigt | Clipboard-Pull, v2-Tage, kein Server |
| S8 | vorbereitet | Capacitor-Config + Keychain; `npx cap add ios` lokal, siehe `ios/README.md` |
| S9 | offen | Marstek **ohne HA**: Venus lokal (UDP Open API im WLAN). Nicht Cloud. B2500 später. |
| S10 | erledigt | HA-Datalist, Freitext bleibt möglich |

**Nicht parallel:** S0 vor S1–S3. S4 vor S5/S6. S8 kann nach S0 neben Onboarding laufen (nur Hülle + Keychain).

Hoymiles = eigener Epicschnitt, nicht in S0–S10.

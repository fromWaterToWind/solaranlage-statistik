# Solar Statistik — Agent-Betrieb

Grok 4.6 ist der **Main-Agent** (planen, zerlegen, prüfen, mit dem User sprechen).  
Composer-Subagenten **bauen**. Der Main-Agent schreibt keinen großen Code selbst.

## So starten

1. Agent-Chat, Modell **Grok 4.6**.
2. Ziel sagen, nicht die Dateien. Beispiel: „Onboarding-Flow für Growatt + Shelly.“
3. Wenn der Main nicht delegiert: `/implementer …` oder „lass Composer das bauen“.
4. Mehrere unabhängige Stücke: `/multitask` oder „parallel, je ein Subagent“.

## Rollen

| Wer | Modell | Aufgabe |
|---|---|---|
| Main (dieser Chat) | Grok 4.6 | Vision, Schnitt, Review, User |
| `/implementer` | Composer 2.5 | Code, Tests, kleine Fixes |
| `/explorer` | Composer 2.5, nur lesen | Codebase finden, nicht ändern |
| `/verifier` | Grok (inherit), nur lesen | Prüfen ob die Spec wirklich sitzt |

Main darf: Plan, Spezifikation, Review-Kommentar, maximal ein trivialer Einzeiler wenn der User das ausdrücklich will.  
Alles andere → Subagent mit klarer Spec (Dateien, Akzeptanz, was nicht anfassen).

## Produktvision (North Star)

Aus der heutigen HA-Sidebar eine **iOS-App**, die man gerne öffnet — echte Werte, mehrere Quellen, später mehrere Marken.

Details, Topologien und Subagenten-Schnitte: [`PRODUCT.md`](PRODUCT.md).  
Aktueller Stand: Vite + React + HACS-Panel. iOS erst nach explizitem Schnitt, kein stilles Refactoring.

## Parallelität

Unabhängige Tasks (UI-Onboarding vs. Growatt-Adapter vs. Tests) = mehrere `/implementer` in einem Rutsch.  
Der Main prüft die Diffs, startet `/verifier`, gibt dem User die Entscheidung — er fusioniert nicht still drei widersprüchliche Designs.

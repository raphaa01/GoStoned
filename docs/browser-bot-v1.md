# GoStone Browser Bot v1

## Konsistente Wertung und Gebietsanzeige

Spielstandsschätzung, Bot-Endvorschlag und Trainings-Endvorschlag verwenden
dieselbe Bewertungsstärke aus `GOSTONE_BOT_MODEL.settlement.evaluationRating`.
Die Schwierigkeit normaler Botzüge bleibt vom Gegner-Rating abhängig. Bereits
gebundene Partien behalten auch bei der Schätzung ihre Modellversion und ihren Hash.

Der Server übernimmt tote Gruppen, unklare Gruppen und neutrale Regionen gemeinsam
in einer gesperrten Wertungsrevision. Vor dem vollständigen Vorschlag und solange
unklare Gruppen offen sind, ist keine Bestätigung möglich. Menschen können unklare
Gruppen als lebend oder tot beurteilen. Eine neue Seitenladung überschreibt diese
Prüfung nicht. Bei geänderten Tot-Markierungen werden neutrale Regionen neu geprüft.

Das Ergebnis bleibt eine beidseitig bestätigte Regelbuchwertung aus Zugprotokoll,
Gefangenen, vereinbarten toten Gruppen, neutralen Regionen und Komi. Kleine schwarze
und weiße Quadrate zeigen ausschließlich gezählte leere Gebietspunkte; Dame und
vereinbart neutrales Gebiet bleiben unmarkiert. Die ursprüngliche gestoppte Stellung
bleibt im Zugprotokoll erhalten.

## Verbindlicher Modellvertrag

Für Botzüge und Vorschläge zur japanischen Endwertung ist ausschließlich
`GOSTONE_BOT_MODEL` aus `lib/bot/modelV1.ts` maßgeblich. Das aktuelle Artefakt ist:

- Modell: `public/bot-models/gostone-japanese-v8.onnx`
- Version: `v8`
- SHA-256: `47f0f57d51fd7e00becd5d85b1b5bcab62446538e376aa043b5a1a918917fb95`
- Regeln/Training: Japanisch, Komi 6,5
- Eingabe: 23 Ebenen mit Ko-Punkt, Freiheitsklassen und zwei Brett-Historien
- Training: 336 KataGo-Partien, 164.775 Trainings-/Replay-Positionen und 30 Epochen
- Qualität: 57,99 % gegen v7 in 144 farbgetauschten Partien; der Seki-Kopf hat
  den Qualitätstest nicht bestanden und bleibt daher ausschließlich unsichere Evidenz
- Browserlaufzeit: `workers/browser/gostoneBot.worker.ts`
- Servergrenze: `app/api/games/[gameId]/browser-bot/route.ts`

Botpartien dürfen `lib/katago/dispatch.ts`, Modal oder den KataGo-Container nicht
aufrufen. Der Browser berechnet den Vorschlag; der Server prüft weiterhin Zug,
Ko, Uhr, Zugreihenfolge und gespeicherten Spielstand.

## Japanische Endwertung

Der Worker liefert `GoStoneJapaneseSettlementProposal` mit:

- vollständigen Gruppen und `alive`, `dead` oder `uncertain`;
- vorgeschlagenen toten Steinen;
- unsicheren Steinen, die nicht automatisch entschieden werden dürfen;
- Seeds für neutrale Regionen/Seki;
- einer ausdrücklich unverbindlichen Punkt-Momentaufnahme für die Partiewerkzeuge,
  bei der unsichere Gruppen als lebend behandelt werden;
- einer lokalen japanischen Territory-Score-Vorschau, soweit die Position
  widerspruchsfrei ausgewertet werden kann.

Die Gruppenklassifikation kombiniert den stärker gewichteten Ownership-Kopf mit
dem Survival-Kopf. Der v8-Survival-Kopf enthält Status-Evidenz, aber Seki und
unsettled werden niemals automatisch finalisiert. Zwei vollständig eingeschlossene
Augen schützen eine Gruppe vor einer falschen Tot-Markierung; Gruppen mit wenigen
Freiheiten werden nur bei zusätzlicher gegnerischer Ownership-Evidenz als tot
vorgeschlagen. Solange eine Gruppe unklar bleibt, darf keine Zahl als belastbare
Endwertung ausgegeben werden. Die Partiewerkzeuge dürfen eine klar als Schätzung
bezeichnete Momentaufnahme zeigen; sie verändert weder den Vorschlag noch die
Endwertung.

Die Ausgabe hat immer `authority: "proposal-only"`. Für das japanische Rulebook
muss der Code den Typ aus `lib/bot/modelV1.ts` verwenden und die abschließende
Wertung mit `lib/game/japaneseScoring.ts` serverseitig neu berechnen. Niemals
Ownership-Werte oder den Modellscore als Endergebnis speichern. Die Spieler
müssen den resultierenden Vorschlag akzeptieren oder die Partie fortsetzen.

## Training und Rating

Die Zugauswahl in `lib/bot/browserMovePolicy.ts` wird vom gemeinsamen Worker
für Website, Android und iOS verwendet. Sie prüft Legalität, Wiederholung und
vom Server ausgeschlossene Züge vor jeder Auswahl. Das Matchmaking erhält
Ratings ab 500 statt sie auf 600 anzuheben: 30 Kyu = 500, 25 Kyu = 750,
20 Kyu = 1000. Der trainierte Strength-Kanal bleibt unter 600 bei 0; die
feinere Abstufung entsteht durch die Zugauswahl, nicht durch untrainierte Eingaben.

`lib/bot/browserMoveSelection.ts` blendet das Anfängerprofil kontinuierlich
zwischen Rating 500 und 1100 (18 Kyu) aus. Bei 30 Kyu kommen höchstens die
24 besten Modellkandidaten mit weniger als Faktor 64 Policy-Abstand infrage;
die Temperatur beträgt etwa 2,87. Bei 25 Kyu sind es 16 Kandidaten, Faktor
26,91 und Temperatur 2,17; bei 20 Kyu 8 Kandidaten, Faktor 11,31 und
Temperatur 1,46. Die Wahrscheinlichkeit, den besten Zug zu übersehen und aus
den verbleibenden Kandidaten zu wählen, sinkt von 70 % über 40,83 % auf
11,67 %. Ohne passende Alternative wird weiterhin der beste Zug gespielt.
Anfänger-Alternativen, die ein eigenes echtes Auge füllen oder ohne Schlag
eine Gruppe in Selbst-Atari bringen, werden ausgeschlossen. Der beste Modellzug
bleibt für notwendige taktische Ausnahmen verfügbar. Es werden niemals beliebige
Brettkoordinaten als absichtliche Fehler hinzugefügt. Ab Rating 1100 gelten
wieder die bisherigen stärkeren Profile und der strikte Abstand kleiner `ln(8)`.

Policy-Abstände beschreiben Modellpräferenzen, keine Go-Punktverluste.
Diese Parameter geben abgestufte Schwierigkeiten vor; tatsächliche menschliche
Gewinnquoten müssen weiterhin mit Partien kalibriert werden.

## Passen

Passen wird getrennt von der temperaturgewichteten Zugauswahl entschieden.
Ein schwächeres Profil erzeugt dadurch keine zufälligen Pässe. Sind legale
Brettzüge verfügbar, darf der Bot erst nach mindestens `ceil(Brettfläche * 0,4)`
Steinsetzungen passen (33 auf 9×9, 68 auf 13×13, 145 auf 19×19). Spieler-Pässe
zählen nicht als Fortschritt und heben diese Sperre nicht auf. Mindestens 20 %
des Bretts müssen noch mit Steinen besetzt sein. Bei mehr als `max(4,
floor(Brettfläche * 0,08))` leeren Punkten mit unsicherem Ownership-Signal
(Betrag kleiner 0,55 oder fehlender/ungültiger Wert) wird weitergespielt.

Ein eigener Pass benötigt mindestens den Policy-Vorsprung `ln(1,5)` gegenüber
dem besten legalen Brettzug. Nach einem Spieler-Pass genügt ein knapperer
Vergleich mit einem Logit-Bonus von 0,75; Spielfortschritts- und Ownership-Prüfung
bleiben verpflichtend. Ohne legalen Brettzug ist Passen weiterhin möglich.
Diese Entscheidung beendet nur den Zugwechsel und übergibt an die bestehende
Japanische Wertung mit Spielervereinbarung; sie setzt selbst keinen Gewinner.

Der Strength-Kanal bildet die sechs trainierten Profile 600, 900, 1200, 1500,
1800 und 2100 exakt auf 0,0 bis 1,0 ab. Das Artefakt ist versioniert; ein späteres
Modell wird mit einer neuen Version neben v8 veröffentlicht und
bekommt eine neue SHA-256-ID. Bereits begonnene Partien behalten ihre gebundene
Modellversion. Nominale Stärken ersetzen keine Kalibrierungsliga: Ein Profil darf
erst als gewerteter Gegner veröffentlicht werden, wenn die bestehenden
Kalibrierungs- und Auditbedingungen erfüllt sind.

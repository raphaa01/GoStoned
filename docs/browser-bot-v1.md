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

Die Elo-Anpassung wählt weiterhin temperaturgewichtet aus den besten legalen
Policy-Kandidaten. `lib/bot/browserMoveSelection.ts` begrenzt diesen Pool zusätzlich
auf Kandidaten, deren Policy-Gewicht weniger als Faktor 8 unter dem besten liegt
(Logit-Abstand kleiner als `ln(8)`, vor Anwendung der Elo-Temperatur). Liegt bereits
der zweitbeste Zug mindestens Faktor 8 zurück, wird immer der beste Zug gespielt,
unabhängig von Elo und Zufallswert. Auch bei mehreren ähnlich guten Zügen werden
deutlich schwächere Alternativen ausgeschlossen. Die bisherigen Legalitäts-, Ko-,
Wiederholungs- und frühen Passfilter sowie der Passbonus nach gegnerischem Passen
bleiben im Browser-Worker und werden vor der Auswahl angewendet.

Dieser Abstand beschreibt die Präferenz des Modells, keinen Unterschied in
Go-Punkten und keine garantierte taktische Notwendigkeit. Das Modell muss den
wichtigen Zug selbst erkennen; der Schutz verhindert, dass die Zufallsauswahl
eine bereits deutlich erkannte Präferenz verwirft.

Der Strength-Kanal bildet die sechs trainierten Profile 600, 900, 1200, 1500,
1800 und 2100 exakt auf 0,0 bis 1,0 ab. Das Artefakt ist versioniert; ein späteres
Modell wird mit einer neuen Version neben v8 veröffentlicht und
bekommt eine neue SHA-256-ID. Bereits begonnene Partien behalten ihre gebundene
Modellversion. Nominale Stärken ersetzen keine Kalibrierungsliga: Ein Profil darf
erst als gewerteter Gegner veröffentlicht werden, wenn die bestehenden
Kalibrierungs- und Auditbedingungen erfüllt sind.

Das lokale Training Lab erzeugt ab V5 einen neuen Modellvertrag mit 23 Eingabeebenen,
Global-Pooling und zusätzlichen Score-, Territory- und Gruppenstatus-Heads. V5 startet
mit zufälligen Gewichten; V6+ übernimmt ausschließlich V5-Familiengewichte und deren
Replay-Daten. Ein erzeugtes V5-Modell ersetzt den oben genannten produktiven V4-Vertrag
nicht automatisch. Die Produktionsintegration benötigt weiterhin eine ausdrückliche
Änderung von `GOSTONE_BOT_MODEL`, Browser-Worker und Versionsbindung.

Die AI Arena im lokalen Training Lab listet neben den abgeschlossenen Läufen im
aktuellen Arbeitsverzeichnis auch deren ausdrücklich in `comparison_model_checkpoint`
verknüpfte Vergleichsmodelle. Dadurch lassen sich insbesondere V5 und das für seine
Promotion verwendete V4-Artefakt direkt als Schwarz beziehungsweise Weiß auswählen.

V6 behält absichtlich Architekturversion 5 und lädt den vollständigen V5-Checkpoint.
Der neue Trainingslauf verwendet einen unabhängigen Seed, variierte
Stärke-Paarungen, tiefer analysierte knappe beziehungsweise policy-unklare
Positionen und zusätzliche Policy-Ziele für dieselbe Stellung auf mehreren
Stärkeprofilen. Alte V5-Fähigkeiten werden durch vollständiges Replay und einen
separaten gesperrten Retention-Test geschützt. Die Promotion verlangt bei V6+
eine Verbesserung auf frischen Testdaten, mindestens 60 Prozent in der
farbgetauschten Arena sowie Grenzen für Policy-, Value-, Score-, Settlement- und
Stärkeprofil-Regressionen auf dem V5-Testsplit. Zusätzlich muss V6 den verknüpften
V4-Vorgänger sowohl beim kombinierten gesperrten Testziel als auch in einer zweiten
direkten Arena schlagen.

Die Werte 600 bis 2100 sind weiterhin nominale Trainingsprofile. V5 reagiert zwar
messbar auf den Stärke-Kanal, eine echte Elo-Zuordnung erfordert aber eine
Kalibrierungsliga mit ausreichend vielen gewerteten Partien. V6 prüft deshalb
zusätzlich Policy-Qualität je Profil und ob das korrekte Stärkeprofil dieselben
Stellungen besser erklärt als das gespiegelte Profil; diese Prüfung ersetzt keine
spätere Spielstärke-Kalibrierung.

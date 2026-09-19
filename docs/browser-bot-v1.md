# GoStone Browser Bot v1

## Verbindlicher Modellvertrag

Für Botzüge und Vorschläge zur japanischen Endwertung ist ausschließlich
`GOSTONE_BOT_MODEL` aus `lib/bot/modelV1.ts` maßgeblich. Das aktuelle Artefakt ist:

- Modell: `public/bot-models/gostone-japanese-v4.onnx`
- Version: `v4`
- SHA-256: `24252f2845699aeb1b2a42e461bab1197d13f322e68e964ea0ebd9b974ccef61`
- Regeln/Training: Japanisch, Komi 6,5
- Training: 72 KataGo-Partien, 10.603 Positionen und 30 Epochen
- Qualität: 11,8 % besserer kombinierter Holdout-Wert als v3, keine gemessene
  Regression eines Ausgabekopfs
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
- einer lokalen japanischen Territory-Score-Vorschau, soweit die Position
  widerspruchsfrei ausgewertet werden kann.

Die Gruppenklassifikation kombiniert den stärker gewichteten Ownership-Kopf mit
dem Survival-Kopf. Zwei vollständig eingeschlossene Augen schützen eine Gruppe
vor einer falschen Tot-Markierung; Gruppen mit wenigen Freiheiten werden nur bei
zusätzlicher gegnerischer Ownership-Evidenz als tot vorgeschlagen. Solange eine
Gruppe unklar bleibt, darf keine scheinpräzise Punktzahl ausgegeben werden.

Die Ausgabe hat immer `authority: "proposal-only"`. Für das japanische Rulebook
muss der Code den Typ aus `lib/bot/modelV1.ts` verwenden und die abschließende
Wertung mit `lib/game/japaneseScoring.ts` serverseitig neu berechnen. Niemals
Ownership-Werte oder den Modellscore als Endergebnis speichern. Die Spieler
müssen den resultierenden Vorschlag akzeptieren oder die Partie fortsetzen.

## Training und Rating

Der Strength-Kanal bildet nominal 600 bis 2100 Ratingpunkte ab. Das Artefakt ist
versioniert; ein späteres Modell wird mit einer neuen Version neben v4 veröffentlicht und
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

# GoStone Browser Bot v1

## Verbindlicher Modellvertrag

Für Botzüge und Vorschläge zur japanischen Endwertung ist ausschließlich
`GOSTONE_BOT_MODEL` aus `lib/bot/modelV1.ts` maßgeblich. Das aktuelle Artefakt ist:

- Modell: `public/bot-models/gostone-japanese-v1.onnx`
- Version: `v1`
- SHA-256: `bacd6e1cdb783278aadce51b1b6db8ab4848512a723d00a5f69de94ecc151a08`
- Regeln/Training: Japanisch, Komi 6,5
- Browserlaufzeit: `workers/browser/gostoneBot.worker.ts`
- Servergrenze: `app/api/games/[gameId]/browser-bot/route.ts`

Botpartien dürfen `lib/katago/dispatch.ts`, Modal oder den KataGo-Container nicht
aufrufen. Der Browser berechnet den Vorschlag; der Server prüft weiterhin Zug,
Ko, Uhr, Zugreihenfolge und gespeicherten Spielstand.

## Japanische Endwertung und Partner-Adapter

Der Worker liefert `GoStoneJapaneseSettlementProposal` mit:

- vollständigen Gruppen und `alive`, `dead` oder `uncertain`;
- vorgeschlagenen toten Steinen;
- unsicheren Steinen, die nicht automatisch entschieden werden dürfen;
- Seeds für neutrale Regionen/Seki;
- einer lokalen japanischen Territory-Score-Vorschau, soweit die Position
  widerspruchsfrei ausgewertet werden kann.

Die Ausgabe hat immer `authority: "proposal-only"`. Für das japanische Rulebook
muss der Adapter `lib/bot/browserJapaneseSettlementProvider.ts` den allgemeinen
Vertrag `gostone-japanese-settlement-provider-v1` erfüllen. Er bindet jede
Antwort an Game-ID, Board-Hash, Zugnummer und Scoring-Revision. Die abschließende
Wertung wird mit `lib/game/japaneseScoring.ts` serverseitig neu berechnet. Niemals
Ownership-Werte oder den Modellscore als Endergebnis speichern. Beide Spieler
müssen dieselbe Revision bestätigen oder die Partie fortsetzen.

Das Modell darf ersetzt werden, ohne Regeln, API oder Datenbank anzupassen: Das
neue Artefakt wird im Worker geladen und ausschließlich im genannten Adapter in
den allgemeinen Vorschlagsvertrag übersetzt. Ohne Modell entsteht sofort ein
leerer manueller Vorschlag; Laden, Timeout oder ungültige Modellausgabe blockieren
die Endwertung nicht. Das Modell entscheidet insbesondere nie ein Spiel nach
Ablauf der Scoring-Frist.

## Training und Rating

Der Strength-Kanal bildet nominal 600 bis 2100 Ratingpunkte ab. Das Artefakt ist
versioniert; ein späteres Modell wird als `v2` neben `v1` veröffentlicht und
bekommt eine neue SHA-256-ID. Bereits begonnene Partien behalten ihre gebundene
Modellversion. Nominale Stärken ersetzen keine Kalibrierungsliga: Ein Profil darf
erst als gewerteter Gegner veröffentlicht werden, wenn die bestehenden
Kalibrierungs- und Auditbedingungen erfüllt sind.

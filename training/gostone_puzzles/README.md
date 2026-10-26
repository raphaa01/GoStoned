# GoStone Puzzle AI Lab

Eigenständige lokale Forschungsumgebung. Keine Änderung an Produktionspuzzeln,
Datenbank, Browser-Bot oder KataGo-Servern. Standardadresse: `http://127.0.0.1:4186`.

## Ehrlicher Stand

Das Lab ist lauffähig, trainierbar und exportierbar. **Ein sehr starker Generator
für vollständig geprüfte neue 3–5-Zug-Aufgaben ist noch nicht erreicht.**

Der aktuell vollständig nachspielbare historische Bestand umfasst **113
Aufgabenfamilien und 952 Zugbeispiele**: 97 Aufgaben aus Smith (1908), 16
Familien aus 20 einzeln gelesenen Guanzipu-Diagrammen auf den Seiten 100/101.
Vier gespiegelte Diagramme wurden mit den vorhandenen Familien zusammengeführt.
Zwei fehlerhafte historische Antworten bleiben in Quarantäne.
Es gibt keine 97-/104-Obergrenze; jeder Trainingslauf legt ein Manifest aller
verwendeten und zurückgehaltenen Datensätze ab.

14 Scans / 1.223 Seiten sind heruntergeladen, darunter alternative Ausgaben.
666 PDF-Seiten sind gerendert, 937 automatische Diagrammvorschläge gespeichert.
**Die restlichen Anfangsstellungen und Lösungen sind noch nicht vollständig
übertragen.** Ungeprüfte Erkennungen und rechtlich ungeklärte Ausgaben gelangen
nicht ins Training. Siehe `RESEARCH_STATUS.md` für gemessene Ergebnisse,
Bildbeobachtungen und verbleibende Abnahmelücken.

Mehrere lokale Modelle wurden tatsächlich trainiert und verglichen. Eine neue
Erzeugung aus leerem Bereich übernimmt keine Referenzsteine als festen Kern.
Ein neuer kompakter Entwurf mit 18 Steinen erfüllt erstmals die vollständigen
Beweisbedingungen für drei eigene Züge und zwei kurze Widerlegungen. Die
Bildprüfung stuft ihn vorläufig eher bei 23 Kyu ein (unsicherer Bereich 20–27).
Er ist deshalb kein bestätigter 10–20-Kyu-Erfolg. Das ist weiterhin ein
Kandidatengenerator: Noch kein Bestand erfüllt sämtliche
Vorgaben einschließlich Kyu, drei notwendigen eigenen Zügen, eindeutiger
Lösung, kurzen Widerlegungen und Qualitätsfreigabe.

Zusätzlich wurden 199 eigene taktische Strategien mit Gewinnzertifikaten und
separat bewiesener Mindestzugzahl gesammelt. Sie sind **Lernbeispiele, keine
199 fertigen Puzzle**. Das Training schließt 72 Beispiele aus zurückgehaltenen
Elternfamilien aus und kann die übrigen 127 nach Zugzahl ausgewogen beimischen.
Hierdurch entstehen weder menschliches Feedback noch automatische Kyu-Labels.

Experimentelle Abtastung ist über `generate --shape-prior-correction <0..1>`
und `--shape-fill-mode raster` reproduzierbar. Diese Varianten korrigieren den
Klassengewichtungsanteil beziehungsweise erzeugen jedes Feld aus dem bereits
erzeugten Präfix. Sie bleiben Vergleichswege; ein besseres Qualitätsresultat
ist daraus nicht automatisch gegeben. Der geprüfte Standard bleibt unverändert.

```powershell
python -m training.gostone_puzzles harvest-proofs
python -m training.gostone_puzzles train --run-name joint-proof-curriculum --resume <checkpoint.pt> --steps 1500 --solver-supervision-share 0.35
```

`models/<Lauf>/solver-supervision-manifest.json` dokumentiert die verwendeten
Beweise und den Ausschluss der Prüffamilien. Das Verzeichnis `selfplay/` wird
beim Umgebungsexport mitgenommen. Eine Fortsetzung übernimmt die Beimischung
aus dem Checkpoint; Quellenänderungen ersetzen keine erneute Beweisprüfung.

Für eine fortlaufende Suche ohne festes Vorschlagslimit:

```powershell
python -m training.gostone_puzzles compose --checkpoint <checkpoint.pt> --target 150 --own-moves 3 --kyu-min 10 --kyu-max 20 --batch-size 250
```

Das Ziel dieser Suche zählt **Beweiskandidaten**, einschließlich anschließender
erneuter Prüfung nach dem Entfernen unnötiger Steine. Bildqualität und Kyu
bleiben weitere Exportbedingungen. Geeignete fast vollständige Gegenbeweise
werden in einer gespeicherten Warteschlange mit größeren Zeitbudgets
weitergerechnet. Ein unentschiedener Zug bleibt unklassifiziert. `--resume`
setzt den protokollierten Lauf mit denselben Gewichten auch nach einem
Rechnerwechsel fort; `stop-composition.flag` fordert einen sauberen Stopp an.

Die zusätzlichen Ziele sind präzise taktische Bedingungen: `connect` verbindet
zwei ursprüngliche Gruppen mit mindestens zwei Freiheiten. `semeai` schlägt
die gegnerische markierte Gruppe, während die eigene ursprüngliche Gruppe
noch besteht und mindestens zwei Freiheiten hat. Das behauptet kein
bedingungsloses Leben dieser geretteten Gruppe. Im SGF markieren Dreiecke die
erste und Quadrate die zweite Gruppe; JSON enthält beide Koordinatenmengen.

## Start und Daten

Python 3.12+ und die beiden notwendigen Modellbibliotheken installieren:

```powershell
python -m pip install -r training/gostone_puzzles/requirements.txt
python -m training.gostone_puzzles doctor
python -m training.gostone_puzzles serve
```

Alternativ `Start-Puzzle-AI.cmd`. Für die zusätzliche automatische Scanerkennung:

```powershell
python -m pip install -r training/gostone_puzzles/requirements-scans.txt
```

Unter Windows liegen Daten standardmäßig in `%LOCALAPPDATA%/GoStone/PuzzleAI`.
`--root <Ordner>` vor dem Unterbefehl oder `GOSTONE_PUZZLE_HOME` wählt einen
anderen Arbeitsbestand. Auf anderen Systemen wird `~/.local/share/GoStone/PuzzleAI`
verwendet. Daten und Gewichte werden nicht in Git committed.

## Historische Quellen und Übertragung

```powershell
python -m training.gostone_puzzles import-historical
python -m training.gostone_puzzles download-scans
python -m training.gostone_puzzles render-scans --renderer <pdftoppm.exe>
python -m training.gostone_puzzles recognize-scans
python -m training.gostone_puzzles import-reviewed
python -m training.gostone_puzzles audit-corpus
```

Der erste Import liest ausschließlich die ursprünglichen Brettkoordinaten,
Startfarben und historischen Koordinatenantworten aus Arthur Smiths *The Game
of Go* (1908), Kapitel VIII. Die ausdrücklich kursiv gesetzte Startfarbe wird
erhalten. Die Spalte I wird übersprungen, wiederholte Zeilenangaben übernehmen
ihren Spaltenbuchstaben. Jede Antwortvariante wird mit Schlagen, Selbstmordverbot
und positionellem Superko nachgespielt. Fehler werden protokolliert, nicht
stillschweigend repariert. Der Import erhält separat freigegebene Scan-Datensätze.

Quelle: <https://www.gutenberg.org/files/66632/66632-h/66632-h.htm>.
Originalverfasser Arthur Smith starb 1929; der im Buch genannte frühere Bearbeiter
Oskar Korschelt 1940. Der Rechtevermerk bezieht sich auf alten Originalinhalt für
DE/US. Kein weltweiter Rechtsfreibrief wird behauptet. Moderne Umschläge,
Gutenberg-Marken, Begleittexte und moderne Lösungsbearbeitungen sind kein
Trainingsinhalt. Für Scanquellen sind Prüfsummen, Originaldatei und Rechte-Status
im Inventar hinterlegt. Ungeklärte Quellen werden nicht durch eine neue
Dateiendung oder Modelltraining freigegeben.

Im Tab **Scans übertragen** lassen sich Originalseiten und erkannte Gitter
nebeneinander prüfen. Drei gewählte Kreuzungen definieren ein korrigierbares
Gitter. Steinbelegung lässt sich ändern; nummerierte Lösungssteine müssen aus
der Ausgangsstellung herausgenommen und als Zugfolge übertragen werden.
SGF-Koordinaten sind nullbasiert von oben links (`aa` bis `ss`); alternative
historische Linien werden durch Semikolon getrennt.

Eine gespeicherte Übertragung ist zunächst gesperrt. Erst nach tatsächlichem
visuellem Abgleich von Stellung, Lösung und Quelle darf sie freigegeben werden:

```powershell
python -m training.gostone_puzzles approve-transcription --id <ID> --reviewer <Name> --position-checked --solution-checked --source-checked
```

Diese Schalter dokumentieren durchgeführte Prüfungen. Sie sind kein Ersatz für
das Lesen der Originalseite. Ungeklärte Rechte, fehlende Antworten, illegale
Züge und exakte Duplikate verhindern eine Aufnahme. Eine so übertragene
historische Antwort bleibt bis zum Solverbeweis als `unproved` gekennzeichnet.

## Training und Vergleich

```powershell
python -m training.gostone_puzzles train --approach joint --run-name mein-modell --channels 64 --blocks 5 --steps 2500
python -m training.gostone_puzzles generate --approach fresh --checkpoint <Arbeitsbestand>/models/mein-modell/best.pt --attempts 60 --own-moves 3 --kyu-min 10 --kyu-max 20
python -m training.gostone_puzzles compare --checkpoint <Arbeitsbestand>/models/mein-modell/best.pt --attempts 60 --own-moves 3 --proof-seconds 2 --proof-nodes 100000
```

`--attempts` zählt Vorschläge, keine zugesicherten fertigen Aufgaben. Alte
Experimente bleiben erhalten; ein vorhandener Trainingslauf wird nur mit
explizitem Resume fortgesetzt. `best.pt` bezeichnet den besten erhaltenen
**Nachahmungs-Prüfwert**, keinen nachgewiesenen Sieger für Puzzlequalität.

Neue Netze verarbeiten 19×19-Stellungen, relative Farben, sichtbare/verdeckte
Punkte, aktuelle Farbe, acht Kategorien, Zielsteine, Spielerrolle und gewünschte
eigene Zugzahl. Die historischen Tiefenlabels sind verbleibende Züge der
Referenzfolge, keine erfundenen Mindesttiefen-Beweise.

`joint` ändert historische Formen; `fresh` baut die gesamte Steinform aus einem
leeren Bereich auf. Die Referenz gibt nur Kategorie und räumlichen Rahmen vor.
Eine statische Konstruktionsregel verhindert freiheitslose AB/AW-Gruppen. Das
belegt weder Lösung noch Schönheit. Die größte Gruppe der angegriffenen Farbe
wird als Ziel vorgeschlagen; ein leicht schlagbarer Nebenstein soll nicht die
auffällige Hauptaufgabe ersetzen. Es gibt keine künstlich lebende Außenwand.

Trainings- und Prüffamilien werden vor Drehung/Farbwechsel durch einen stabilen
Familienhash getrennt. Modellberichte messen auf getrennten Familien
Brettrekonstruktion und Nachahmung historischer Züge. Diese Kennzahlen sind
weder Korrektheitsbeweise noch Bewertungen schöner Puzzle. Die Vergleichsläufe
haben jeweils einen frischen Duplikatindex und denselben Zufallsstart.

## Dein Feedback und Weiterlernen

Im Kandidatentab lassen sich `Gute Idee`, `Aussortieren`, `Unklar` und eine
Begründung speichern. Feedback und Suchbeweis bleiben getrennt. Ein positives
Urteil macht einen ungeklärten Kandidaten nicht korrekt. Beim Weiterlernen
fließen nur Feedbackbeispiele aus Trainingsfamilien ein. Der Qualitätskopf
erhält ein eigenes Lernziel; historische Rekonstruktion und Zugvorhersage
bleiben erhalten. Erst bei mindestens drei positiven und drei negativen
Trainingsurteilen wird die Präferenz zur Auswahl unter drei Modellvorschlägen
verwendet. Das ist eine erste Lernfunktion, keine validierte Qualitätsgarantie.

```powershell
python -m training.gostone_puzzles train --approach joint --run-name mein-modell --steps 500 --resume <Arbeitsbestand>/models/mein-modell/checkpoint.pt
```

Gewichte, Optimierungszustand und Zufallszustände werden gespeichert.
Zwischenstände bleiben als `checkpoint-<Schritt>.pt` verfügbar. Neue geprüfte
Datensätze können additiv aufgenommen werden. Bestehende Trainingsdatensätze
dürfen beim Fortsetzen nicht unbemerkt verändert werden; dafür ist ein neuer,
gesondert bewerteter Trainingslauf erforderlich. Modell-Checkpoints werden mit
`weights_only=True` geladen. Fremde Checkpoints dennoch nicht ungeprüft laden.

## Kyu-Einschätzung und Kalibrierung

Ein unbekannter Rang bleibt unbekannt. Im Kandidatentab kannst du zusätzlich
1–30 Kyu einschätzen. Eine automatische Schätzung lernt nur aus gut bewerteten,
bewiesenen Verläufen: mindestens 30 echte Labels aus 20 unabhängigen Kernen,
mindestens zehn Kyu Rangspanne, Prüfung ohne die jeweils komplette Familie,
mittlerer Fehler höchstens 2,5 Kyu und 90-Prozent-Fehlerbereich höchstens vier.
Verschiedene Modellstände werden getrennt kalibriert. Außerhalb der geprüften
Merkmals-/Rangbereiche wird keine Zahl ausgegeben. Der Fehlerbereich einer
automatischen Schätzung muss vollständig im gewünschten Exportband liegen.
Dies sind empirische Schätzungen, keine exakten menschlichen Spielstärken.
Aktuell fehlen entsprechende Nutzerlabels; es gibt noch keinen kalibrierten
Kyu-Stand und keine nachgewiesene automatische Rangsteuerung.

```powershell
python -m training.gostone_puzzles calibrate-difficulty
```

## Was der Prüfer belegt

Der aktuelle Baseline-Löser durchsucht das **vollständige tatsächliche Brett**.
Eine beschränkte taktische Vorsuche und neuronale Prioren ordnen mögliche
Züge, liefern aber ausdrücklich keine Beweise. Die eigentliche Prüfung lässt
keine legalen Gegenantworten wegen dieser Vorsuche weg und verwendet keine
imaginär sicheren Gruppen oder neuronalen Endzustände. Eine markierte ursprüngliche Gruppe
ist entweder physisch gefangen oder konservativ über einen Benson-Fixpunkt
unbedingt lebend. Außen-Ko, Seki und andere Zielarten sind keine freigegebenen
Aufgabentypen. Ein gemeinsamer Regelkern behandelt Schlagen, Selbstmordverbot,
Passen und positionelles Superko.

Gewinn-/Verlustzertifikate enthalten die notwendigen AND/OR-Verzweigungen.
Der Prüfer spielt sie getrennt von Suche und Suchcaches nach und kontrolliert
die vollständige Menge legaler Gegenantworten. Er teilt den Python-Regelkern;
zusätzlich wurden 2.777 historische und zufällige Zugübergänge mit GoStones
unabhängiger TypeScript-Regelengine verglichen. Das validiert weder Benson
noch alle denkbaren Go-Regelfälle unabhängig.

Erschöpfte Suche bedeutet immer `unknown`. Ein eigener befristeter Zielbeweis
kann belegen, dass das Ziel nicht früher erzwungen werden kann. Dieser
Fristnachweis wird ausdrücklich nicht als generelle Widerlegung ausgegeben.
Die minimale Zugzahl bezieht sich auf die implementierten Endzustände; eine
gesonderte didaktische Abgrenzung gegen reine Aufräumzüge steht noch aus.

Für den Puzzleexport müssen Gewinn, exakte Zugzahl, Eindeutigkeit des ersten
Zugs, Widerlegungen sämtlicher anderer erster Züge, zwei kurze Fehlvarianten
sowie Neuheit, Kyu-Einschätzung im gewünschten Band und positives Qualitätsfeedback vorliegen. Alle Zertifikate werden erneut
geprüft. Aktuell erfüllt kein generierter Kandidat diese gesamten Kriterien.

```powershell
python -m training.gostone_puzzles export-puzzles --destination <neuer Dateiname> --territory DE
```

Nur dann entstehen JSON und SGF mit expliziter Startfarbe, Anfangsstellung,
Kyu, Hauptfolge und beiden Fehlerfolgen. Quellen müssen dokumentierte
kommerzielle Nutzung des Originalinhalts ohne Pflichtnennung erlauben. Eine kurze Fehlvariante hat höchstens vier
Halbzüge und erreicht innerhalb dieser Folge die bewiesene Zielverhinderung.
Längere Widerlegungen werden nicht einfach bei vier Zügen abgeschnitten.
Das persistente Exportregister vergibt stabile Nummern (`Puzzle 1` usw.) und
verhindert auch über mehrere Exporte hinweg doppelte Aufgaben. Eine Teilmenge
oder neue Sortierung vergibt frühere Nummern nicht neu.
Symmetrien/Farbwechsel, räumlich normalisierte taktische Kerne und
Lösungszugmuster verhindern einfache Wiederholungen. Diese Filter sind noch
kein vollständiger Nachweis semantischer Vielfalt.

## Screenshots und eigene Analysen

```powershell
python -m training.gostone_puzzles quality-report --destination <neuer Prüfungsordner> --candidate-root <Vergleichslauf>/fresh
```

Das HTML zeigt alle acht neuen Originalübertragungen mit Anfangslage,
Druckziffern und tatsächlich ausgespieltem Ende. Bei Modellläufen werden die
ersten sechs gespeicherten Vorschläge und sämtliche Gewinne gezeigt. Orange
markiert das konkrete Ziel. Ein attraktives Diagramm ersetzt keinen Beweis;
die Bildprüfung kann auch formal lösbare Aufgaben als schlechte Lehrbeispiele
verwerfen. Browser-Screenshots werden anschließend aus diesem Bericht erstellt.
`review.json` dokumentiert die Auswahl und Messwerte. Noch keine automatische
professionelle Abnahme oder semantische Vielfaltgarantie wird behauptet.

## Umgebung und Modell auf einen anderen PC übertragen

### Originalscans in großen Stapeln übertragen

Der lokale optische Leser erkennt Steine und gedruckte chinesische Zugziffern
1–11. Er ist ein eigenes Hilfsmodell, kein Go-Löser. Die trainierten Gewichte
liegen im lokalen Bestand unter `models/scan-glyph-v3/checkpoint.pt`; sie werden
mit dem Arbeitsbestand exportiert. Die Scanbibliotheken aus
`requirements-scans.txt` und Poppler sind für neue hochauflösende Renderings
erforderlich. Es gibt keine kostenpflichtige OCR-API.

```powershell
python -m training.gostone_puzzles read-scan-batch --checkpoint <Arbeitsbestand>/models/scan-glyph-v3/checkpoint.pt --first-page 100 --last-page 223 --target-drafts 1000
python -m training.gostone_puzzles review-scan-batch --directory <Arbeitsbestand>/scans/assisted/<Laufordner>
```

Die zweite Anweisung erstellt unter `review/index.html` eine Seitenübersicht
und Original-/Stellungsvergleiche für jeden Entwurf. Die Ziffernfolge wird auf
Vollständigkeit 1…N, wechselnde Farben und legales Nachspielen geprüft. Das
beweist weder eine richtige Übertragung noch die stärkste Gegenwehr. Mehrere
Aufgaben auf einem Druckbrett, fehlende oder wiederbesetzte Steine, längere
Folgen und Textvarianten müssen gesondert gelesen werden. Auch eine Ausgabe
ohne optische Warnungen kann Steine übersehen. Die Aufgabengrenzen und das
19×19-Raster bleiben immer prüfpflichtig.

`--target-drafts` zählt **ungeprüfte Lesarten**, keine genehmigten Aufgaben
und keine garantierten unterschiedlichen Trainingsfamilien. Der erste echte
1.000er-Durchlauf las 113 Seiten mit 450 Druckbrettern in 476,75 Sekunden.
Alle Ergebnisse bleiben außerhalb des geprüften Korpus. Der Leser ruft weder
`register_transcription` noch `approve_transcription` auf. Erst die getrennte
Sichtprüfung von Stellung, vollständiger Lösung und Quelle erlaubt einen Import.

Wiederholte Läufe nutzen vorhandene Seiten erst nach Prüfung von Modell,
Lesercode, Rastervorgaben, Originaledition und den beteiligten Bild-/JSON-Hashes.
Ein geänderter Leser erhält einen eigenen Laufordner; ältere Versuche bleiben
erhalten. `stop-reader.flag` im Arbeitsbestand beendet den Lauf nach der
aktuellen Seite. Die CLI entfernt dieses Stoppsignal vor einem neuen Lauf.

Ein gesonderter Forschungsversuch nutzt 473 gefilterte optische
Stellungsentwürfe ausschließlich zum Lernen von Steinformen. Deren ungeprüfte
Zugfolgen liefern **keine** richtigen Zuglabels, Zielgruppen, taktischen
Kategorien oder Kyu-Bewertungen. Der Versuch liegt mit eigener Auswahl- und
Trainingsbeschreibung unter `experiments/weak-shape-curriculum-*` und ersetzt
den geprüften historischen Bestand nicht. Erst Erzeugungs- und Sichtprüfungen
können zeigen, ob solche zusätzlichen schwachen Formdaten helfen.

Nach 1.500 zusätzlichen Trainingsschritten und je 1.000 Erzeugungsversuchen
liefert der Formlernversuch weiterhin keinen vollständigen neuen Drei-Züge-
Beweiskandidaten und mehr dichte Blöcke als das Ausgangsmodell. Er ist kein
verbesserter Generator. Die Sichtprüfung entdeckte außerdem zwei Fehler in
älteren manuellen Referenzen. Ihre ausdrücklich nummerierten Korrekturen
archivieren die alten Datensätze und vereinigen die danach erkannten Dubletten.
Der aktuelle Bestand beträgt 111 Familien mit weiterhin 952 Zugbeispielen;
ältere Trainingsmanifeste mit 113 Familien werden als ältere Datenstände erhalten.

### Export

```powershell
python -m training.gostone_puzzles export-environment --destination <neuer Ordner außerhalb des Arbeitsbestands> --offline-windows --include-scans
```

Es entstehen Ordner und ZIP mit Quellcode, Modellen, Optimierungszuständen,
Daten, Reviews, Versuchen und SHA-256-Manifest. Mit `--include-scans` kommen
Originale und Seitenbilder hinzu. Ohne diese Option bleiben Scan-Inventar und
Übertragungsdaten enthalten. Niemals das ganze Repository oder `.env` kopieren.

Das Offline-Paket enthält für **Windows x64** einen offiziellen eingebetteten
CPython-Interpreter und die tatsächlich installierten notwendigen
Modellbibliotheken einschließlich Lizenzen. Sind die Scanbibliotheken beim
Export installiert, werden auch diese eingebunden. Das Paket benötigt keine
systemweite Python-Installation und keine Schlüssel/Cloud-Dienste zum
Trainieren oder Erzeugen. Ein kompatibles Windows mit erforderlicher
Microsoft-C++-Laufzeit ist weiterhin Plattformvoraussetzung. Poppler wird nicht
mitverteilt; vorhandene Seitenbilder und die Scanwerkstatt bleiben nutzbar.

Auf dem Ziel-PC ZIP entpacken, `Start-Puzzle-AI.cmd` starten. Modelle können dort
mit weiterem Feedback fortgesetzt werden. Ohne `--offline-windows` entsteht ein
Quellpaket mit Versionsliste zur separaten Installation; dieses Paket allein
enthält noch keine fertige Laufzeit für macOS/Linux.

```powershell
<Export>/runtime/python.exe -m training.gostone_puzzles verify-bundle --directory <Export>
```

Das Manifest kontrolliert Dateiintegrität, nicht die Vertrauenswürdigkeit eines
unbekannten Absenders. Ein Export darf weder in das Quellpaket noch in den
Arbeitsbestand hinein geschrieben werden.

## Prüfungen

```powershell
python -m unittest training.gostone_puzzles.test_lab training.gostone_puzzles.test_scan_reader -v
python -m training.gostone_puzzles audit-transitions --destination .cache/puzzle-ai/transitions.json
npx tsx scripts/audit-puzzle-ai-rules.ts .cache/puzzle-ai/transitions.json
npm run typecheck
npm test
npm run build
```

Es gibt keine automatischen externen API-Aufrufe für die Puzzle-Erzeugung.
Downloads historischer Quellen/Seiten und des optionalen eingebetteten
Interpreters benötigen Internet. Der Server bindet nur an Loopback und prüft
Host, Origin und ein Sitzungstoken für schreibende Browseranfragen. Ein
Writer-Lock verhindert parallele CLI-Schreibläufe im selben Bestand. Nach
einem Prozessabsturz vor dem Entfernen des Locks muss dessen PID geprüft
werden; niemals einen noch laufenden Writer durch Entfernen des Locks umgehen.

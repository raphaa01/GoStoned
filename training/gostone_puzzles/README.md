# GoStone Puzzle AI Lab

Eigenständige lokale Forschungsumgebung. Keine Änderung an Produktionspuzzeln,
Datenbank, Browser-Bot oder KataGo-Servern. Standardadresse: `http://127.0.0.1:4186`.

## Ehrlicher Stand

Das Lab ist lauffähig, trainierbar und exportierbar. **Ein sehr starker Generator
für vollständig geprüfte neue 3–5-Zug-Aufgaben ist noch nicht erreicht.**

Aktuell sind 97 historische Aufgaben mit legalen Referenzvarianten übertragen;
zwei weitere historische Antworten wurden quarantänisiert. Die 97 Aufgaben
ergeben 777 Zugbeispiele, keine 777 unabhängigen Puzzle. Historische Antworten
sind Referenzen, keine Beweise gegen sämtliche Gegenwehr.

Zwei kleine Modelle (je 60.614 Parameter) wurden tatsächlich auf diesem Laptop
trainiert: gemeinsame Brettrekonstruktion und Zugvorhersage (`joint`) sowie
reine Rekonstruktion (`denoise`). Ein dritter Vergleich verändert Stellungen
zufällig. Der erste kontrollierte Vergleich mit je 60 Versuchen, drei eigenen
Zügen und gleichem Suchbudget lieferte **keine exportfähige Aufgabe**. Die
Erzeugung ist daher nicht als serienreif markiert. Siehe `RESEARCH_STATUS.md`.

14 historische Scans mit insgesamt 1.223 Seiten sind im lokalen Arbeitsbestand
inventarisiert. Darunter sind alternative Ausgaben derselben Aufgaben. Die
PDF-Ausgaben wurden in 666 Seitenbilder umgewandelt. Die drei DjVu-Ausgaben
mit zusammen 557 Seiten bleiben zusätzliche Vergleichsausgaben und können
seitenweise über Commons angezeigt werden. Die erste Bilderkennung lieferte
937 **Diagrammvorschläge**, nicht 937 geprüfte Puzzle. Beobachtete Gitterfehler,
chinesische Lösungsziffern, geschlagene Steine und schriftliche Varianten müssen
noch übertragen und geprüft werden. Daraus ist noch kein zusätzliches
Trainingsbeispiel freigegeben.

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
python -m training.gostone_puzzles train --approach joint --steps 1000
python -m training.gostone_puzzles train --approach denoise --steps 1000
python -m training.gostone_puzzles compare --attempts 60 --own-moves 3 --proof-seconds 0.5
python -m training.gostone_puzzles generate --approach joint --attempts 30 --own-moves 3 --kyu-min 10 --kyu-max 20
```

`--attempts` zählt untersuchte Vorschläge, nicht zugesicherte fertige Aufgaben.
Kyu-Grenzen werden aktuell als Zielvorgabe gespeichert. **Es gibt noch kein
kalibriertes Kyu-Modell und keine nachgewiesene Rangsteuerung.**

Das Netz verarbeitet 19×19-Stellungen, relative Steinfarben, sichtbare/verdeckte
Punkte, Startfarbe und sieben Kategorien. Es sagt Steinbelegung, Zugprior und
menschliche Qualitätspräferenz voraus. Erzeugt werden derzeit kontrollierte
Ergänzungen/Änderungen historischer Lebens-/Todesformen. Vollständig freie
Generierung und rückwärts gerichtete Aufgabenkonstruktion sind noch nicht
implementiert. Es gibt keine künstlich lebende Außenwand.

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
python -m training.gostone_puzzles train --approach joint --steps 500 --resume <Arbeitsbestand>/models/joint/checkpoint.pt
```

Gewichte, Optimierungszustand und Zufallszustände werden gespeichert.
Zwischenstände bleiben als `checkpoint-<Schritt>.pt` verfügbar. Neue geprüfte
Datensätze können additiv aufgenommen werden. Bestehende Trainingsdatensätze
dürfen beim Fortsetzen nicht unbemerkt verändert werden; dafür ist ein neuer,
gesondert bewerteter Trainingslauf erforderlich. Modell-Checkpoints werden mit
`weights_only=True` geladen. Fremde Checkpoints dennoch nicht ungeprüft laden.

## Was der Prüfer belegt

Der aktuelle Baseline-Löser durchsucht das **vollständige tatsächliche Brett**.
Er verwendet keine feste lokale Suchbox, keine imaginären sicheren Gruppen
und keinen neuronalen Wert als Endzustand. Eine markierte ursprüngliche Gruppe
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
und positives Qualitätsfeedback vorliegen. Alle Zertifikate werden erneut
geprüft. Aktuell erfüllt kein generierter Kandidat diese gesamten Kriterien.

```powershell
python -m training.gostone_puzzles export-puzzles --destination <neuer Dateiname> --territory DE
```

Nur dann entstehen JSON und SGF. Eine kurze Fehlvariante hat höchstens vier
Halbzüge; der beigefügte vollständige Widerlegungsbeweis darf länger sein.
Symmetrien/Farbwechsel, räumlich normalisierte taktische Kerne und
Lösungszugmuster verhindern einfache Wiederholungen. Diese Filter sind noch
kein vollständiger Nachweis semantischer Vielfalt.

## Umgebung und Modell auf einen anderen PC übertragen

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
python -m unittest training.gostone_puzzles.test_lab -v
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

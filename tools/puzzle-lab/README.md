# GoStone Local Puzzle Lab

Ein eigenständiges Lab für diesen Laptop. Node.js (bereits Projektvoraussetzung)
genügt: keine zusätzlichen Pakete, Python-Umgebung, Modelle, GPU, Datenbank,
API-Schlüssel oder Cloud-Abrechnung. Es verändert weder GoStone-Puzzle noch Bot,
Spieler-Ränge oder die Produktionsdatenbank.

## Start

```powershell
npm run puzzles:lab
```

Der Browser öffnet `http://127.0.0.1:4184`. Der Server bindet ausschließlich an
Loopback. Alternativ `tools/puzzle-lab/start-lab.ps1` starten; dieser Windows-
Launcher startet den Server mit verborgenem Fenster und öffnet einen vorhandenen
Lab-Prozess erneut. Zum Testen: `npm run puzzles:lab -- --no-browser --port 4185`.

## Benutzung

1. Zielanzahl, eigene schwarze Züge (Minimum/Maximum), geschätzten Kyu-Bereich,
   CPU-Worker und optional das Suchbudget einstellen. Für genau vier eigene Züge
   beide Zugfelder auf **4** setzen; entsprechend **5** für fünf Züge.
2. **Aufgaben erzeugen**. Die Qualität wird nicht gesenkt, um die Zielanzahl zu
   erreichen. Versuchslimit oder Zeit-/Knotenbudget dürfen deshalb zu einem
   kleineren Bestand führen. Anspruchsvolle Tiefen und enge Rangfilter können
   lange suchen oder keinen Treffer liefern.
3. Aufgaben über ihre **festen Nummern** öffnen, Probe-Spielen, Lösungen und
   geprüfte Fehlerwege Schritt für Schritt ansehen. Weiß wählt eine lange
   Verteidigung. Andere schwarze Fortsetzungen werden bei Bedarf nachgeprüft;
   ungeklärte Züge werden niemals fälschlich als Fehler bezeichnet.
4. Lehrreiche Aufgaben **freigeben**, ähnliche/unschöne Aufgaben **aussortieren**.
   Automatischer Beweis und redaktionelle Freigabe sind getrennt. Der gemeinsame
   JSON-/SGF-Export enthält nur manuell freigegebene Aufgaben. Einzeldateien sind
   ausdrücklich auch für die Untersuchung ungeprüfter Kandidaten verfügbar.

Pause/Stop schließen die aktuelle Stellung ab. Ein geschlossenes Browserfenster
stoppt den Server nicht. Beim Beenden des Servers wird der Lauf pausiert; beim
Neustart kann er fortgesetzt werden. Nach einem Prozessabbruch wird der zuletzt
gesicherte Lauf ebenfalls pausiert wiederhergestellt. Einzelne zuletzt laufende
Versuche können verloren gehen, bestätigte Puzzle-Dateien bleiben gespeichert.

## Was der Beweis tatsächlich garantiert

- Ausschließlich **abgeschlossene Fangaufgaben**, Schwarz fängt eine markierte
  weiße Gruppe. Die äußere schwarze Einfassung ist als unconditionally living
  Gruppe mit zwei getrennten Augen auf einem echten 9×9/13×13-Brett dargestellt.
  Gespielt wird ausschließlich in der hervorgehobenen Kammer (bis 25 Punkte).
- Legale Züge, Schlagen, Selbstmordverbot, Ko und positionelles Superko. Passen
  ist berücksichtigt; zwei aufeinanderfolgende Pässe liefern **ungeklärt**, nicht
  einen erfundenen Lebensbeweis. Außen-Kodrohungen werden nicht modelliert.
- Ein Fangbeweis enthält eine schwarze Gewinnstrategie und **alle** legalen
  weißen Antworten an jedem Verteidigungsknoten. Eine Widerlegung enthält eine
  weiße Lebensstrategie und alle schwarzen Antworten, bis ein konservativer
  Benson-Lebensnachweis (zwei vitale Augenregionen) erreicht ist.
- Der einzige korrekte erste schwarze Zug muss bewiesen sein. Für jeden anderen
  legalen ersten Zug, einschließlich Pass, ist ein Lebensbeweis nötig. Wenn nur
  die Suchtiefe erschöpft ist, ist ein Zug **ungeklärt**, niemals „falsch“.
- Die Zugzahl ist die minimale Anzahl schwarzer Züge, mit der Schwarz im
  schlechtesten Verteidigungsfall fangen kann. Die Strategie minimiert schwarze
  Züge auch in den Folgestellungen; sie darf keine künstlichen Umwege einfügen.
- Bloßes Auffüllen gegen mehrfaches weißes Passen wird aussortiert. Ein einzelner
  taktischer Pass ist nur mit sonstiger echter Gegenwehr erlaubt. Mindestens zwei
  falsche erste Züge müssen nachweisbar zu Leben führen.
- Beweiszertifikate werden beim Speichern und Export unabhängig nachgespielt.
  Die Tests spielen Zertifikate zusätzlich mit GoStones bestehender Vollbrett-
  Regelengine nach. Das belegt die implementierten lokalen Regeln, nicht die
  universelle Fehlerfreiheit einer Go-Engine oder offene Ganzbrettaufgaben.

## Vielfalt

Der Generator erzeugt neue Zufallsformen, Augenräume, weiße Gruppen und schwarze
Opfersteine. Er importiert keine Puzzle-Daten. Der dauerhafte Index vergleicht
acht Symmetrien und normalisiert Positionen. Zusätzlich vergleicht er das innere
Augen-/Opfermotiv ohne zusätzliche äußere weiße Steine. Dasselbe Motiv an einer
anderen Stelle, in einer größeren Einfassung, gespiegelt oder gedreht wird
verworfen. Ein strenger Ähnlichkeitsvergleich verwirft kleine Formänderungen.
Auch aussortierte Aufgaben bleiben im Index, damit sie nicht erneut entstehen.
Dies verhindert geometrische Varianten; inhaltlich ähnliche Lehrmotive müssen
zusätzlich bei der Freigabe beurteilt werden. Der Bestand ist endlich, und die
Suchstatistik macht sinkende Ausbeute und Duplikate sichtbar.

## Kyu-Bewertung

Jede angenommene Aufgabe bekommt eine Kategorie und einen **geschätzten Rang
zwischen 1 und 30 Kyu**. Die versionierte Heuristik verwendet minimale eigene
Züge, Beweisgröße, Verteidigungsverzweigungen, Widerlegungen und Opferzüge.
1 Kyu ist schwerer als 30 Kyu. Nicht jeder Suchlauf liefert jede Rangstufe.

**Ein lokal erzeugtes „10 Kyu“ ist keine gemessene 10-Kyu-Aufgabe.** Für verlässliche
Ränge brauchen wir später Lösungsquoten bekannter Spielerstärken. Die JSON-Daten
und Oberfläche markieren deshalb alle Ränge als `estimated` / `uncalibrated`.
Lösungsbeweis, menschliche Schwierigkeit und didaktische Qualität sind drei
verschiedene Prüfungen. Im Lab wird keine vermeintlich exakte Ranggarantie gegeben.

## Leistung und Grenzen

Bitmasken, gezielte Zugreihenfolge, iterative Suchtiefe, begrenzte Caches und
Node-Worker halten die Suche lokal und parallel. Die Cache-Schlüssel enthalten
die vollständige Wiederholungshistorie, damit Superko-Beweise nicht aus einer
anderen Historie übernommen werden. Standard: zwei Worker, höchstens die Hälfte
der verfügbaren logischen CPU-Kerne (maximal sechs). Ein Suchbudget schützt den
Laptop vor einzelnen unendlich schweren Stellungen. Größere Tiefen, unklare
Verteidigungen und große Beweisbäume werden verworfen, nicht approximiert.

Die Zahl angeforderter Aufgaben ist ein Ziel, keine garantierte Ausbeute. Der
Generator ist ein erstes lokales Tsumego-Lab und keine allumfassende Go-Buch-
Redaktion. Offene Gruppen, Außen-Kodrohungen, Joseki, globale Strategie und Dan-
Einstufungen sind nicht Teil dieses Formats.

## Daten, Export und Prüfung

Alles liegt unter `.cache/puzzle-lab/` (von Git ignoriert): `catalog.json`,
`job.json`, `puzzles/puzzle-N.json`. Keine erzeugten Bestände werden automatisch
in die App importiert. Der JSON-Export verwendet `gostone.local-puzzle-bundle/1`
und enthält Startstellung, Vollbrett, Ziel, Kategorie, Kyu-Schätzung, Zugzahl,
Lösung, vollständige Beweise, Widerlegungen und Erzeugungsherkunft. Der SGF-Export
enthält Aufstellung, markierte Gruppe und verzweigte Lösung/Fehlerwege; die
Kammerbeschränkung steht ausdrücklich im Kommentar.

```powershell
npm run puzzles:lab:test
npm run puzzles:lab:verify
npm run puzzles:lab:verify -- --file "path/to/gostone-lab-approved.json"
npm run puzzles:lab:generate -- --count 20 --ownMovesMin 4 --ownMovesMax 5
```

`generate` speichert in denselben lokalen Bestand, arbeitet mit denselben Filtern
und beendet sich bei unerreichter Zielmenge mit Exit-Code 2. Der CLI-Generator
darf nicht gleichzeitig mit einem GUI-Lauf auf dasselbe Datenverzeichnis
schreiben. Ein gemeinsamer Prozess-Lock verhindert konkurrierende Schreiber.

## Für die spätere App vorgemerkt

Die vorhandenen 60 eigenen Aufgaben sollen 25–30 Kyu bekommen. Später nur eine
kleine Anzeige „Puzzle 1300“, keine Zählung „200 von 1900“. Neue ungelöste Aufgaben
nahe dem Spieler-Rang wählen, an Verbesserung anpassen, gelöste Aufgaben nicht
normal erneut zeigen. Falsche Aufgaben nach ungefähr 10–20 weiteren Aufgaben
wiederholen, bis sie richtig gelöst werden. Diese App-Änderungen sind ausdrücklich
noch nicht implementiert.

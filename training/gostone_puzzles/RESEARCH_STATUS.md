# Abnahme des gewünschten starken Puzzle-Modells

Stand: 25. Oktober 2026. **Der geforderte starke Seriengenerator ist weiterhin
nicht erreicht.** Diese Datei unterscheidet ausgeführte Arbeiten von offenen
Abnahmekriterien. Eine höhere Nachahmungsquote ist kein Qualitätsnachweis.

## Datenbestand und die Zahl 97

97 waren die legal übertragbaren Aufgaben aus Arthur Smiths Original von 1908,
keine künstliche Obergrenze. Zwei historische Antworten bleiben wegen illegaler
Koordinaten in Quarantäne. Die 97 Familien ergaben 777 Zugbeispiele.

In diesem Durchlauf wurden acht Aufgaben von Originalseite 100 des historischen
Guanzipu-Scans einzeln gelesen und als Anfangsstellung plus nummerierte Folge
übertragen. Die Originalausschnitte wurden neben rekonstruierten Diagrammen und
tatsächlich ausgespielten Endstellungen fotografiert und visuell verglichen.
Eine gespiegelte Wiederholung gehört zur selben Familie; ihre zusätzliche
Fortsetzung wird als Variante gespeichert. Ergebnis: **104 Familien, 843
Zugbeispiele, 46 schwarze und 58 weiße Startstellungen**. 83 Familien / 664
Zugbeispiele dienen dem Training, 21 Familien / 179 Beispiele der Prüfung.
Alle sieben neuen Familien derselben Scanseite bleiben gemeinsam im Training.

Die neue Kategorie `tesuji` bedeutet ausdrücklich, dass die genaue historische
Gewinnbedingung noch nicht unabhängig bewiesen ist. Die Folgen werden für
Formen und Zugprioren verwendet, nicht als vollständige Minimax-Beweise.
Der benannte visuelle Prüfer ist Codex; eine professionelle Go-Abnahme wird
nicht vorgetäuscht.

**Nicht erreicht:** alle Scans vollständig übertragen. 14 Originaldateien mit
1.223 Seiten sind vorhanden; mehrere sind alternative Ausgaben derselben
Aufgaben. 666 PDF-Seiten wurden gerendert. 937 Diagrammvorschläge bleiben
ungeprüfte Figuren, die teils mehrere Aufgaben enthalten. Diese Zahlen werden
nicht als Trainingspuzzle ausgegeben. Ein lokaler RapidOCR-Versuch las einzelne
alte Lösungsziffern falsch; die Ergebnisse wurden nicht freigegeben. Ungeklärte
Antwortausgaben bleiben rechtlich gesperrt.

`import-reviewed` prüft die Originaldatei gegen die dokumentierte Prüfsumme,
spielt sämtliche übertragenen Züge nach und vereinigt Symmetrie-Duplikate.
`audit-corpus` und das Manifest jedes Trainingslaufs belegen, welche Datensätze
verwendet oder als Prüfdaten zurückgehalten wurden. Es gibt kein 97-/104-Limit.

## Tatsächlich trainierte Modellvarianten

| Lauf | Parameter | Schritte | Bester Referenzzug Top 1 auf derselben 128er-Prüfstichprobe |
| --- | ---: | ---: | ---: |
| Alter gemeinsamer Ansatz | 60.614 | 1.002 | 20,31 % am erhaltenen letzten Stand |
| Zielgruppe und Spielerrolle, 32 Kanäle / 3 Blöcke | 61.478 | 2.500 | 33,59 % bei Schritt 1.750 |
| Ganze Formen aus leerem Bereich, 64 Kanäle / 5 Blöcke | 383.814 | 2.500 | 35,16 % bei Schritt 2.500 |
| Zusätzlich bedingte eigene Zugzahl | 384.390 | 2.500 | 35,16 % bei Schritt 2.250 |

Die neue Eingabe kennzeichnet die Zielsteine, die Rolle des Spielers am Zug und
in der dritten Merkmalsversion die verbleibende eigene Zugzahl. Die Tiefenlabels
der historischen Daten sind **Längen der Referenzfolge**, keine behaupteten
Beweise minimal notwendiger Züge. Eine tatsächliche Mindesttiefe wird weiterhin
separat vom Löser geprüft. Frühere Gewichte werden nicht überschrieben;
bester Prüfcheckpoint, letzter Stand, Optimizer und Datenmanifest bleiben erhalten.

Der neue Modus `fresh` übernimmt keine Anfangssteine und keinen alten Zielkern.
Die Referenz liefert Kategorie und räumlichen Rahmen. Das Netz erzeugt die
Belegung schrittweise neu. Eine statische Legalitätsbedingung verhindert, dass
beim Aufbau eines AB/AW-Diagramms Steine ohne Freiheit entstehen. Das ist keine
Lebens-/Todesbewertung und keine Qualitätsfreigabe.

## Erzeugungsversuche und visuelle Gegenprüfung

Gemeinsame Bedingungen des ersten neuen Vergleichs: je 60 Vorschläge, drei
gewünschte eigene Züge, 2 Sekunden pro Hauptsuchaufruf, 100.000 Suchknoten,
Zufallsstart 2026, frische Duplikatindizes, identischer 64-Kanal-Checkpoint.

| Ansatz | Ungeklärt | Illegale Anfangslagen | Gewinnstrategie beliebiger kürzerer Tiefe bewiesen | Vollständig freigegeben |
| --- | ---: | ---: | ---: | ---: |
| Vorhandene Form ändern | 43 | 11 | 4 | 0 |
| Ganze Form neu erzeugen, vor Legalitätsbedingung | 12 | 41 | 3 | 0 |
| Zufallsänderungen | 39 | 2 | 1 | 0 |
| Neue Form mit statischer Legalitätsbedingung | 50 | 0 | 6 | 0 |

Nach der visuellen Gegenprüfung wurden die Gewinne nicht als gute Aufgaben
akzeptiert: Der scheinbare Drei-Züge-Erfolg `5a9a957ae1397a292e7bf9f6` betraf
nur einen isolierten weißen Stein neben einer großen, unbeteiligten Kampfgruppe.
Die Gegenwehr war für dieses kleine Ziel zwar bewiesen; das pädagogische Ziel
war falsch gewählt. Die Zielauswahl nimmt jetzt die größte Gruppe der
angegriffenen Farbe. Ein erneuter 60er-Lauf ergab 54 ungeklärte Stellungen,
zwei widerlegte Ziele und vier Gewinne mit nur ein bis zwei eigenen Zügen.
**Kein neuer Kandidat erfüllt damit bereits die gesamte Drei-Züge-Anforderung.**

Der anschließende Lauf mit dem zugzahlbedingten Modell erzeugte 150 Vorschläge
in **228,47 Sekunden**: 117 ungeklärt, 11 widerlegt, 20 Gewinne, ein fehlendes
Ziel und ein verworfener dichter Block. Von den Gewinnen benötigten zwölf nur
einen eigenen Zug, sieben zwei und einer drei. Dieser letzte Kandidat
(`8d0bd5af74026f306923ecba`) betrifft tatsächlich die größte weiße Gruppe mit
18 Steinen; Gewinn und Mindesttiefe sind bewiesen. Die 48-Steine-Ausgangslage
wirkt im Screenshot dennoch überladen. Eindeutigkeit und zwei kurze
Fehlerfolgen sind unbewiesen. Er bleibt gesperrt. **150 Vorschläge sind keine
150 fertigen Puzzle; auch dieser Versuch liefert null freigegebene Aufgaben.**

Die Bildprüfung ist reproduzierbar: `quality-report` zeigt Originalausschnitt,
Anfangslage, Druckziffern und echtes Ende sowie die ersten sechs Vorschläge je
Vergleichslauf und alle Gewinne. Zielsteine werden orange markiert. Es werden
keine attraktiven Einzelbilder als Beleg für eine Erfolgsquote ausgewählt.
Browser-Screenshots und eigene Analysen sind getrennte Prüfarbeitsdateien.

## Lösungsprüfung und Effizienz

Der vollständige 19×19-AND/OR-Löser bleibt konservativ. Alle erforderlichen
Gegenantworten einschließlich Pass werden geprüft. Neuronale Prioren und eine
beschränkte taktische Vorsuche ordnen Züge; deren Ergebnisse sind ausdrücklich
**keine exportfähigen Beweise**. Eine offene Suche oder ein Horizont gilt nie
als unbedingte Niederlage.

Binäre Zustands-/Historienhashes, vermiedene doppelte Gruppenberechnungen und
eine äquivalente Benson-Berechnung erreichten beim gleichen Ein-Sekunden-Test
ungefähr 17.500–20.600 statt 7.100–8.000 Knoten pro Sekunde. 39.966 zusätzliche
Benson-Vergleiche gegen die vorherige Berechnung stimmten überein. Eine sichere
Freiheitsuntergrenze spart erfolglose Schlagversuche; sie darf ausschließlich
bei einer ausdrücklich begrenzten Zielzeit als Niederlagenbeweis dienen.
Unbegrenzte Gegenbeweise werden dadurch nicht abgeschnitten.

Offen bleiben ein umfassend geprüfter Relevance-Zone-Löser, Ko-/Seki-Ziele und
die didaktische Trennung entscheidender Züge von reinen Aufräumzügen. Das
gegenwärtige Schlagziel zählt tatsächliches Entfernen der markierten Steine.
Dadurch entsprechen historische Schlussdiagramme nicht automatisch drei
notwendigen Spielzügen des heutigen Exportformats.

## Verbindliche Anforderungen aus dem bisherigen Ersteller

- Unterschiedliche Anfangslagen **und** taktische Kerne; Farben, Drehung,
  Spiegelung und Verschiebung erzeugen keine neue Aufgabe. Lösungsfußabdrücke
  beider Spieler werden zusätzlich verglichen, auch erneut beim Export.
- Explizite Startfarbe, Anfangsstellung, Aufgabenziel und vollständiger Verlauf.
- Einstellbare eigene Zugzahl; Hauptlinie und Mindesttiefe separat bewiesen.
- Stärkste Gegenwehr im definierten Lebens-/Todesziel.
- Zwei verschiedene falsche erste Züge mit legalen, bewiesenen Folgen von
  höchstens vier Halbzügen bis zum bewiesenen Fehlerende; der Export prüft auch
  die angezeigte Fortsetzung. Keine abgeschnittenen längeren Beweisfolgen.
- Kyu 1–30. Eine unbekannte Einstufung darf nicht als 10–20 Kyu ausgegeben werden.
- Kommerzielle Verwendung des alten Originalinhalts ohne Pflichtnennung für
  die dokumentierten Gebiete; keine stillschweigende Freigabe moderner Antworten.
- Übertragbare Umgebung und weiteres Lernen aus tatsächlichem Nutzerfeedback.

Kyu-Einschätzungen können im Lab gespeichert werden. Eine automatische
Kalibrierung benutzt nur gut bewertete Aufgaben mit bewiesenem Verlauf und
mindestens 30 echte Einschätzungen aus 20 unabhängigen Kernen, ausreichendem
Rangbereich und bestandener Prüfung über komplett zurückgehaltene Familien.
Verschiedene Modellstände werden nicht ungeprüft zusammengelegt. **Aktuell gibt
es null solche Nutzerlabels und somit keine kalibrierte Kyu-Schätzung.**
Die Implementierung dieser Lernstrecke ersetzt die fehlenden Labels nicht.

Der Export verlangt die erneuten Lösungsprüfungen, Neuheit, Qualitätsurteil und
bewerteten oder ausreichend kalibrierten Kyu-Wert im gewünschten Band. Er
schreibt Anfangslage, explizite Startfarbe, Kyu, Hauptfolge und zwei Fehlerfolgen
nach JSON und SGF. **Aktueller produktionsfähiger Bestand neuer KI-Aufgaben: 0.**
Das Modell wird deshalb weiterhin als Forschungsstand ausgeliefert.

Nummern werden im Exportregister dauerhaft reserviert. Wiederexporte und
Teilmengen behalten ihre Nummern; neue IDs mit bereits exportierter Stellung,
demselben Kern oder Lösungsfußabdruck werden abgewiesen. Diese Prüfung ersetzt
keine professionelle semantische Abnahme. Der automatische Exporttest benutzt
ausdrücklich künstliche Teststellungen in temporären Ordnern, beide Farben und
echte Löserzertifikate; er erzeugt keine vorgetäuschten Nutzerbewertungen im Lab.

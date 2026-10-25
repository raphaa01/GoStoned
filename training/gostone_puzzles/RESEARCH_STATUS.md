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

**Nachtrag 26. Oktober:** Zwölf weitere Diagramme von Seite 101 wurden direkt
am Original gelesen, legal nachgespielt und in zwölf Browser-Screenshots mit
Ausgangslage, Druckziffern und tatsächlichem Ende verglichen. Drei davon sind
Spiegelungen anderer Diagramme. Der historische Bestand beträgt jetzt 113
Familien / 952 Zugbeispiele; 92 Familien / 773 Beispiele sind Training, 21
Familien / 179 Beispiele bleiben Prüfung. Die älteren Zahlen oben beschreiben
den vorherigen Stand. Ungeprüfte automatische Erkennungen wurden nicht importiert.

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
Diese Aussage beschreibt den damaligen Lebens-/Todesvergleich; der nachfolgende
Schlagwettlauf-Versuch erreichte inzwischen einen vollständigen Beweiskandidaten.

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

## Nachtrag: tatsächlicher Drei-Züge-Beweis und solverüberwachtes Lernen

Der neue Schlagwettlauf-Entwurf `6a268b9fd4f35b5ae35291d6` beginnt mit Weiß.
Er wurde von 28 auf 18 Steine verkleinert, mit erneuten vollständigen Beweisen
nach jedem akzeptierten Entfernen. Die Hauptfolge lautet 302, 284, 303, 265,
246 in nullbasierten 19×19-Koordinaten. Drei eigene Züge sind separat als
notwendig bewiesen. Alle 343 anderen legalen ersten Züge sind widerlegt;
die zwei angezeigten Fehlerfolgen enden jeweils nach zwei Halbzügen mit dem
tatsächlichen Verlust der eigenen markierten Gruppe. Ein Snapback, der die
gerettete Gruppe sofort in Atari ließe, gilt nicht automatisch als Erfolg.

Der Browser-Screenshot `GoStone-PuzzleAI-First-Proof/solution-and-refutations.png`
wurde tatsächlich betrachtet. Das Bild zeigt eine kompakte Ecke ohne große
künstliche Umfassungsmauer. Die Aufgabe ist dennoch eher elementar:
Agent-Einschätzung etwa 23 Kyu, unsicher 20–27, kein Nutzerlabel und keine
kalibrierte Einstufung. Der Lösungsfußabdruck ist in keiner gleich langen
zusammenhängenden Teilfolge der historischen Referenzen enthalten. **Eine
bestätigte Serie hochwertiger 10–20-Kyu-Aufgaben ist weiterhin nicht erreicht.**

Ein anschließender fortlaufender Versuch mit vier unterschiedlichen
Freiheitsprofilen untersuchte 7.707 weitere Vorschläge in 1.668,89 Sekunden
und fand keinen zusätzlichen vollständigen Beweiskandidaten. Der Lauf wurde
für die folgenden Modellversuche sauber gestoppt. Zwei fast vollständige
Entwürfe wurden separat länger untersucht: 300 beziehungsweise 331 zuvor
offene erste Züge ließen sich widerlegen, aber ein beziehungsweise zwei
blieben offen. Diese Stellungen bleiben gesperrt. Die neue gespeicherte
Gegenbeweis-Warteschlange vermeidet es, solche begonnenen Prüfungen bei jeder
Vorschlagsserie von vorn zu starten.

Ein neuronaler Reparaturversuch mit 1.200 Vorschlägen dauerte 685 Sekunden und
bewies 316 Gewinnstrategien beliebiger kürzerer Tiefe. Nur neun gespeicherte
Linien hatten drei eigene Züge. Der einzige scheinbar vollständige Erfolg
wiederholte exakt die fünf entscheidenden Halbzüge des vorhandenen Entwurfs
und wurde deshalb nicht als neues Puzzle übernommen. Das illustriert den
Unterschied zwischen verändertem Bild und neuem taktischem Inhalt.

Zwei weitere Modelle wurden tatsächlich trainiert: `joint-style-mix-64`
(1.000 zusätzliche Schritte, Kategorie in 25 % der Trainingsmasken verborgen)
und `joint-scans113-64` (1.500 zusätzliche Schritte auf allen 113 historischen
Familien, Kategorie in 15 % verborgen). Ihre besten Referenzzug-Top-1-Werte
waren 38,28 % und 40,63 %. Das ist **kein Qualitätsbeleg für erzeugte Aufgaben**.
Im gleich eingestellten 1.000er-Erzeugungsversuch pro Modell lieferte der
erste Stand einen Drei-Züge-Gewinn und der zweite keinen, jeweils null
vollständige neue Beweiskandidaten. Ein älterer Vergleichsstand lieferte drei
Drei-Züge-Gewinne, ebenfalls ohne vollständige Freigabe. Die neueren Gewichte
werden deshalb nicht allein aufgrund besserer Nachahmungswerte zum besseren
Puzzle-Generator erklärt.

Die neue Lernstrecke `harvest-proofs` prüft stattdessen eigene Gewinnstrategien
und ihre Mindestzugzahl erneut. Tatsächlich gesammelt wurden 199 verschiedene
Stellungen/Kerne: sieben mit einem, 167 mit zwei und 25 mit drei notwendigen
eigenen Zügen. Die 25 Drei-Züge-Beispiele haben 25 unterschiedliche vollständige
Lösungsfußabdrücke. Keine dieser Zahlen bedeutet Qualitäts- oder Kyu-Freigabe.
Nach Ausschluss der zurückgehaltenen historischen Elternfamilien verbleiben
127 Trainingsstellungen: vier / 110 / 13 nach eigener Zugzahl. Sie werden nach
Zugzahl ausgewogen beigemischt; 72 Beispiele bleiben vom Training ausgeschlossen.
Quellen, Beweise und Manifest werden separat von echten Nutzerbewertungen
gespeichert und beim Umgebungsexport erhalten. Der neue Lauf
`joint-proof-curriculum-64` hat diesen Ansatz inzwischen mit 1.500 zusätzlichen
Schritten in 505,25 Sekunden trainiert und wurde tatsächlich beim Erzeugen
geprüft. Der Stand nach 250 zusätzlichen Schritten ergab bei 1.000 Vorschlägen
einen Drei-Züge-Gewinn, aber keinen vollständigen neuen Beweiskandidaten. Der
letzte Stand ergab bei weiteren 1.000 Vorschlägen keinen Drei-Züge-Gewinn und
340 verworfene dichte Blöcke. Längeres Training war hier somit schlechter.

Zwei Abtastkorrekturen mit je 1.000 weiteren Vorschlägen und eine sequenzielle
Einzelfeld-Abtastung mit je 200 Vorschlägen für zwei Modelle brachten ebenfalls
keinen vollständigen neuen Kandidaten. Die volle Korrektur der Klassengewichte
reduzierte die dichten Blöcke von 340 auf 16, erzeugte aber oft zu leere Formen
ohne geeigneten Schlagwettlauf. Dieser bloße Zahlenfortschritt wird nicht als
Verbesserung der Puzzlequalität ausgegeben. Die Standardabtastung wurde deshalb
nicht auf diese Varianten umgestellt.

Vier tatsächlich betrachtete Browser-Screenshots unter
`GoStone-PuzzleAI-Decoder-Review` zeigen je sechs feste Geometrien ohne
übernommene Anfangssteine, einschließlich ungefilterter Fehlversuche. Die
frühen und späten Rohformen wirken häufig wie gefüllte Bänder beziehungsweise
Blöcke. Die korrigierte Abtastung wird teils leer oder erzeugt lose Steine;
die sequenzielle Variante macht kompaktere Formen, aber noch keine geprüften
Aufgaben. Die vorhandene kleine Modell- und Datenbasis trägt damit noch keine
zuverlässige starke Neuschöpfung. Der erste 18-Steine-Beweiskandidat bleibt
ein Einzelerfolg, keine abgeschlossene Lösung des Nutzerziels.

Die 952 historischen Zugübergänge und zusätzlich Hauptlinie sowie beide
Fehlerfolgen des 18-Steine-Entwurfs in beiden Farben wurden mit dem unabhängigen
TypeScript-Go-Regelkern verglichen: **970 übereinstimmende Übergänge**. Das
prüft Schlag- und Spielzustände, nicht unabhängig Benson, alle Superko-Historien
oder didaktische Qualität. Die exakten Beweiskontrollen bleiben zusätzlich nötig.

Nummern werden im Exportregister dauerhaft reserviert. Wiederexporte und
Teilmengen behalten ihre Nummern; neue IDs mit bereits exportierter Stellung,
demselben Kern oder Lösungsfußabdruck werden abgewiesen. Diese Prüfung ersetzt
keine professionelle semantische Abnahme. Der automatische Exporttest benutzt
ausdrücklich künstliche Teststellungen in temporären Ordnern, beide Farben und
echte Löserzertifikate; er erzeugt keine vorgetäuschten Nutzerbewertungen im Lab.

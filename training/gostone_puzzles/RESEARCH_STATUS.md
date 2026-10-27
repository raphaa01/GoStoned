# Abnahme des gewünschten starken Puzzle-Modells

Stand: 25. Oktober 2026. Dies ist ein tatsächlicher erster Forschungsdurchlauf,
kein Nachweis eines fertigen starken Puzzle-Komponisten.

| Anforderung | Stand |
| --- | --- |
| Lokales eigenes Modell statt KataGo als Generator | Zwei kleine eigene Modelle tatsächlich trainiert; kein KataGo verwendet |
| Historische Puzzle mit Lösungen als Trainingsmaterial | 97 Aufgaben, 97 Familien, 777 legale Zugbeispiele; 76 Trainings-/21 Prüffamilien |
| Alle ausgewählten Scans einbeziehen | 14 Originaldateien, 1.223 Seiten inventarisiert und geprüft heruntergeladen |
| Vollständige digitale Aufgaben und Lösungen aus allen Scans | **Nicht erreicht**: 666 PDF-Seiten gerendert, 937 ungeprüfte Diagrammvorschläge; Lösungsziffern/Kommentare nicht vollständig übertragen |
| Keine ungeklärten Quellen trainieren | Ungeklärte Ausgaben gesperrt; Erkennungsresultate nicht automatisch freigegeben |
| Beide Startfarben | In Daten, Modell, Erzeugung und Export enthalten |
| Drei bis fünf eigene Züge | Einstellbare Suchvorgabe; noch keine passende neue exportfähige Serie |
| Stärkste Gegenwehr | Vollbrett-AND/OR-Nachweise für die implementierten Ziele; bei unbekannten Antworten kein Puzzleexport |
| Zwei falsche Folgen bis vier Halbzüge | Datenformat und erneute Zertifikatsprüfung implementiert; keine ungeprüften Fehlfolgen als korrekt ausgegeben |
| Menschliche Kyu-Einstufung 1–30 | **Nicht erreicht**; Zielband wird nur gespeichert, kein Kyu erfunden |
| Wirkliche Vielfalt | Erste Kern-/Symmetrie-/Lösungsmusterfilter; noch keine umfassende kausale oder menschliche Vielfaltabnahme |
| Feedback und Weiterlernen | Gespeicherte Urteile, getrenntes Qualitätsziel, Optimizer/RNG-Resume und späteres Reranking |
| Auf anderen PC mitnehmbar | Umgebungsexport mit Manifest, optional eingebetteter Windows-x64-Laufzeit; separat praktisch zu prüfen |
| Sehr gute neue Aufgaben in großer Zahl | **Nicht erreicht** |

## Gemessener Vergleich

Zwei Netze mit jeweils 60.614 Parametern, 32 Kanälen und drei Residualblöcken,
je 1.000 Optimierungsschritte auf der CPU des Laptops. Historische Form-/Zug-
Nachahmung ist ein erster Test für den Datenpfad. Sie ersetzt keine Messung
neuer Puzzlequalität.

Auf derselben festen Stichprobe von 128 Zugbeispielen aus getrennten
Prüffamilien traf das gemeinsame Modell nach 1.000 Schritten 18,75 % der
historischen Referenzzüge, das reine Rekonstruktionsmodell 2,34 %. Nach zwei
getesteten Fortsetzungsschritten lag das gemeinsame Modell bei 20,31 %.
Die Prüfstichprobe ist klein; daraus wird weder eine Spielstärke noch eine
Generator-Gewinnerentscheidung abgeleitet.

Im kontrollierten Erzeugungsvergleich erhielt jeder Ansatz 60 Versuche mit
demselben Zufallsstart, drei eigenen Zügen und 0,5 Sekunden Suchbudget je
Suchaufruf. Jeder Ansatz hatte einen frischen Duplikatindex:

| Ansatz | Gewinnstrategie nachgewiesen, beliebige kürzere Tiefe | Exportfähig für die gesamten Vorgaben | Laufzeit |
| --- | ---: | ---: | ---: |
| Form und Lösungszug gemeinsam | 1 | 0 | 22,6 s |
| Nur Formrekonstruktion | 1 | 0 | 23,2 s |
| Zufallsänderungen | 0 | 0 | 19,4 s |

Kein Ansatz wird als Sieger für die Produktion erklärt. Der aktuelle
Vollbrett-Baseline-Löser ist für tiefe offene 19×19-Aufgaben zu langsam. Die
meisten Kandidaten bleiben ungeklärt. Ein längerer Lauf behebt weder die
geringe Datenmenge noch diesen Suchengpass.

## Visuelle Beobachtungen

Die erste echte Browser-Bildserie zeigt kompakte Kämpfe in verschiedenen
Brettecken statt der früheren dichten rechteckigen Umrandungen. Die
erzeugten Stellungen sind dennoch überwiegend Änderungen vorhandener
historischer Formen. Damit ist keine ausreichende Neuheit oder didaktische
Qualität nachgewiesen. Kandidaten bleiben ungeprüft und sind nicht für den
GoStone-Produktbestand freigegeben.

Bei den Scanbildern sind unter anderem um eine Linie verschobene Gitter und
nicht zuverlässig erkannte nummerierte Steine sichtbar. Diese Resultate dürfen
nicht als neue Trainingsaufgaben gezählt werden. Alte Schriftvarianten,
mehrere unabhängige Probleme pro 19×19-Diagramm und bei Schlagfolgen nicht mehr
sichtbare ursprüngliche Steine erschweren eine vollautomatische Übertragung.

## Noch erforderliche Entwicklungsarbeit

1. Historische Diagramme und sämtliche Lösungsangaben tatsächlich übertragen
   und visuell abgleichen. Mehr Varianten derselben Aufgabe bleiben eine Familie.
2. Einen korrekt implementierten Relevance-Zone-Löser entwickeln und dessen
   Ausschlussregeln getrennt prüfen. Das aktuelle Lab behauptet diese Technik
   ausdrücklich noch nicht zu implementieren.
3. Auf den erweiterten geprüften Daten größere Modellvarianten und stärkere
   zielgerichtete Suchprioren vergleichen. Ein größeres Netz allein wird nicht
   als Lösung für fehlende Daten behandelt.
4. Lösungstiefen von reinen Aufräumzügen trennen, andere Motive und schwierige
   offene Aufgaben unterstützen. Erst danach erweiterte Erzeugungsziele und
   rückwärts gerichtete Konstruktion experimentell vergleichen.
5. Mindestens 100 neue vollständig geprüfte Aufgaben visuell und durch starke
   Go-Spieler bewerten; erst dann tausend Aufgaben und menschliche
   Kyu-Kalibrierung anstreben.

Wissenschaftliche Grundlagen für die weitere Arbeit:

- RZS/FTL: <https://cdn.aaai.org/ojs/21278/21278-13-25291-1-2-20220628.pdf>
- Neuere Go-Analyse: <https://arxiv.org/html/2512.21365v1>
- Bedingte Schachaufgaben-Erzeugung: <https://arxiv.org/html/2609.38577v1>
- Vielfaltarchive: <https://www.proceedings.com/content/079/079017-2160open.pdf>

Die Veröffentlichungen begründen Forschungsentscheidungen. Sie verleihen
keine Nutzungserlaubnis für fremde Puzzle-Datensätze oder fremde Gewichte.

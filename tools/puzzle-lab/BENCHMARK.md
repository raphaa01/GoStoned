# Laptop-Messungen und Qualitätsprüfung

Gemessen am 14.10.2026 auf diesem Laptop: Windows, Intel Core 5 120U,
12 logische Kerne, rund 16 GB RAM, Node 24.13.0. Keine GPU, kein KataGo,
kein Cloud-Worker. Suchbudget: 750.000 Knoten und 1.500 ms je Kandidat.
Die Werte sind konkrete Stichproben; Ausbeute hängt von Seed, Startbestand,
Suchbudget und bereits ausgeschlossenen Motiven ab.

## Ausgangsversion und Suchoptimierung

Je 120 Sekunden, ein Worker pro Zugtiefe, drei gleichzeitig laufende Worker.
Identische Kandidatenfolge und Budgets, noch ohne erweiterten Generator:

| Eigene Züge | Versuche vorher | Versuche nach Cache-/Suchoptimierung | Veränderung |
| --- | ---: | ---: | ---: |
| 3 | 35.954 | 46.361 | +29 % |
| 4 | 721 | 1.072 | +49 % |
| 5 | 385 | 604 | +57 % |

Die Ausgangsversion behielt 8/1/1 geometrisch verschiedene Aufgaben. Mehrere
enthielten Pass-Verzögerungen. Die beiden ursprünglich als vier- bzw.
fünfzügig präsentierten Beispiele waren ohne weiße Pässe bereits in drei bzw.
vier Zügen lösbar. Eine schöne angezeigte Variante war kein ausreichender
Beleg für die behauptete taktische Tiefe. Beide alten Beispiele sind im
Laptop-Bestand als aussortiert markiert, ihre Dateien wurden erhalten.

## Optimierter Generator mit strengeren Qualitätsfiltern

Ein weiterer 120-Sekunden-Lauf verwendete zwei eigene, zuvor lokal erzeugte
Ausgangsstellungen für die adaptive Suche. Diese Ausgangsstellungen zählen
nicht als neue Aufgaben. Erweiterte Formen, Änderungen mehrerer innerer
Punkte, Wiederholungsfilter, Kernstellungsvergleich und die zusätzliche
Tiefenprüfung ohne weiße Pässe waren aktiv.

| Eigene Züge | Untersuchte Kandidaten | Neue unterschiedliche Aufgaben | Erste neue Aufgabe nach |
| --- | ---: | ---: | ---: |
| 3 | 51.427 | 44 | 0,25 s |
| 4 | 1.801 | 2 | 26,0 s |
| 5 | 785 | 1 | 54,5 s |

Alle 47 wurden anschließend frisch gelöst und mit der unabhängigen
Vollbrett-Regelengine geprüft. Der beobachtete maximale Prozess-RSS sank
von rund 1.129 MB auf 711 MB. RSS wird alle zehn Sekunden abgelesen;
dies ist kein kontinuierlich gemessener absoluter Spitzenwert.

Nach bevorzugter Auswahl von Ausgangsstellungen gleicher Tiefe lieferte ein
zusätzlicher Lauf mit dem 47er-Startbestand innerhalb der protokollierten
160 Sekunden **fünf neue vierzügige und eine neue fünfzügige Aufgabe**.
Er verwendete zwei Worker. Der Lauf wurde vor seinem ursprünglich gesetzten
300-Sekunden-Limit beendet; berichtet wird ausschließlich die gespeicherte
Messzeit. Auch diese sechs Aufgaben wurden erneut gelöst und vollständig
auf dem Vollbrett geprüft. Das ist kein identischer Eingabevergleich mit
dem ersten Lauf, sondern ein Test der Suche mit einem gewachsenen Bestand.

Ein abschließender echter Browser-Lauf erzeugte anschließend eine weitere
neue dreizügige Aufgabe in **9,621 Sekunden / 7.695 Versuchen**, obwohl der
vorhandene Bestand bereits als bekannt ausgeschlossen war. Er verwendete
zwei Worker, 300.000 Knoten und 250 ms pro Kandidat.

## Ergebnis und Grenzen

Der lokale Bestand enthält **54 aktuell geprüfte Aufgaben**:
45 dreizügige, sieben vierzügige, zwei fünfzügige. Die komplette Sammlung
bestand die erneute Tiefenprüfung, Dubletten-/Kernstellungsprüfung sowie
**9.008 unabhängige Vollbrett-Prüfknoten**, einschließlich aller Widerlegungen
und Lebens-Endstellungen. Ein 18-Aufgaben-Kontaktbogen wurde visuell geprüft.
Die Motive umfassen Opfer/Rückfang, mehrfaches Opfer und Abtrennen/Fangen.

Die Lösung muss gegen alle legalen weißen Kammer-Antworten funktionieren,
einschließlich Pass. Die automatische weiße Antwort maximiert die verbleibende
minimale schwarze Zugzahl; nach Fehlern verfolgt Weiß eine erzwungene
Lebensstrategie. Ein Test löst jede mögliche erste weiße Antwort separat
und vergleicht deren Tiefe mit der automatisch gewählten Verteidigung.
Im Browser wurden richtige Lösungen, sofortige Widerlegungen erster und
späterer Fehler, Freigabe/SGF-Export, Erzeugen und Pause/Fortsetzen getestet.

Die Aufgaben sind innerhalb dieses lokalen Fangformats korrekt und die
geprüften Formen unterscheiden sich. Das ist noch kein Nachweis für Tausende
didaktisch hervorragende Aufgaben oder eine breite Abdeckung sämtlicher
Go-Themen. Gerade vier/fünf Züge bleiben wesentlich seltener. Die anfängliche
Ausbeute darf wegen zunehmender Duplikate nicht linear auf große Bestände
hochgerechnet werden. **Kyu-Werte bleiben unkalibrierte Schätzungen.**

Rohberichte und Kandidaten dieses Tests liegen im isolierten Lab-Checkout
unter `.cache/benchmark-before`, `.cache/benchmark-cache`,
`.cache/benchmark-final` und `.cache/benchmark-hard`; der Kontaktbogen liegt
unter `.cache/visual-sample.html`/`.png`. Der Windows-Bestand liegt unter
`%LOCALAPPDATA%/GoStone/PuzzleLab`. Generierte Sammlungen werden nicht in Git
oder automatisch in die Produktions-App übernommen.

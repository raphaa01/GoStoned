# Lernpfad: Etappen 4–8

Die 31 bestehenden Lektionen in Etappen 1–3 bleiben wort- und positionsgleich.
Ein Fingerprint-Test schützt diesen Abschnitt. Die Erweiterung ergänzt 89 Knoten
im vorhandenen `LessonPlayer`, mit derselben Lehrerfigur, Sprechblase und Route.
Es gibt keine zweite Kursoberfläche und keine neuen Abhängigkeiten.

## Inhalt und Ausführung

- Etappe 4: konkrete taktische Stellungen, vollständige Leiter, Leiterbrecher,
  zwei Netz-Fluchten, echter Snapback, Schlagrennen und gemischte Aufgaben.
- Etappe 5: 9×9-Entscheidungen, Formen, Endspiel, Zählen, kommentierte Beispielpartie
  und eine echte Sieg-Prüfung. Eine Niederlage speichert den Versuch, nicht den Abschluss.
- Etappen 6 und 7: 13×13 beziehungsweise 19×19, lokal spielbare Beispiele zu
  Ecken, Seiten, Einfluss, Invasion, Zugrichtung; vollständige Bot-Partien.
- Etappe 8: Augenformen/Nakade mit Schlagfortsetzungen, Ko-Drohung und Rückschlag,
  Formen, Lesen, Kandidaten, Analyse-Arbeitsweise und abschließende 9×9-Partie.

`sequence()` erzeugt wiederherstellbare Stellungen durch echte Regelzüge und
bricht bei illegalen Fortsetzungen ab. Die UI bewahrt die Ko-Historie bei
Fortsetzungen. Zugantworten erscheinen erst nach einer expliziten Betätigung;
lange kommentierte Aufzeichnungen können in kleinen Gruppen weiterlaufen.
Die symmetrischen kommentierten 9×9/13×13-Aufzeichnungen lehren ausdrücklich den
Ablauf bis zur japanischen Wertung, nicht eine vermeintlich ideale Spielstrategie.

Strategieaufgaben akzeptieren mehrere passende Punkte, wo die Aufgabenstellung
mehrere zulässt. Sie behaupten keine Engine-optimalen Einzelzüge. Markieraufgaben
starten ohne Antwort-Overlay. Neue Zugaufgaben geben zuerst Text, nach zwei
Fehlversuchen einen Bereich und erst auf Wunsch nach drei Versuchen Zielpunkte.

## Gemeinsame Plattformen und Fortschritt

Website und Capacitor-Clients verwenden dieselben Komponenten und Datendefinitionen.
13×13/19×19 können für präzises Tippen vergrößert und verschoben werden;
der Steindurchmesser bleibt 92 Prozent des Gitterabstands.
Normale Bot-Züge bleiben im vorhandenen lokalen Browser-Worker mit
`GOSTONE_BOT_MODEL`; die serverseitige japanische Wertung prüft das vollständige
Zugprotokoll und die bestätigte Markierung. Neue Brettgrößen ändern weder Komi
noch Bewertungsregeln. Lernspiele besitzen kein Zurücknehmen und keine künstliche
Bot-Verzögerung. Nachbesprechungen enthalten höchstens drei reale Stellungen.

Die vorhandenen JSON-Fortschrittsfelder nehmen die neuen IDs auf; eine Migration
des Lernfortschritts ist nicht erforderlich. Alte Abschlüsse, Versuche und
Schrittnummern bleiben erhalten. Alle abgeschlossenen Lektionen bleiben wiederholbar.
Nach dem letzten Knoten führen Links zu Spielen, Brettaufgaben und eigener Analyse.

## Prüfung

`npm run test:learn-browser` spielt alle 120 Lektionen mit Touch-Eingaben durch,
einschließlich realer lokaler Bot-Partien, serverseitiger Wertung und gespeicherten
Abschlüssen. Der stärkere lokale Worker im Test ist ausschließlich der
Verifikationsspieler; der App-Gegner bleibt unverändert. Mobile-Tests verwenden
isolierte API-Fixtures, Website-Tests eine identitätsgeprüfte lokale PostgreSQL-DB.
Unit-Tests prüfen zusätzlich semantische Eigenschaften der Stellungen, nicht nur
die Existenz von Zielkoordinaten. Native iOS-Kompilierung benötigt macOS/Xcode;
ein getestetes gemeinsames Bundle ersetzt keine Behauptung eines App-Store-Releases.

Für die didaktische Kontrolle wurden die Begriffe mit den Primärquellen
[British Go Association](https://www.britgo.org/general/definitions.html) und
deren [Anfänger-Unterricht](https://www.britgo.org/organisers/handbook/club4)
abgeglichen. Texte und Stellungen sind eigenständig verfasst.

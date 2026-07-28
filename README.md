# GoStone

GoStone ist eine moderne Online-Plattform für Go, Baduk und Weiqi. Zwei Gäste können sich über die Matchmaking-Warteschlange finden und in getrennten Browsern gegeneinander spielen. Der Server prüft und speichert jeden Zug in PostgreSQL.

## Was bereits funktioniert

- Registrierung und Login mit Benutzername und Passwort
- sichere, serverseitige Sitzungen per HTTP-only Cookie
- getrennte Ratings pro Brettgröße für registrierte Accounts
- persistenter Gegner-Chat im fokussierten Spielraum
- serverseitige Chatmoderation gegen beleidigende, gefährliche und sensible Begriffe
- serverseitig ausgestellte Gast-Sitzungen per HTTP-only Cookie
- atomare, aktionsbezogene Missbrauchslimits für Authentifizierung, Matchmaking,
  Spielzüge, Chat und teure Datenbankabfragen
- Matchmaking für 9×9, 13×13 und 19×19
- Live-Partien über eine deploybare Polling-API
- auswählbare Blitz-, Rapid- und Classic-Uhren mit japanischem Byo-yomi
- serverseitige Zeitmessung und automatisch gespeicherter Sieg auf Zeit
- serverseitige Zugreihenfolge, Captures, Suicide- und Superko-Prüfung
- Pass, pausierte Wertungsphase nach zwei Pässen, beiderseitige
  Totstein-Bestätigung, Wiederaufnahme und Chinese Area Scoring
- dauerhaft gespeicherte Spiele, Züge, Ergebnisse und Statistiken
- responsive Desktop- und Mobile-Oberfläche
- lokale PostgreSQL-Datenbank mit Docker
- Vercel-kompatible Next.js Route Handlers
- Supabase-kompatible SQL-Migrationen und Row Level Security

Das Frontend spricht ausschließlich mit `app/api/**`. Nur `lib/db.ts` darf PostgreSQL über `pg` öffnen. Der Browser erhält niemals Datenbank-Zugangsdaten.

## Lokaler Start unter Windows

Voraussetzungen: [Node.js LTS](https://nodejs.org/) und [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```powershell
docker compose up -d
copy .env.example .env
npm install
npm run db:migrate
npm run dev
```

Unter macOS/Linux:

```bash
docker compose up -d
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

Danach öffnen:

- [http://localhost:3000](http://localhost:3000/)
- [http://localhost:3000/play](http://localhost:3000/play)
- [http://localhost:3000/api/health](http://localhost:3000/api/health)
- [http://localhost:3000/api/db-health](http://localhost:3000/api/db-health)

Für einen echten lokalen Test `/play` in zwei verschiedenen Browsern öffnen, zum Beispiel Chrome und Edge. In beiden dieselbe Brettgröße wählen und auf „Find an opponent“ klicken. Zwei normale Tabs desselben Browsers teilen absichtlich dieselbe Gast-ID; dafür stattdessen ein Inkognito-Fenster verwenden.

## Tests

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Wenn `npm run dev` und Docker laufen, testet dieser Befehl automatisch einen vollständigen Zwei-Spieler-Ablauf:

```powershell
npm run test:auth
npm run test:live
npm run test:clock
npm run test:rate-limit
npm run test:matchmaking-races
npm run test:player-report-races
npm run test:move-hash-db
npm run test:scoring-races
```

Diese mutierenden Smokes verlangen zusätzlich die expliziten Werte
`GOSTONE_SMOKE_DATABASE_NAME` und `GOSTONE_SMOKE_DATABASE_ROLE` aus
`.env.example`. Vor jeder Mutation gleichen sie diese Angaben mit der tatsächlich
verbundenen Datenbank und Rolle ab. Für `test:scoring-races` müssen im lokalen
PostgreSQL-Cluster außerdem die Supabase-kompatiblen Rollen `anon` und
`authenticated` als `NOLOGIN` existieren; der isolierte CI-Job legt sie immer
vor den Migrationen an. Die Smokes dürfen nur gegen eine entbehrliche lokale
Testdatenbank laufen, weil einige Abläufe absichtlich Fixtures zurücklassen.

`test:auth` prüft Registrierung, Login, Logout, Sitzungen, zwei registrierte
Spieler, Matchmaking, Chat und Resign. `test:live` prüft zusätzlich eine
vollständige Gastpartie einschließlich Wertungsstopp, Wiederaufnahme,
monotoner Wertungsrevision, Totstein-Markierung und beiderseitiger Bestätigung.
Außerdem weist der Test nach, dass eine Gast-Sitzung nicht als der andere
Spieler handeln kann.
`test:clock` erzwingt kontrolliert einen Zeitablauf und prüft das serverseitige
Ergebnis.
`test:rate-limit` startet 100 gleichzeitige Limit-Anfragen und prüft die atomare
Sperre sowie deren Ablauf. Der Test verändert Limit-Zeilen und verweigert deshalb
jede nicht-lokale `DATABASE_URL`; er darf niemals gegen Supabase oder Produktion
ausgeführt werden.
`test:scoring-races` prüft lokal konkurrierende Bestätigung/Wiederaufnahme- und
Bestätigung/Resign-Übergänge, exakt einen Rating-Ledger-Eintrag pro Spieler,
die automatische Wiederaufnahme nach Ablauf des Entscheidungsfensters sowie
die Datenbank-Constraints für beiderseitige Bestätigung. Auch dieser Test
verweigert jede nicht-lokale `DATABASE_URL`.

## Datenbank und Migrationen

`npm run db:migrate` führt alle noch nicht angewendeten Dateien aus
`db/migrations/` in Reihenfolge aus. Normale Migrationen und ihr Ledger-Eintrag
laufen jeweils in einer Transaktion. Ausdrücklich markierte, gleichzeitig
erstellte Indizes laufen außerhalb einer Transaktion; CI prüft deshalb zusätzlich
ihren `ready`- und `valid`-Status sowie einen unveränderten zweiten
Migrationsdurchlauf. Die Tabelle `schema_migrations` merkt sich den Stand.
`db/schema.sql` bleibt die lesbare, idempotente Darstellung des aktuellen
Gesamtschemas.

Migration `007_guest_sessions.sql` führt sichere, serverseitige Gast-Sitzungen
ein. Frühere, ausschließlich im Browser erzeugte Gast-IDs werden bewusst nicht
als Berechtigungsnachweis übernommen. Nach dem Rollout erhält ein abgemeldeter
Browser deshalb eine neue Gast-Identität und kann eine alte Gastpartie nicht
fortsetzen; ein unsicherer Kompatibilitäts-Fallback darf nicht ergänzt werden.
Beim Rollback darf deshalb nur auf eine Version zurückgegangen werden, die die
Cookie-basierte Autorisierung weiterhin erzwingt. Ein vollständiges Zurückrollen
auf die frühere Client-ID-Autorisierung würde die neuen Partien wieder für
Gast-Impersonation öffnen; falls keine sichere Zwischenversion verfügbar ist,
muss Gast-Spielbetrieb bis zur Korrektur pausiert werden.

Migration `008_chinese_scoring_agreement.sql` ersetzt die sofortige Wertung
nach zwei Pässen durch eine pausierte, gemeinsam bestätigte Wertungsphase. Sie
speichert die unveränderliche Brettposition, vollständige Totstein-Gruppen,
Bestätigungen, Punktdetails und eine monotone Wertungsrevision. Das aktivierte
Regelprofil ist ausdrücklich
[`chinese-2002-gostone-v1`](https://wqwh.weiqi.org.cn/rules/): Wer behauptet, dass eine
markierte Gruppe tot ist, spielt bei der Wiederaufnahme zuerst. Wer diese
Tot-Markierung bestreitet, lässt deshalb die Gegenseite zuerst spielen. Bleibt
die Wertungsphase zehn Minuten lang ungelöst, setzt GoStone die Partie ohne
Wertung automatisch in der normalen Zugreihenfolge fort. Japanische Wertung,
alternative chinesische Regelprofile und Handicap-Platzierung sind noch nicht
freigeschaltet.

Bereits vor Migration 008 gestartete oder beendete Partien behalten dagegen
das Profil `legacy-immediate-area`. Das gilt auch für Partien, die eine noch
laufende alte Anwendungsinstanz zwischen Datenbankmigration und
Anwendungswechsel erstellt. Die neue Matchmaking-Version aktiviert das neue
Profil pro Partie ausdrücklich; der Datenbankstandard bleibt in diesem
Expand-Schritt absichtlich auf `legacy-immediate-area`. Bei aktiven
Legacy-Partien leitet die neue Version Zugrecht und Passfolge aus dem
unveränderlichen Zugprotokoll ab, sodass Züge während dieses Rollout-Fensters
nicht zu einem doppelten Zug oder einem dritten erforderlichen Pass führen.

Die Migration ändert nur den Standard neuer Partien auf 7,5 Komi; gespeicherte
Komi- und Ergebniswerte historischer Partien werden nicht neu berechnet. Vor
dem Rollout muss geprüft werden, dass in Produktion ausschließlich
`rules='chinese'` gespeichert ist; andernfalls bricht die Migration bewusst ab.
Migration 008 ist die rückwärtskompatible Expand-Phase: Sie setzt noch keinen
strikten Lifecycle-Constraint, den die vorige Anwendung bei Abschluss einer
Partie verletzen würde. Ein solcher Contract-Schritt darf erst in einer späteren
Migration erfolgen, nachdem keine alte Instanz mehr Anfragen verarbeitet.

Der sichere Rollout ist deshalb: Migration 008 anwenden, die neue Anwendung
ausrollen, Health- und Zwei-Spieler-Smokes prüfen und erst danach in einer
eigenen späteren Migration über strengere Lifecycle-Constraints entscheiden.
Sobald die neue Anwendung eine Partie mit
`chinese-2002-gostone-v1` erstellt hat, ist ein Rollback auf eine alte
Anwendungsversion unsicher, weil diese die Wertungsphase nicht versteht. In
diesem Fall neue Partien stoppen und vorwärts korrigieren, statt Wertungszustände
zu löschen oder automatisch in laufende Partien umzuwandeln.

Mutierende Aktionslimits werden dauerhaft und getrennt nach der serverseitig
verifizierten Spieler-ID und der von Vercel gesetzten Client-Adresse geführt.
Hochfrequente Lesezugriffe verwenden bewusst pro Serverinstanz begrenzte
Actor-/IP-Zähler, damit normales Polling keine zusätzlichen PostgreSQL-Schreiblasten
erzeugt. Diese zweite Ebene ist ein Anwendungs-Guard und kein Ersatz für
plattformseitigen DDoS-Schutz. Gespeichert werden nur versionierte SHA-256-Schlüssel,
keine IP-Adressen, Cookies oder Spieler-IDs im Klartext. Polling-Anfragen laufen
einzeln, respektieren `Retry-After`, brechen veraltete Anfragen beim Verlassen ab
und werden in ausgeblendeten Tabs verlangsamt. Veraltete persistente Limit-Zeilen
werden bei der Erstellung neuer Gast-Sitzungen in kleinen, sperrarmen Batches
entfernt.

Docker prüfen oder stoppen:

```powershell
docker compose ps
docker compose down
```

`docker compose down -v` löscht zusätzlich alle lokalen Datenbankdaten und sollte nur bewusst verwendet werden.

## Supabase einrichten

1. In Supabase ein neues Projekt erstellen.
2. Im SQL Editor die Dateien aus `db/migrations/` in nummerierter Reihenfolge ausführen. Alternativ lokal `DATABASE_URL` vorübergehend auf die direkte Supabase-Verbindung oder den Session-Pooler (normalerweise Port `5432`) setzen und `npm run db:migrate` ausführen. Der Migrations-Runner lehnt Transaction-Pooler-Verbindungen wie Port `6543` ab, weil sein sitzungsgebundener Lock dort nicht sicher wäre.
3. Unter „Connect“ den Transaction-Pooler-Connection-String kopieren. Für Vercel ist normalerweise Port `6543` passend.
4. Den Platzhalter für das Datenbankpasswort ersetzen und den vollständigen String als `DATABASE_URL` in Vercel speichern.
5. `DATABASE_POOL_MAX=3` ebenfalls als Environment Variable setzen.

Die öffentlichen Tabellen haben Row Level Security aktiviert und geben den Supabase-Rollen `anon` und `authenticated` keine direkten Tabellenrechte. GoStone nutzt die Datenbank nur serverseitig über `pg`.

Keine produktive URL und kein Passwort gehören in `.env.example`, Git oder einen Screenshot.

## Vercel deployen

1. Das GitHub-Repository in Vercel importieren.
2. Framework „Next.js“ verwenden; Build Command bleibt `npm run build`.
3. In „Environment Variables“ folgende Werte hinterlegen:
   - `DATABASE_URL`: Supabase Transaction Pooler, normalerweise Port `6543`
   - `DATABASE_POOL_MAX=3`
   - `NEXT_PUBLIC_APP_URL`: die endgültige `https://`-Adresse der Website
   - `LEGAL_NAME`: vollständiger Name des Betreibers
   - `LEGAL_STREET`: Straße und Hausnummer
   - `LEGAL_CITY`: Postleitzahl und Ort
   - `LEGAL_EMAIL`: erreichbare Kontaktadresse
   - optional: `LEGAL_ENTITY_DETAILS`, `LEGAL_PHONE`, `LEGAL_VAT_ID`
4. Vor dem ersten Deployment die Migrationen gegen Supabase ausführen.
5. Deploy starten und anschließend `/api/health`, `/api/db-health` und einen Test mit zwei Browsern prüfen.

Der Build benötigt keine aktive Datenbankverbindung. API-Routen laufen mit der Node.js Runtime und verbinden sich erst bei einer Anfrage mit PostgreSQL.

Vor dem Produktionsstart kann die vollständige Konfiguration einschließlich
SSL-Verbindung, Migrationen und Impressumsangaben geprüft werden:

```powershell
vercel env run -e production -- npm run mvp:check
```

Der Check bricht bewusst ab, wenn noch eine lokale Datenbank, eine unverschlüsselte
URL, fehlende Tabellen oder unvollständige Betreiberangaben verwendet werden.

## Projektstruktur

- `app/` – Seiten und serverseitige APIs
- `components/` – UI, Brett und Spielansicht
- `lib/db.ts` – einzige PostgreSQL-Verbindung
- `lib/game/` – React-unabhängige Regeln und serverseitiger Game Service
- `lib/matchmaking/` – transaktionales PostgreSQL-Matchmaking
- `db/migrations/` – versionierte Datenbankänderungen
- `scripts/` – Migration und Live-Smoke-Test

## Zusammenarbeit über GitHub

`main` bleibt stabil. Jede Aufgabe bekommt einen eigenen Branch, zum Beispiel `codex/chat`. Vor Änderungen zuerst den aktuellen Stand von `main` holen. Danach nur den eigenen Branch pushen und einen Pull Request öffnen. Die verbindlichen automatischen Regeln stehen in `AGENTS.md`.

## Mobile Strategie

Die Website ist bereits responsive und API-basiert. Eine spätere PWA, Capacitor-App oder React-Native/Expo-App kann dieselben APIs verwenden. Persistente Spiellogik bleibt dabei weiterhin auf dem Server.

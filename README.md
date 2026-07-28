# GoStone

GoStone ist eine moderne Online-Plattform für Go, Baduk und Weiqi. Zwei Gäste können sich über die Matchmaking-Warteschlange finden und in getrennten Browsern gegeneinander spielen. Der Server prüft und speichert jeden Zug in PostgreSQL.

## Was bereits funktioniert

- Registrierung und Login mit Benutzername und Passwort
- sichere, serverseitige Sitzungen per HTTP-only Cookie
- getrennte Ratings pro Brettgröße für registrierte Accounts
- persistenter Gegner-Chat im fokussierten Spielraum
- serverseitige Chatmoderation gegen beleidigende, gefährliche und sensible Begriffe
- serverseitig ausgestellte Gast-Sitzungen per HTTP-only Cookie
- Matchmaking für 9×9, 13×13 und 19×19
- Live-Partien über eine deploybare Polling-API
- auswählbare Blitz-, Rapid- und Classic-Uhren mit japanischem Byo-yomi
- serverseitige Zeitmessung und automatisch gespeicherter Sieg auf Zeit
- serverseitige Zugreihenfolge, Captures, Suicide- und Superko-Prüfung
- Pass, zwei aufeinanderfolgende Pässe, Chinese Area Scoring und Resign
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
```

`test:auth` prüft Registrierung, Login, Logout, Sitzungen, zwei registrierte
Spieler, Matchmaking, Chat und Resign. `test:live` prüft zusätzlich eine
vollständige Gastpartie mit serverseitiger Wertung und weist nach, dass eine
Gast-Sitzung nicht als der andere Spieler handeln kann.
`test:clock` erzwingt kontrolliert einen Zeitablauf und prüft das serverseitige
Ergebnis.

## Datenbank und Migrationen

`npm run db:migrate` führt alle noch nicht angewendeten Dateien aus `db/migrations/` in Reihenfolge und jeweils in einer Transaktion aus. Die Tabelle `schema_migrations` merkt sich den Stand. `db/schema.sql` bleibt die lesbare, idempotente Darstellung des aktuellen Gesamtschemas.

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

Docker prüfen oder stoppen:

```powershell
docker compose ps
docker compose down
```

`docker compose down -v` löscht zusätzlich alle lokalen Datenbankdaten und sollte nur bewusst verwendet werden.

## Supabase einrichten

1. In Supabase ein neues Projekt erstellen.
2. Im SQL Editor die Dateien aus `db/migrations/` in nummerierter Reihenfolge ausführen. Alternativ lokal `DATABASE_URL` auf die direkte Supabase-Verbindung setzen und `npm run db:migrate` ausführen.
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

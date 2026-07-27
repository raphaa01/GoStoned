# GoStoned

GoStoned ist eine moderne Online-Plattform für Go, Baduk und Weiqi. Frontend und serverseitige API-Routen liegen gemeinsam in einer Next.js-App; dauerhafte Spiel-, Zug- und Statistikdaten werden in PostgreSQL gespeichert.

## Tech Stack

- Next.js 16 mit App Router, React und TypeScript
- PostgreSQL 16
- `pg` als zentraler PostgreSQL-Client — kein Prisma
- Docker Compose für die lokale Datenbank
- SQL-Schema und versionierte Migrationen
- später Vercel mit Neon oder Supabase

## Architektur

- `app/` enthält Seiten und serverseitige Route Handlers.
- `components/` enthält wiederverwendbare UI-Komponenten.
- `lib/db.ts` ist die einzige zentrale PostgreSQL-Verbindung.
- `lib/game/` enthält React-unabhängige Spiellogik.
- `db/schema.sql` ist das idempotente Basisschema.
- `db/migrations/` enthält versionierte SQL-Änderungen.
- `scripts/migrate.ts` lädt `.env` und wendet `db/schema.sql` an.

Das Frontend greift niemals direkt auf PostgreSQL zu. Alle Verbindungen verwenden ausschließlich `DATABASE_URL`.

## Lokaler Start unter Windows

Voraussetzungen: Node.js und Docker Desktop.

```powershell
docker compose up -d
copy .env.example .env
npm install
npm run db:migrate
npm run dev
```

Anschließend testen:

- [http://localhost:3000](http://localhost:3000/)
- [http://localhost:3000/api/health](http://localhost:3000/api/health)
- [http://localhost:3000/api/db-health](http://localhost:3000/api/db-health)

Unter macOS/Linux wird statt `copy` dieser Befehl verwendet:

```bash
cp .env.example .env
```

## Docker verwalten

Laufende Container prüfen:

```powershell
docker ps
```

Lokale Datenbank stoppen:

```powershell
docker compose down
```

Lokale Datenbank einschließlich aller Daten vollständig löschen:

```powershell
docker compose down -v
```

`docker compose up -d` startet ausschließlich die lokale PostgreSQL-Datenbank. GitHub speichert den Quellcode, aber keine Datenbankdaten oder Docker-Volumes.

## Scripts

| Script | Aufgabe |
| --- | --- |
| `npm run dev` | Entwicklungsserver starten |
| `npm run build` | Production-Build erstellen |
| `npm start` | Production-Server starten |
| `npm run typecheck` | TypeScript prüfen |
| `npm run lint` | ESLint ausführen |
| `npm test` | Go-Engine testen |
| `npm run db:migrate` | `db/schema.sql` auf `DATABASE_URL` anwenden |

## API-Status

- `GET /api/health` liefert den Status der GoStoned-Anwendung.
- `GET /api/db-health` führt über `lib/db.ts` eine echte `SELECT NOW()`-Abfrage aus.

## Environment und Secrets

Für die lokale Entwicklung wird `.env.example` nach `.env` kopiert. `.env` ist absichtlich von Git ausgeschlossen und darf niemals committed werden. Zugangsdaten, Tokens und produktive Connection Strings gehören nicht ins Repository.

Beim späteren Deployment wird `DATABASE_URL` von Neon oder Supabase als Environment-Variable in Vercel hinterlegt. Im Anwendungscode werden weder lokale noch produktive Datenbank-URLs hardcodiert.

## Zusammenarbeit

`main` bleibt stabil. Änderungen erfolgen auf kleinen Feature-Branches und werden vor einem Pull Request mindestens mit `npm run typecheck` und `npm run build` geprüft. Weitere verbindliche Regeln stehen in `AGENTS.md`.

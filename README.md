# Studio Riff : API de réservation

API de réservation des salles de répétition de l'association Studio Riff.
Node 22 · TypeScript · Express 5 · PostgreSQL 17 · Valkey 8.

## Prérequis
Node.js ≥ 22, Docker avec Compose.

## Démarrage

```bash
cp .env.example .env                 # à adapter : changez le mot de passe
docker compose up -d --wait          # PostgreSQL + Valkey
npm install
npm run db:migrate                   # applique migrations/*.sql sur la base vide
npm run db:seed                      # insère les données de départ
npm start                            # API sur http://localhost:3000
```

Essai rapide : `curl localhost:3000/rooms`

## Tests

Les tests HTTP utilisent une base dédiée (`TEST_DATABASE_URL`), **vidée à chaque test** puis ré-alimentée avec les données de départ. Horloge fixée au lundi 2 novembre 2026, 9 h.

```bash
docker compose exec postgres createdb -U studio studio_riff_test   # une seule fois
npm test                       # unitaires + HTTP (les migrations de la base de test sont appliquées automatiquement)
npm run typecheck
```

Les tests de cache ont besoin de Valkey (lancé par `docker compose up`).

## Mesure de l'index

```bash
./scripts/bench.sh        # base dédiée studio_riff_bench, 100 000 réservations, EXPLAIN ANALYZE avant/après
```

## Sauvegarde / restauration

```bash
./backup.sh                                          # backups/studio_riff_<date>.dump
./restore.sh backups/<fichier>.dump                  # restaure dans studio_riff_restore et compare les lignes
```

## Arborescence

```
src/domain   règles métier, service, ports (aucune dépendance HTTP/SQL)
src/infra    PostgreSQL (pg), Valkey, migrations, seed
src/http     Express : parsing, appel du service, codes de statut
migrations   SQL versionné
tests        unit/ (règles, horloge fixe) · http/ (routes, base réelle)
```

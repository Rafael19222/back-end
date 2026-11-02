#!/usr/bin/env bash
# Mesure avant/après index sur 100 000 réservations, dans une base dédiée (studio_riff_bench).
# Sortie complète dans bench-output.txt, à copier dans REPORT.md.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

BENCH="${POSTGRES_DB}_bench"
psql_() { docker compose exec -T postgres psql -U "$POSTGRES_USER" -v ON_ERROR_STOP=1 "$@"; }

{
  psql_ -d postgres -c "DROP DATABASE IF EXISTS $BENCH" -c "CREATE DATABASE $BENCH"
  psql_ -d "$BENCH" < migrations/001_init.sql   # schéma SANS index secondaire
  psql_ -d "$BENCH" <<'SQL'
INSERT INTO rooms (id, name, capacity) SELECT 'room-' || n, 'Salle ' || n, 5 FROM generate_series(1, 4) n;
INSERT INTO members (id, name) SELECT 'member-' || n, 'Membre ' || n FROM generate_series(1, 3) n;
INSERT INTO bookings (id, room_id, member_id, start_at, end_at, status)
SELECT
  'gen-' || g,
  'room-' || (g % 4 + 1),
  'member-' || (g % 3 + 1),
  timestamptz '2027-01-01 10:00+00' + (g / 52) * interval '1 day' + (g / 4 % 13) * interval '1 hour',
  timestamptz '2027-01-01 11:00+00' + (g / 52) * interval '1 day' + (g / 4 % 13) * interval '1 hour',
  'confirmed'
FROM generate_series(0, 99999) AS g;
ANALYZE bookings;
SELECT count(*) AS total_bookings FROM bookings;
SQL

  echo; echo "===== AVANT index ====="
  { echo "EXPLAIN ANALYZE"; cat scripts/planning-query.sql; } | psql_ -d "$BENCH"

  psql_ -d "$BENCH" < migrations/002_indexes.sql
  psql_ -d "$BENCH" -c "ANALYZE bookings"

  echo; echo "===== APRES index ====="
  { echo "EXPLAIN ANALYZE"; cat scripts/planning-query.sql; } | psql_ -d "$BENCH"
} 2>&1 | tee bench-output.txt

#!/usr/bin/env bash
# Usage : ./restore.sh backups/xxx.dump [nom_de_la_nouvelle_base]
# Restaure dans une NOUVELLE base (jamais la base d'origine), puis compare les nombres de lignes.
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a

DUMP="${1:?usage: ./restore.sh <fichier.dump> [nouvelle_base]}"
TARGET="${2:-${POSTGRES_DB}_restore}"
[ -f "$DUMP" ] || { echo "Fichier introuvable : $DUMP" >&2; exit 1; }
[ "$TARGET" != "$POSTGRES_DB" ] || { echo "Refus : la cible ne doit pas être la base d'origine." >&2; exit 1; }

pg() { docker compose exec -T postgres "$@"; }

pg dropdb -U "$POSTGRES_USER" --if-exists "$TARGET"
pg createdb -U "$POSTGRES_USER" "$TARGET"
pg pg_restore -U "$POSTGRES_USER" -d "$TARGET" --no-owner --exit-on-error < "$DUMP"

echo
printf '%-10s %12s %12s\n' table "$POSTGRES_DB" "$TARGET"
status=0
for t in rooms members bookings; do
  a=$(pg psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM $t")
  b=$(pg psql -U "$POSTGRES_USER" -d "$TARGET" -tAc "SELECT count(*) FROM $t")
  printf '%-10s %12s %12s %s\n' "$t" "$a" "$b" "$([ "$a" = "$b" ] && echo OK || echo DIFFERENT)"
  [ "$a" = "$b" ] || status=1
done
exit $status

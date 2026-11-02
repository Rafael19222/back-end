#!/usr/bin/env bash
# Sauvegarde logique de la base (format custom). Rétention : 30 jours.
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a

RETENTION_DAYS="${RETENTION_DAYS:-30}"
mkdir -p backups
FILE="backups/${POSTGRES_DB}_$(date -u +%Y%m%dT%H%M%SZ).dump"

docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > "$FILE"
echo "Sauvegarde écrite : $FILE ($(du -h "$FILE" | cut -f1))"

find backups -name '*.dump' -mtime +"$RETENTION_DAYS" -print -delete | sed 's/^/Supprimée (rétention) : /'

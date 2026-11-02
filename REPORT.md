# REPORT

> Les sections « Sortie » contiennent les résultats obtenus avec `./scripts/bench.sh`, `./backup.sh` et `./restore.sh`. Sous Windows, ces scripts ont été lancés avec Git Bash ; ils exécutent leurs commandes PostgreSQL via `docker compose`.

## 1. Mesure avant / après index (100 000 réservations)

Requête (`scripts/planning-query.sql`) : planning de `room-1` du 1er au 8 mars 2027.

### Avant l'index

```
===== AVANT index =====
Sort  (cost=3272.85..3274.87 rows=805 width=59) (actual time=11.734..11.742 rows=91 loops=1)
  Sort Key: start_at
  Sort Method: quicksort  Memory: 32kB
  ->  Seq Scan on bookings  (cost=0.00..3234.00 rows=805 width=59) (actual time=0.339..11.688 rows=91 loops=1)
        Filter: ((start_at < '2027-03-08 00:00:00+00'::timestamp with time zone) AND (end_at > '2027-03-01 00:00:00+00'::timestamp with time zone) AND (room_id = 'room-1'::text) AND (status = 'confirmed'::text))
        Rows Removed by Filter: 99909
  Planning Time: 0.518 ms
  Execution Time: 11.855 ms
```

### Après `CREATE INDEX bookings_room_start ON bookings (room_id, start_at)`

```
===== APRES index =====
Sort  (cost=1256.77..1258.85 rows=830 width=59) (actual time=0.243..0.247 rows=91 loops=1)
  Sort Key: start_at
  Sort Method: quicksort  Memory: 32kB
  ->  Bitmap Heap Scan on bookings  (cost=25.19..1216.53 rows=830 width=59) (actual time=0.191..0.206 rows=91 loops=1)
        Recheck Cond: ((room_id = 'room-1'::text) AND (start_at < '2027-03-08 00:00:00+00'::timestamp with time zone))
        Filter: ((end_at > '2027-03-01 00:00:00+00'::timestamp with time zone) AND (status = 'confirmed'::text))
        Rows Removed by Filter: 767
        Heap Blocks: exact=42
        ->  Bitmap Index Scan on bookings_room_start  (cost=0.00..24.98 rows=856 width=0) (actual time=0.066..0.066 rows=858 loops=1)
              Index Cond: ((room_id = 'room-1'::text) AND (start_at < '2027-03-08 00:00:00+00'::timestamp with time zone))
  Planning Time: 0.624 ms
  Execution Time: 0.292 ms
```

**Lecture** : sans index, PostgreSQL lit toute la table et écarte 99 909 lignes. Avec l'index sur `(room_id, start_at)`, il utilise un Bitmap Index Scan puis filtre `end_at`. Le temps mesuré passe de 11.855 ms à 0.292 ms sur cette exécution.

## 2. Répartition PostgreSQL / Valkey

**Dans Valkey (cache clé-valeur)** : données *dérivées, reconstructibles, éphémères*, lues souvent :
- réponses de `GET /rooms/:id/bookings` (clé `planning:{room}:v{ver}:{from|to}`, TTL 60 s) ;
- compteurs de version d'invalidation ;
- éventuellement : compteurs de limitation de débit, sessions.
Perdre tout Valkey ne coûte qu'un rechargement depuis PostgreSQL.

**Dans PostgreSQL** : données *de référence*, qui doivent être durables et cohérentes : salles, membres, réservations (et leur historique d'annulation).

**Les réservations pourraient-elles être stockées dans Valkey ?** Techniquement oui (hash par réservation, sorted set par salle), mais ce serait un mauvais choix ici :
- pas de contrainte d'exclusion : l'anti-chevauchement et le quota devraient être recodés avec `WATCH`/Lua, plus fragile que la contrainte déclarative ;
- pas de transactions multi-clés équivalentes ni de requêtes relationnelles (historique d'un membre, annulations, jointures) ;
- durabilité plus faible par défaut (RDB/AOF : fenêtre de perte), alors qu'une réservation perdue = deux groupes dans la même salle, le problème d'origine.

**Taille de l'association** : 4 salles, 3 membres de départ, au plus ~13 créneaux par jour et par salle, soit au pire quelques milliers de réservations par an. Une seule instance PostgreSQL suffit largement ; le cache n'est utile qu'en cas de pics de consultation du planning, et ne justifie pas de migrer les données de référence vers une base clé-valeur ni d'ajouter de la haute disponibilité.

## 3. Sauvegarde et restauration

### Sortie de `./backup.sh` puis `./restore.sh backups/<fichier>.dump`

```
Sauvegarde écrite : backups/studio_riff_20261102T130549Z.dump (8,0K)

table       studio_riff studio_riff_restore
rooms                 4            4 OK
members               3            3 OK
bookings              4            4 OK
```

La restauration se fait dans une **nouvelle base** (`studio_riff_restore`) ; `restore.sh` refuse de cibler la base d'origine.

### Objectifs

| Indicateur | Valeur | Justification |
|---|---|---|
| **RPO** (perte de données tolérable) | **24 h** | Sauvegarde quotidienne (nuit, hors créneaux 10 h-23 h). Le volume est de quelques réservations par jour : en cas de perte, les membres peuvent les ressaisir et l'association peut les retrouver (messages, mails). Une banque viserait quelques secondes (réplication synchrone) ; ce n'est pas proportionné ici. |
| **RTO** (durée de remise en service) | **4 h** | Restauration d'un dump de quelques Mo en quelques minutes ; la marge couvre la réaction d'un bénévole, pas d'astreinte 24 h/24. L'activité reprend avant le soir (créneaux dès 10 h). |
| **Rétention** | **30 jours** de sauvegardes quotidiennes | Permet de remonter à une erreur découverte tardivement (suppression, mauvaise manipulation) sans accumuler : un dump pèse quelques Mo. `backup.sh` supprime les fichiers plus vieux que `RETENTION_DAYS` (30 par défaut). Recommandation : copier aussi le dossier `backups/` hors de la machine (autre disque / cloud). |

# DECISIONS

## 1. Où vit chaque règle métier

| Règle | Où | Pourquoi |
|---|---|---|
| Créneau de 1 h à 4 h, heure pleine, début entre 10 h et 23 h | `domain/rules.ts › validateSlot` | Règle pure sur deux dates : testable sans base ni HTTP. Erreur → 400. |
| Pas de chevauchement dans une salle | **Base** : contrainte `EXCLUDE USING gist` (`room_id WITH =`, `tstzrange(start_at, end_at, '[)') WITH &&`) ; l'adaptateur PostgreSQL traduit l'erreur `23P01` en `slot_taken`, puis le domaine HTTP renvoie 409 | Deux requêtes simultanées passent chacune un « SELECT puis INSERT ». Seule la base peut trancher atomiquement. `'[)'` autorise un créneau qui commence à l'heure exacte où le précédent finit. |
| Au plus 2 réservations à venir par membre | `domain/rules.ts › assertQuotaAllowsNewBooking` (décision) + `service.createBooking` (orchestration) + **verrou** `SELECT … FOR UPDATE` sur la ligne du membre | Cette règle porte sur *plusieurs lignes* : ni CHECK ni UNIQUE ne peuvent l'exprimer. Le comptage seul est sujet à une course (2 requêtes lisent « 1 », insèrent chacune). Le verrou sur le membre sérialise les créations d'un même membre sans bloquer les autres. Le compte et l'insertion ont lieu dans la même transaction. |
| Annulation conservée, `cancelled` / `late_cancelled` (< 24 h) | `rules.ts › decideCancellation(booking, now)` | Dépend de l'heure : `now` est un paramètre, fourni par `Clock` (fixé à 2 nov. 2026, 9 h en test). |
| Pas de double annulation | `decideCancellation` + `SELECT … FOR UPDATE` sur la réservation | Le verrou évite deux annulations simultanées qui lisent toutes deux « confirmed ». → 409. |
| Salle en maintenance | `rules.ts › assertRoomAvailable` | Test de chevauchement d'intervalles sur des données de la salle. → 409. |
| Heures en UTC | `http/parse.ts` (n'accepte que `…Z`) + colonnes `timestamptz` | Évite toute ambiguïté de fuseau à l'entrée ; la sortie est toujours en UTC. |

Choix d'interprétation :
- Une réservation *annulée* libère le créneau (la contrainte d'exclusion ne s'applique qu'aux `confirmed`), tout en restant en base.
- « À venir » = `confirmed` et `start_at > now`.
- `GET /rooms/:id/bookings` renvoie le planning des réservations **confirmées** (filtrable avec `from` / `to`) ; `GET /members/:id/bookings` renvoie tout l'historique, annulations comprises.
- Ordre des contrôles à la création : salle (404) → créneau (400) → membre (404) → maintenance (409) → quota (409) → chevauchement (409).

## 2. Couches

```
          HTTP (Express)            src/http     parse l'entrée, appelle le service, mappe DomainError → 400/404/409
               │
               ▼
        BookingService + rules      src/domain   règles, orchestration, Clock ; ne connaît que des interfaces (ports)
               │  (ports : UnitOfWork, BookingQueries, PlanningCache)
       ┌───────┴────────┐
       ▼                ▼
   PostgreSQL (pg)    Valkey (ioredis)   src/infra   implémentent les ports
```

Dépendances : `http → domain ← infra`. Le domaine n'importe ni `express`, ni `pg`, ni `ioredis`.

## 3. Modèle relationnel

```
rooms(id PK, name, capacity, maintenance_start NULL, maintenance_end NULL)
members(id PK, name)
bookings(id PK, room_id FK→rooms, member_id FK→members, start_at, end_at,
         status CHECK IN (confirmed, cancelled, late_cancelled), created_at)
  CHECK end_at > start_at
  EXCLUDE USING gist (room_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE status = 'confirmed'
  INDEX (room_id, start_at)   -- planning d'une salle
  INDEX (member_id, start_at) -- quota et historique d'un membre
```

## ADR-1 : `pg` (node-postgres) sans ORM

- **Contexte** : 3 tables, 6 routes, mais des fonctionnalités spécifiques à PostgreSQL (contrainte d'exclusion, `FOR UPDATE`, `tstzrange`, code d'erreur `23P01`).
- **Décision** : driver `pg` et SQL écrit à la main derrière des interfaces du domaine.
- **Raisons** : le SQL important (verrous, exclusion) reste visible et contrôlé ; un ORM masquerait les verrous et compliquerait la gestion de la contrainte d'exclusion ; peu de requêtes, donc peu de code répétitif.
- **Conséquences** : mapping ligne → objet fait à la main (10 lignes) ; migrations en SQL pur (`migrations/*.sql`, table `schema_migrations`).

## ADR-2 : invalidation du cache par numéro de version

- **Contexte** : le planning d'une salle est mis en cache (clé dépendant de `from`/`to`). Une réservation ou une annulation doit apparaître immédiatement.
- **Décision** : un compteur `planning:ver:{room}` est incrémenté à chaque écriture ; les clés de données incluent cette version (`planning:{room}:v{ver}:{from|to}`) et ont un TTL de 60 s.
- **Raisons** : on ne peut pas énumérer facilement toutes les combinaisons `from|to` à supprimer (`SCAN` est coûteux). Un simple `INCR` rend toutes les anciennes entrées inaccessibles d'un coup, et elles expirent seules. La version est lue *avant* la requête SQL : une écriture concurrente rend l'entrée obsolète sans risque de servir un planning périmé.
- **Valkey indisponible** : toutes les opérations sont dans un `try/catch`, la lecture retombe sur PostgreSQL. Limite connue : si Valkey est down pendant une écriture, l'invalidation est perdue ; le TTL de 60 s borne l'obsolescence.

## ADR-3 : refus du pattern CQRS / event sourcing

- **Contexte** : lecture du planning plus fréquente que l'écriture, tentation de séparer modèles de lecture et d'écriture.
- **Décision** : refusé. Un seul modèle, une seule base, un cache simple devant la lecture.
- **Raisons** : ~4 salles, quelques milliers de réservations par an ; le surcoût (projections, cohérence à terme) dépasse largement le bénéfice, et la cohérence immédiate est exigée par le sujet.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE rooms (
  id                text PRIMARY KEY,
  name              text NOT NULL,
  capacity          integer NOT NULL CHECK (capacity > 0),
  maintenance_start timestamptz,
  maintenance_end   timestamptz,
  CONSTRAINT maintenance_consistent CHECK (
    (maintenance_start IS NULL AND maintenance_end IS NULL)
    OR (maintenance_start IS NOT NULL AND maintenance_end > maintenance_start)
  )
);

CREATE TABLE members (
  id   text PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE bookings (
  id         text PRIMARY KEY,
  room_id    text NOT NULL REFERENCES rooms (id),
  member_id  text NOT NULL REFERENCES members (id),
  start_at   timestamptz NOT NULL,
  end_at     timestamptz NOT NULL,
  status     text NOT NULL DEFAULT 'confirmed'
             CHECK (status IN ('confirmed', 'cancelled', 'late_cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT end_after_start CHECK (end_at > start_at),
  -- Filet de sécurité : deux réservations confirmées d'une même salle ne se chevauchent jamais.
  -- '[)' => un créneau peut commencer pile quand le précédent finit.
  -- WHERE confirmed => une annulation libère le créneau mais reste enregistrée.
  CONSTRAINT no_overlap EXCLUDE USING gist (
    room_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (status = 'confirmed')
);

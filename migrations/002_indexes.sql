-- Planning d'une salle : filtre sur room_id + start_at
CREATE INDEX bookings_room_start ON bookings (room_id, start_at);
-- Quota : réservations à venir d'un membre
CREATE INDEX bookings_member_start ON bookings (member_id, start_at);

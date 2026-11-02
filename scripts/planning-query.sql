-- Planning d'une salle sur une semaine (comparaisons sur début et fin)
SELECT * FROM bookings
WHERE room_id = 'room-1'
  AND status = 'confirmed'
  AND start_at < '2027-03-08'
  AND end_at   > '2027-03-01'
ORDER BY start_at;

// Règles métier pures. Aucune dépendance HTTP ni base de données.
// Tout ce qui dépend de l'heure reçoit `now` en paramètre.
import { conflict, validation } from './errors';
import type { Booking, BookingStatus, Room } from './types';

export const HOUR_MS = 3_600_000;
export const MIN_HOURS = 1;
export const MAX_HOURS = 4;
export const FIRST_START_HOUR = 10;
export const LAST_START_HOUR = 23;
export const MAX_UPCOMING = 2;
export const LATE_CANCEL_MS = 24 * HOUR_MS;

/** Un créneau dure de 1 h à 4 h, commence à une heure pleine entre 10 h et 23 h (UTC). */
export function validateSlot(start: Date, end: Date): void {
  if (!(start.getTime() < end.getTime())) {
    throw validation('invalid_slot', 'end must be after start');
  }
  if (start.getTime() % HOUR_MS !== 0 || end.getTime() % HOUR_MS !== 0) {
    throw validation('invalid_slot', 'start and end must be on the hour');
  }
  const hours = (end.getTime() - start.getTime()) / HOUR_MS;
  if (hours < MIN_HOURS || hours > MAX_HOURS) {
    throw validation('invalid_duration', `a slot lasts ${MIN_HOURS} to ${MAX_HOURS} hours`);
  }
  const h = start.getUTCHours();
  if (h < FIRST_START_HOUR || h > LAST_START_HOUR) {
    throw validation('invalid_start_hour', `a slot starts between ${FIRST_START_HOUR}h and ${LAST_START_HOUR}h UTC`);
  }
}

/** Une salle en maintenance refuse toute réservation qui empiète sur la période. */
export function assertRoomAvailable(room: Room, start: Date, end: Date): void {
  const m = room.maintenance;
  if (m && start.getTime() < m.end.getTime() && end.getTime() > m.start.getTime()) {
    throw conflict('room_in_maintenance', `room ${room.id} is under maintenance`);
  }
}

/** Un membre a au plus 2 réservations à venir. `upcomingCount` = confirmées dont start > now. */
export function assertQuotaAllowsNewBooking(upcomingCount: number): void {
  if (upcomingCount >= MAX_UPCOMING) {
    throw conflict('quota_exceeded', `a member has at most ${MAX_UPCOMING} upcoming bookings`);
  }
}

/** Statut après annulation : late_cancelled si moins de 24 h avant le début. Pas de double annulation. */
export function decideCancellation(booking: Booking, now: Date): Exclude<BookingStatus, 'confirmed'> {
  if (booking.status !== 'confirmed') {
    throw conflict('already_cancelled', `booking ${booking.id} is already cancelled`);
  }
  return booking.start.getTime() - now.getTime() < LATE_CANCEL_MS ? 'late_cancelled' : 'cancelled';
}

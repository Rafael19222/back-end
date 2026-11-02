import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../src/domain/clock';
import { DomainError } from '../../src/domain/errors';
import { assertQuotaAllowsNewBooking, assertRoomAvailable, decideCancellation, validateSlot } from '../../src/domain/rules';
import { iso, type Booking, type Room } from '../../src/domain/types';

const d = (s: string) => new Date(s);
const clock = fixedClock('2026-11-02T09:00:00Z');

describe('iso', () => {
  it('supprime toujours les millisecondes dans les réponses', () => {
    expect(iso(d('2026-11-04T14:00:00.123Z'))).toBe('2026-11-04T14:00:00Z');
  });
});

const kind = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof DomainError ? e.kind : 'other';
  }
  return 'none';
};

describe('validateSlot', () => {
  it('accepte 1 h à 4 h', () => {
    expect(kind(() => validateSlot(d('2026-11-04T14:00:00Z'), d('2026-11-04T15:00:00Z')))).toBe('none');
    expect(kind(() => validateSlot(d('2026-11-04T14:00:00Z'), d('2026-11-04T18:00:00Z')))).toBe('none');
  });
  it('refuse 5 h, 30 min et fin avant début', () => {
    expect(kind(() => validateSlot(d('2026-11-04T14:00:00Z'), d('2026-11-04T19:00:00Z')))).toBe('validation');
    expect(kind(() => validateSlot(d('2026-11-04T14:00:00Z'), d('2026-11-04T14:30:00Z')))).toBe('validation');
    expect(kind(() => validateSlot(d('2026-11-04T16:00:00Z'), d('2026-11-04T14:00:00Z')))).toBe('validation');
  });
  it('refuse une heure non pleine', () => {
    expect(kind(() => validateSlot(d('2026-11-04T14:30:00Z'), d('2026-11-04T16:30:00Z')))).toBe('validation');
  });
  it('accepte un début de 10 h à 23 h, refuse 9 h et 0 h', () => {
    expect(kind(() => validateSlot(d('2026-11-04T10:00:00Z'), d('2026-11-04T11:00:00Z')))).toBe('none');
    expect(kind(() => validateSlot(d('2026-11-04T23:00:00Z'), d('2026-11-05T01:00:00Z')))).toBe('none');
    expect(kind(() => validateSlot(d('2026-11-04T09:00:00Z'), d('2026-11-04T10:00:00Z')))).toBe('validation');
    expect(kind(() => validateSlot(d('2026-11-05T00:00:00Z'), d('2026-11-05T01:00:00Z')))).toBe('validation');
  });
});

describe('assertQuotaAllowsNewBooking', () => {
  it('autorise 0 et 1 réservation à venir, refuse à partir de 2', () => {
    expect(kind(() => assertQuotaAllowsNewBooking(0))).toBe('none');
    expect(kind(() => assertQuotaAllowsNewBooking(1))).toBe('none');
    expect(kind(() => assertQuotaAllowsNewBooking(2))).toBe('conflict');
  });
});

describe('assertRoomAvailable (maintenance du 5 nov. 0 h au 8 nov. 0 h)', () => {
  const room: Room = {
    id: 'room-4', name: 'Salle Björk', capacity: 3,
    maintenance: { start: d('2026-11-05T00:00:00Z'), end: d('2026-11-08T00:00:00Z') },
  };
  it('refuse un créneau qui empiète', () => {
    expect(kind(() => assertRoomAvailable(room, d('2026-11-04T23:00:00Z'), d('2026-11-05T01:00:00Z')))).toBe('conflict');
    expect(kind(() => assertRoomAvailable(room, d('2026-11-06T10:00:00Z'), d('2026-11-06T12:00:00Z')))).toBe('conflict');
  });
  it('accepte un créneau qui touche seulement les bornes', () => {
    expect(kind(() => assertRoomAvailable(room, d('2026-11-04T22:00:00Z'), d('2026-11-05T00:00:00Z')))).toBe('none');
    expect(kind(() => assertRoomAvailable(room, d('2026-11-08T10:00:00Z'), d('2026-11-08T12:00:00Z')))).toBe('none');
  });
  it('accepte toute réservation dans une salle sans maintenance', () => {
    expect(kind(() => assertRoomAvailable({ ...room, maintenance: null }, d('2026-11-06T10:00:00Z'), d('2026-11-06T12:00:00Z')))).toBe('none');
  });
});

describe('decideCancellation (horloge fixée au 2 nov. 2026, 9 h)', () => {
  const booking = (start: string, status: Booking['status'] = 'confirmed'): Booking => ({
    id: 'b', roomId: 'room-1', memberId: 'member-1', start: d(start), end: d(start), status,
  });
  it('cancelled si plus de 24 h avant le début', () => {
    expect(decideCancellation(booking('2026-11-10T14:00:00Z'), clock.now())).toBe('cancelled');
  });
  it('late_cancelled si moins de 24 h avant le début', () => {
    expect(decideCancellation(booking('2026-11-02T19:00:00Z'), clock.now())).toBe('late_cancelled');
  });
  it('pile 24 h avant : cancelled ; 23 h 59 : late_cancelled', () => {
    expect(decideCancellation(booking('2026-11-03T09:00:00Z'), clock.now())).toBe('cancelled');
    expect(decideCancellation(booking('2026-11-03T08:59:00Z'), clock.now())).toBe('late_cancelled');
  });
  it('refuse une double annulation', () => {
    expect(kind(() => decideCancellation(booking('2026-11-10T14:00:00Z', 'cancelled'), clock.now()))).toBe('conflict');
    expect(kind(() => decideCancellation(booking('2026-11-10T14:00:00Z', 'late_cancelled'), clock.now()))).toBe('conflict');
  });
});

export type BookingStatus = 'confirmed' | 'cancelled' | 'late_cancelled';

export interface Room {
  id: string;
  name: string;
  capacity: number;
  maintenance: { start: Date; end: Date } | null;
}

export interface Booking {
  id: string;
  roomId: string;
  memberId: string;
  start: Date;
  end: Date;
  status: BookingStatus;
}

// Formes JSON exposées par l'API (dates en ISO UTC sans millisecondes)
export interface BookingDto {
  id: string;
  roomId: string;
  memberId: string;
  start: string;
  end: string;
  status: BookingStatus;
}

export const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export const toDto = (b: Booking): BookingDto => ({
  id: b.id,
  roomId: b.roomId,
  memberId: b.memberId,
  start: iso(b.start),
  end: iso(b.end),
  status: b.status,
});

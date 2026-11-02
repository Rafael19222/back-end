import type { Booking, BookingDto, BookingStatus, Room } from './types';

/** Opérations exécutées dans UNE transaction. */
export interface Tx {
  getRoom(id: string): Promise<Room | null>;
  /** Verrouille la ligne du membre (sérialise les contrôles de quota). false si inconnu. */
  lockMember(id: string): Promise<boolean>;
  countUpcoming(memberId: string, now: Date): Promise<number>;
  /** Lève conflict('slot_taken') si la base détecte un chevauchement. */
  insertBooking(b: Booking): Promise<void>;
  lockBooking(id: string): Promise<Booking | null>;
  setStatus(id: string, status: BookingStatus): Promise<void>;
}

export interface UnitOfWork {
  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export interface BookingQueries {
  listRooms(): Promise<Room[]>;
  roomExists(id: string): Promise<boolean>;
  /** Réservations confirmées qui chevauchent [from, to). */
  listRoomBookings(roomId: string, from: Date | null, to: Date | null): Promise<Booking[]>;
  getBooking(id: string): Promise<Booking | null>;
  /** null si le membre n'existe pas. */
  listMemberBookings(memberId: string): Promise<Booking[] | null>;
}

export interface PlanningCache {
  getOrLoad(roomId: string, variant: string, loader: () => Promise<BookingDto[]>): Promise<BookingDto[]>;
  invalidate(roomId: string): Promise<void>;
}

export const noCache: PlanningCache = {
  getOrLoad: (_r, _v, loader) => loader(),
  invalidate: async () => {},
};

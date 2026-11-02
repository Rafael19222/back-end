import pg from 'pg';
import { conflict } from '../domain/errors';
import type { BookingQueries, Tx, UnitOfWork } from '../domain/ports';
import type { Booking, BookingStatus, Room } from '../domain/types';

export const createPool = (url: string) => new pg.Pool({ connectionString: url, max: 10 });

/* eslint-disable @typescript-eslint/no-explicit-any */
const toBooking = (r: any): Booking => ({
  id: r.id,
  roomId: r.room_id,
  memberId: r.member_id,
  start: r.start_at,
  end: r.end_at,
  status: r.status,
});

const toRoom = (r: any): Room => ({
  id: r.id,
  name: r.name,
  capacity: r.capacity,
  maintenance: r.maintenance_start ? { start: r.maintenance_start, end: r.maintenance_end } : null,
});

const EXCLUSION_VIOLATION = '23P01';

class PgTx implements Tx {
  constructor(private readonly c: pg.PoolClient) {}

  async getRoom(id: string) {
    const { rows } = await this.c.query('SELECT * FROM rooms WHERE id = $1', [id]);
    return rows[0] ? toRoom(rows[0]) : null;
  }

  async lockMember(id: string) {
    const { rowCount } = await this.c.query('SELECT 1 FROM members WHERE id = $1 FOR UPDATE', [id]);
    return (rowCount ?? 0) > 0;
  }

  async countUpcoming(memberId: string, now: Date) {
    const { rows } = await this.c.query(
      `SELECT count(*)::int AS n FROM bookings
       WHERE member_id = $1 AND status = 'confirmed' AND start_at > $2`,
      [memberId, now],
    );
    return rows[0].n as number;
  }

  async insertBooking(b: Booking) {
    try {
      await this.c.query(
        `INSERT INTO bookings (id, room_id, member_id, start_at, end_at, status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [b.id, b.roomId, b.memberId, b.start, b.end, b.status],
      );
    } catch (e: any) {
      if (e.code === EXCLUSION_VIOLATION) throw conflict('slot_taken', 'this slot overlaps another booking');
      throw e;
    }
  }

  async lockBooking(id: string) {
    const { rows } = await this.c.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [id]);
    return rows[0] ? toBooking(rows[0]) : null;
  }

  async setStatus(id: string, status: BookingStatus) {
    await this.c.query('UPDATE bookings SET status = $2 WHERE id = $1', [id, status]);
  }
}

export class PgUnitOfWork implements UnitOfWork {
  constructor(private readonly pool: pg.Pool) {}

  async run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(new PgTx(client));
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
}

export class PgQueries implements BookingQueries {
  constructor(private readonly pool: pg.Pool) {}

  async listRooms() {
    const { rows } = await this.pool.query('SELECT * FROM rooms ORDER BY id');
    return rows.map(toRoom);
  }

  async roomExists(id: string) {
    const { rowCount } = await this.pool.query('SELECT 1 FROM rooms WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
  }

  async listRoomBookings(roomId: string, from: Date | null, to: Date | null) {
    const { rows } = await this.pool.query(
      `SELECT * FROM bookings
       WHERE room_id = $1 AND status = 'confirmed'
         AND ($2::timestamptz IS NULL OR end_at > $2)
         AND ($3::timestamptz IS NULL OR start_at < $3)
       ORDER BY start_at`,
      [roomId, from, to],
    );
    return rows.map(toBooking);
  }

  async getBooking(id: string) {
    const { rows } = await this.pool.query('SELECT * FROM bookings WHERE id = $1', [id]);
    return rows[0] ? toBooking(rows[0]) : null;
  }

  async listMemberBookings(memberId: string) {
    const member = await this.pool.query('SELECT 1 FROM members WHERE id = $1', [memberId]);
    if (member.rowCount === 0) return null;
    const { rows } = await this.pool.query('SELECT * FROM bookings WHERE member_id = $1 ORDER BY start_at', [memberId]);
    return rows.map(toBooking);
  }
}

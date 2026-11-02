import { randomUUID } from 'node:crypto';
import type { Clock } from './clock';
import { notFound } from './errors';
import type { BookingQueries, PlanningCache, UnitOfWork } from './ports';
import { assertQuotaAllowsNewBooking, assertRoomAvailable, decideCancellation, validateSlot } from './rules';
import { toDto, type Booking, type BookingDto, type Room } from './types';

export class BookingService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly queries: BookingQueries,
    private readonly cache: PlanningCache,
    private readonly clock: Clock,
  ) {}

  listRooms(): Promise<Room[]> {
    return this.queries.listRooms();
  }

  async listRoomBookings(roomId: string, from: Date | null, to: Date | null): Promise<BookingDto[]> {
    if (!(await this.queries.roomExists(roomId))) throw notFound('room_not_found', `room ${roomId} not found`);
    const variant = `${from?.toISOString() ?? ''}|${to?.toISOString() ?? ''}`;
    return this.cache.getOrLoad(roomId, variant, async () =>
      (await this.queries.listRoomBookings(roomId, from, to)).map(toDto),
    );
  }

  async getBooking(id: string): Promise<BookingDto> {
    const b = await this.queries.getBooking(id);
    if (!b) throw notFound('booking_not_found', `booking ${id} not found`);
    return toDto(b);
  }

  async listMemberBookings(memberId: string): Promise<BookingDto[]> {
    const list = await this.queries.listMemberBookings(memberId);
    if (!list) throw notFound('member_not_found', `member ${memberId} not found`);
    return list.map(toDto);
  }

  async createBooking(roomId: string, input: { memberId: string; start: Date; end: Date }): Promise<BookingDto> {
    const now = this.clock.now();
    const booking = await this.uow.run(async (tx) => {
      const room = await tx.getRoom(roomId);
      if (!room) throw notFound('room_not_found', `room ${roomId} not found`);
      validateSlot(input.start, input.end);
      if (!(await tx.lockMember(input.memberId))) throw notFound('member_not_found', `member ${input.memberId} not found`);
      assertRoomAvailable(room, input.start, input.end);
      assertQuotaAllowsNewBooking(await tx.countUpcoming(input.memberId, now));
      const b: Booking = {
        id: randomUUID(),
        roomId,
        memberId: input.memberId,
        start: input.start,
        end: input.end,
        status: 'confirmed',
      };
      await tx.insertBooking(b);
      return b;
    });
    await this.cache.invalidate(roomId);
    return toDto(booking);
  }

  async cancelBooking(id: string): Promise<void> {
    const now = this.clock.now();
    const roomId = await this.uow.run(async (tx) => {
      const b = await tx.lockBooking(id);
      if (!b) throw notFound('booking_not_found', `booking ${id} not found`);
      await tx.setStatus(id, decideCancellation(b, now));
      return b.roomId;
    });
    await this.cache.invalidate(roomId);
  }
}

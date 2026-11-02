import express, { type ErrorRequestHandler } from 'express';
import { DomainError } from '../domain/errors';
import type { BookingService } from '../domain/service';
import { iso } from '../domain/types';
import { parseInstant, parseOptionalInstant } from './parse';

const STATUS = { validation: 400, not_found: 404, conflict: 409 } as const;

export function createApp(service: BookingService) {
  const app = express();
  app.use(express.json());

  // Les handlers ne font que : parser l'entrée -> appeler le service -> formater la sortie.
  app.get('/rooms', async (_req, res) => {
    const rooms = await service.listRooms();
    res.json(
      rooms.map((r) => ({
        id: r.id,
        name: r.name,
        capacity: r.capacity,
        maintenance: r.maintenance ? { start: iso(r.maintenance.start), end: iso(r.maintenance.end) } : null,
      })),
    );
  });

  app.get('/rooms/:id/bookings', async (req, res) => {
    const from = parseOptionalInstant(req.query.from, 'from');
    const to = parseOptionalInstant(req.query.to, 'to');
    res.json(await service.listRoomBookings(req.params.id, from, to));
  });

  app.post('/rooms/:id/bookings', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    // La salle est vérifiée dans le service avant la validation du créneau ; ici seulement le format.
    const memberId = body.memberId;
    const created = await service.createBooking(req.params.id, {
      memberId: typeof memberId === 'string' ? memberId : '',
      start: parseInstant(body.start, 'start'),
      end: parseInstant(body.end, 'end'),
    });
    res.status(201).location(`/bookings/${created.id}`).json(created);
  });

  app.get('/bookings/:id', async (req, res) => {
    res.json(await service.getBooking(req.params.id));
  });

  app.delete('/bookings/:id', async (req, res) => {
    await service.cancelBooking(req.params.id);
    res.status(204).end();
  });

  app.get('/members/:id/bookings', async (req, res) => {
    res.json(await service.listMemberBookings(req.params.id));
  });

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof DomainError) {
      res.status(STATUS[err.kind]).json({ error: err.code, message: err.message });
    } else if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'invalid_json', message: 'malformed JSON body' });
    } else {
      console.error(err);
      res.status(500).json({ error: 'internal_error' });
    }
  };
  app.use(onError);

  return app;
}

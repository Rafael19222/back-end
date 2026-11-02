import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../src/config';
import { ValkeyCache } from '../../src/infra/valkey';
import { makeApp, pool, prepareDb, resetDb } from '../helpers';

const app = makeApp();
const book = (roomId: string, memberId: string, start: string, end: string) =>
  request(app).post(`/rooms/${roomId}/bookings`).send({ memberId, start, end });

beforeAll(prepareDb);
beforeEach(resetDb);
afterAll(() => pool.end());

describe('GET /rooms', () => {
  it('200 : liste les 4 salles avec la maintenance de room-4', async () => {
    const res = await request(app).get('/rooms');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
    expect(res.body[3]).toMatchObject({ id: 'room-4', maintenance: { start: '2026-11-05T00:00:00Z', end: '2026-11-08T00:00:00Z' } });
  });
});

describe('GET /rooms/:id/bookings', () => {
  it('200 : planning de la salle, au format du contrat', async () => {
    const res = await request(app).get('/rooms/room-1/bookings?from=2026-11-01T00:00:00Z&to=2026-11-08T00:00:00Z');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'booking-1', roomId: 'room-1', memberId: 'member-1', start: '2026-11-03T18:00:00Z', end: '2026-11-03T20:00:00Z', status: 'confirmed' },
    ]);
  });
  it('200 : filtre par période', async () => {
    const res = await request(app).get('/rooms/room-3/bookings?from=2026-11-01T00:00:00Z&to=2026-11-08T00:00:00Z');
    expect(res.body).toEqual([]);
  });
  it('404 : salle inconnue', async () => {
    expect((await request(app).get('/rooms/room-9/bookings')).status).toBe(404);
  });
});

describe('POST /rooms/:id/bookings', () => {
  it('201 + Location', async () => {
    const res = await book('room-1', 'member-3', '2026-11-04T14:00:00Z', '2026-11-04T16:00:00Z');
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/bookings/${res.body.id}`);
    expect(res.body).toMatchObject({ roomId: 'room-1', memberId: 'member-3', start: '2026-11-04T14:00:00Z', end: '2026-11-04T16:00:00Z', status: 'confirmed' });
    expect((await request(app).get(res.headers.location)).status).toBe(200);
  });
  it('404 : salle inconnue, membre inconnu', async () => {
    expect((await book('room-9', 'member-3', '2026-11-04T14:00:00Z', '2026-11-04T16:00:00Z')).status).toBe(404);
    expect((await book('room-1', 'member-9', '2026-11-04T14:00:00Z', '2026-11-04T16:00:00Z')).status).toBe(404);
  });
  it('400 : durée, heure de début, format de date, corps manquant, JSON invalide', async () => {
    expect((await book('room-1', 'member-3', '2026-11-04T14:00:00Z', '2026-11-04T19:00:00Z')).status).toBe(400);
    expect((await book('room-1', 'member-3', '2026-11-04T09:00:00Z', '2026-11-04T11:00:00Z')).status).toBe(400);
    expect((await book('room-1', 'member-3', '2026-11-04T14:30:00Z', '2026-11-04T16:30:00Z')).status).toBe(400);
    expect((await book('room-1', 'member-3', 'demain', '2026-11-04T16:00:00Z')).status).toBe(400);
    expect((await request(app).post('/rooms/room-1/bookings').send({})).status).toBe(400);
    expect((await request(app).post('/rooms/room-1/bookings').set('Content-Type', 'application/json').send('{oops')).status).toBe(400);
  });
  it('409 : chevauchement, mais un créneau peut commencer quand le précédent finit', async () => {
    await book('room-1', 'member-3', '2026-11-04T14:00:00Z', '2026-11-04T16:00:00Z');
    expect((await book('room-1', 'member-2', '2026-11-04T15:00:00Z', '2026-11-04T17:00:00Z')).status).toBe(409);
    expect((await book('room-1', 'member-2', '2026-11-04T16:00:00Z', '2026-11-04T18:00:00Z')).status).toBe(201);
  });
  it('409 : member-1 a déjà 2 réservations à venir', async () => {
    const res = await book('room-2', 'member-1', '2026-11-20T14:00:00Z', '2026-11-20T16:00:00Z');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('quota_exceeded');
  });
  it('201 : member-1 peut réserver de nouveau après une annulation', async () => {
    expect((await request(app).delete('/bookings/booking-1')).status).toBe(204);
    expect((await book('room-2', 'member-1', '2026-11-20T14:00:00Z', '2026-11-20T16:00:00Z')).status).toBe(201);
  });
  it('409 : salle en maintenance, 201 hors maintenance (bornes comprises)', async () => {
    expect((await book('room-4', 'member-3', '2026-11-06T10:00:00Z', '2026-11-06T12:00:00Z')).status).toBe(409);
    expect((await book('room-4', 'member-3', '2026-11-04T23:00:00Z', '2026-11-05T01:00:00Z')).status).toBe(409);
    expect((await book('room-4', 'member-3', '2026-11-04T22:00:00Z', '2026-11-05T00:00:00Z')).status).toBe(201);
    expect((await book('room-4', 'member-3', '2026-11-08T10:00:00Z', '2026-11-08T12:00:00Z')).status).toBe(201);
  });
  it('un créneau annulé peut être réservé à nouveau', async () => {
    await request(app).delete('/bookings/booking-1');
    expect((await book('room-1', 'member-3', '2026-11-03T18:00:00Z', '2026-11-03T20:00:00Z')).status).toBe(201);
  });
});

describe('concurrence', () => {
  it('deux requêtes simultanées sur le même créneau : une seule passe', async () => {
    const results = await Promise.all([
      book('room-2', 'member-3', '2026-11-12T14:00:00Z', '2026-11-12T16:00:00Z'),
      book('room-2', 'member-2', '2026-11-12T14:00:00Z', '2026-11-12T16:00:00Z'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });
  it('trois requêtes simultanées d\'un même membre : le quota de 2 tient', async () => {
    const results = await Promise.all([
      book('room-1', 'member-3', '2026-11-12T14:00:00Z', '2026-11-12T16:00:00Z'),
      book('room-2', 'member-3', '2026-11-13T14:00:00Z', '2026-11-13T16:00:00Z'),
      book('room-3', 'member-3', '2026-11-14T14:00:00Z', '2026-11-14T16:00:00Z'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 201, 409]);
  });
  it('la base refuse elle-même un chevauchement (contrainte d\'exclusion)', async () => {
    await expect(
      pool.query(`INSERT INTO bookings (id, room_id, member_id, start_at, end_at) VALUES ('x', 'room-1', 'member-3', '2026-11-03T19:00Z', '2026-11-03T21:00Z')`),
    ).rejects.toMatchObject({ code: '23P01' });
  });
});

describe('GET /bookings/:id et DELETE /bookings/:id', () => {
  it('GET 200 / 404', async () => {
    expect((await request(app).get('/bookings/booking-1')).status).toBe(200);
    expect((await request(app).get('/bookings/nope')).status).toBe(404);
  });
  it('DELETE 204 -> cancelled (booking-2, dans plus de 24 h)', async () => {
    expect((await request(app).delete('/bookings/booking-2')).status).toBe(204);
    expect((await request(app).get('/bookings/booking-2')).body.status).toBe('cancelled');
  });
  it('DELETE 204 -> late_cancelled (booking-3 commence dans moins de 24 h)', async () => {
    expect((await request(app).delete('/bookings/booking-3')).status).toBe(204);
    expect((await request(app).get('/bookings/booking-3')).body.status).toBe('late_cancelled');
  });
  it('DELETE 409 sur une double annulation, 404 si inconnue', async () => {
    await request(app).delete('/bookings/booking-2');
    expect((await request(app).delete('/bookings/booking-2')).status).toBe(409);
    expect((await request(app).delete('/bookings/nope')).status).toBe(404);
  });
});

describe('GET /members/:id/bookings', () => {
  it('200 : toutes les réservations du membre, annulées comprises', async () => {
    await request(app).delete('/bookings/booking-3');
    const res = await request(app).get('/members/member-2/bookings');
    expect(res.status).toBe(200);
    expect(res.body.map((b: { id: string; status: string }) => [b.id, b.status])).toEqual([
      ['booking-4', 'confirmed'],
      ['booking-3', 'late_cancelled'],
    ]);
  });
  it('404 : membre inconnu', async () => {
    expect((await request(app).get('/members/member-9/bookings')).status).toBe(404);
  });
});

describe('cache Valkey', () => {
  const planning = (a: ReturnType<typeof makeApp>) =>
    request(a).get('/rooms/room-1/bookings?from=2026-11-01T00:00:00Z&to=2026-11-30T00:00:00Z');

  it('une réservation puis une annulation apparaissent immédiatement dans le planning', async () => {
    const cache = new ValkeyCache(config.valkeyUrl, 60, `test-${randomUUID()}`);
    const cached = makeApp(cache);
    try {
      expect((await planning(cached)).body).toHaveLength(1);
      expect((await planning(cached)).body).toHaveLength(1); // 2e lecture : servie par le cache
      const created = await request(cached).post('/rooms/room-1/bookings').send({ memberId: 'member-3', start: '2026-11-04T14:00:00Z', end: '2026-11-04T16:00:00Z' });
      expect((await planning(cached)).body).toHaveLength(2);
      await request(cached).delete(`/bookings/${created.body.id}`);
      expect((await planning(cached)).body).toHaveLength(1);
    } finally {
      await cache.close();
    }
  });

  it('l\'API répond quand Valkey est arrêté', async () => {
    const dead = new ValkeyCache('redis://127.0.0.1:1', 60, 'dead');
    const a = makeApp(dead);
    try {
      expect((await planning(a)).status).toBe(200);
      const res = await request(a).post('/rooms/room-1/bookings').send({ memberId: 'member-3', start: '2026-11-04T14:00:00Z', end: '2026-11-04T16:00:00Z' });
      expect(res.status).toBe(201);
      expect((await planning(a)).body).toHaveLength(2);
    } finally {
      await dead.close();
    }
  });
});

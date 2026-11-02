import { Redis } from 'ioredis';
import type { PlanningCache } from '../domain/ports';
import type { BookingDto } from '../domain/types';

/**
 * Cache du planning par salle, avec invalidation par numéro de version.
 *   planning:ver:{room}              -> compteur, INCR à chaque réservation/annulation
 *   planning:{room}:v{ver}:{from|to} -> réponse JSON, TTL court
 * Après une écriture, l'ancienne version n'est plus lue : l'ancien cache est
 * ignoré immédiatement puis expire seul. Toute erreur Valkey est avalée : on retombe sur PostgreSQL.
 */
export class ValkeyCache implements PlanningCache {
  private readonly redis: Redis;

  constructor(url: string, private readonly ttlSeconds = 60, private readonly prefix = 'planning') {
    this.redis = new Redis(url, {
      enableOfflineQueue: false, // pas de file d'attente : on échoue vite si Valkey est arrêté
      maxRetriesPerRequest: 1,
      commandTimeout: 300,
      retryStrategy: (n) => Math.min(n * 200, 2000),
    });
    this.redis.on('error', () => {});
  }

  async getOrLoad(roomId: string, variant: string, loader: () => Promise<BookingDto[]>): Promise<BookingDto[]> {
    let key: string | null = null;
    try {
      // La version est lue AVANT la requête SQL : une écriture concurrente rend notre entrée obsolète d'office.
      const ver = (await this.redis.get(`${this.prefix}:ver:${roomId}`)) ?? '0';
      key = `${this.prefix}:${roomId}:v${ver}:${variant}`;
      const hit = await this.redis.get(key);
      if (hit) return JSON.parse(hit) as BookingDto[];
    } catch {
      key = null;
    }
    const data = await loader();
    if (key) {
      try {
        await this.redis.set(key, JSON.stringify(data), 'EX', this.ttlSeconds);
      } catch {
        /* ignoré */
      }
    }
    return data;
  }

  async invalidate(roomId: string): Promise<void> {
    try {
      await this.redis.incr(`${this.prefix}:ver:${roomId}`);
    } catch {
      /* Valkey indisponible : le TTL court limite la durée d'obsolescence */
    }
  }

  async close(): Promise<void> {
    this.redis.disconnect();
  }
}

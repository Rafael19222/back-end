import { validation } from '../domain/errors';

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export function parseInstant(value: unknown, field: string): Date {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) {
    throw validation('invalid_date', `${field} must be an ISO 8601 UTC date (e.g. 2026-11-04T14:00:00Z)`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw validation('invalid_date', `${field} is not a valid date`);
  return d;
}

export const parseOptionalInstant = (value: unknown, field: string): Date | null =>
  value === undefined ? null : parseInstant(value, field);

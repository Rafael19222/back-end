export type ErrorKind = 'validation' | 'not_found' | 'conflict';

export class DomainError extends Error {
  constructor(
    public readonly kind: ErrorKind,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const validation = (code: string, msg: string) => new DomainError('validation', code, msg);
export const notFound = (code: string, msg: string) => new DomainError('not_found', code, msg);
export const conflict = (code: string, msg: string) => new DomainError('conflict', code, msg);

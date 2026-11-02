export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
export const fixedClock = (d: Date | string): Clock => ({ now: () => new Date(d) });

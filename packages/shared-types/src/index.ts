export * from './user';
export * from './post';
export * from './message';
export * from './friendship';
export * from './association';
export * from './service-request';
export * from './notification';
export * from './page';
export * from './poll';
export * from './review';
export * from './proximity';

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

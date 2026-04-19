export * from './user';
export * from './post';
export * from './message';
export * from './friendship';
export * from './association';
export * from './service-request';
export * from './notification';

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

import { ageInYears, isAdult } from './age';

describe('age helpers (18+ proximity gate)', () => {
  const now = new Date('2026-06-30T12:00:00.000Z');

  it('computes full years, accounting for the birthday not yet reached', () => {
    expect(ageInYears(new Date('2000-01-01'), now)).toBe(26);
    // Birthday later this year → not yet turned that age.
    expect(ageInYears(new Date('2008-12-31'), now)).toBe(17);
    // Birthday today → counts.
    expect(ageInYears(new Date('2008-06-30'), now)).toBe(18);
  });

  it('isAdult is fail-closed on a null/undefined DOB', () => {
    expect(isAdult(null, now)).toBe(false);
    expect(isAdult(undefined, now)).toBe(false);
  });

  it('isAdult true only at 18+', () => {
    expect(isAdult(new Date('2008-06-30'), now)).toBe(true); // exactly 18 today
    expect(isAdult(new Date('2008-07-01'), now)).toBe(false); // turns 18 tomorrow
    expect(isAdult(new Date('1990-01-01'), now)).toBe(true);
  });
});

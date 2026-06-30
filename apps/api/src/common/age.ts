/**
 * Age helpers for the 18+ proximity gate. DOB is captured at manual identity
 * review (IdentityDocument.dateOfBirth). A null DOB is treated as NOT adult
 * (fail-closed) so legacy approvals without a recorded DOB stay ineligible until
 * one is entered.
 */

/** Full years between `dob` and `now` (default: current time). */
export function ageInYears(dob: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

/** True only for a non-null DOB of someone aged 18 or older. Fail-closed on null. */
export function isAdult(dob: Date | null | undefined, now: Date = new Date()): boolean {
  if (!dob) return false;
  return ageInYears(dob, now) >= 18;
}

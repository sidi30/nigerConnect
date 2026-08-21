/**
 * B5 — how much disk one association may occupy in its OWN media space
 * (`associations/{id}/`, ADR-002).
 *
 * 200 Mo: several hundred compressed photos, well above what an association
 * publishing a few times a month uses, and low enough that a handful of them
 * cannot fill the bucket the global disk guard watches (10 Go) on their own.
 *
 * The ceiling is reclaimable — deleting a publication purges its objects and
 * gives the bytes back — so this measures what sits on the disk right now, not
 * everything ever uploaded.
 *
 * Lives in its own file so that the module that ENFORCES the quota (feed) and
 * the module that REPORTS it (association) share one number instead of two
 * that drift.
 */
export const ASSOCIATION_MEDIA_QUOTA_BYTES = 200 * 1024 * 1024;

-- Date of birth captured at manual identity review, for the 18+ gate (proximity).
-- Private: never exposed to other users. Nullable so existing approved docs
-- (pre-feature) keep working — they're simply ineligible for proximity until a
-- DOB is recorded.
ALTER TABLE "identity_documents" ADD COLUMN "date_of_birth" DATE;

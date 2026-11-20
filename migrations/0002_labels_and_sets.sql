-- Teacher-facing label for a game, e.g. "Period 3".
ALTER TABLE games ADD COLUMN label TEXT;

-- Saved country lists a teacher can load into "Pick countries" again.
CREATE TABLE country_sets (
  id          TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  name        TEXT NOT NULL,
  country_ids TEXT NOT NULL, -- JSON array, in round order
  created_at  INTEGER NOT NULL
);
CREATE INDEX country_sets_owner ON country_sets (owner_email, created_at DESC);

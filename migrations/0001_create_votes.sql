CREATE TABLE IF NOT EXISTS votes (
  crossing_key TEXT NOT NULL,
  voter_hash TEXT NOT NULL,
  vote TEXT NOT NULL CHECK (vote IN ('adequate', 'inadequate')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (crossing_key, voter_hash)
);

CREATE INDEX IF NOT EXISTS votes_crossing_key_idx ON votes (crossing_key);

-- Finished/started games, written by the Party Durable Object.
CREATE TABLE games (
  id            TEXT PRIMARY KEY,
  code          TEXT NOT NULL,
  owner_email   TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  finished_at   INTEGER,
  mode          TEXT NOT NULL,
  timer_seconds INTEGER NOT NULL,
  country_ids   TEXT NOT NULL, -- JSON array
  player_count  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX games_owner_created ON games (owner_email, created_at DESC);

CREATE TABLE game_players (
  game_id      TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  rank         INTEGER NOT NULL,
  player_name  TEXT NOT NULL,
  total_score  INTEGER NOT NULL,
  round_scores TEXT NOT NULL, -- JSON array of {score, km} | null per round
  PRIMARY KEY (game_id, player_name)
);

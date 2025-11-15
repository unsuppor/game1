CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT,
  money BIGINT DEFAULT 0,
  clothing JSONB DEFAULT '{}' ,
  last_seen TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  label TEXT,
  price INT,
  data JSONB
);

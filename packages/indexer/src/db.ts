import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Single shared SQLite file at the repo root: data/paperhands.sqlite */
export function defaultDbPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(join(here, '..', '..', '..', 'data', 'paperhands.sqlite'))
}

export function openDb(path = process.env.PAPERHANDS_DB ?? defaultDbPath()): Database.Database {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  migrate(db)
  return db
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tokens (
      address TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      decimals INTEGER NOT NULL,
      first_seen_block INTEGER
    );

    CREATE TABLE IF NOT EXISTS pools (
      address TEXT PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 3,
      token0 TEXT NOT NULL,
      token1 TEXT NOT NULL,
      fee INTEGER NOT NULL,
      tick_spacing INTEGER NOT NULL,
      -- 1 when the memecoin is token0 and WETH is token1; 0 the other way;
      -- NULL when the pool has no WETH side (unpriced for now)
      base_is_token0 INTEGER,
      -- verified against the canonical factory; unverified pools are scam-shaped
      factory_verified INTEGER NOT NULL DEFAULT 0,
      discovered_block INTEGER,
      last_swap_block INTEGER,
      last_sqrt_price TEXT,
      last_tick INTEGER,
      last_liquidity TEXT,
      swap_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS swaps (
      tx_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      pool TEXT NOT NULL,
      block INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      amount0 TEXT NOT NULL,
      amount1 TEXT NOT NULL,
      sqrt_price_x96 TEXT NOT NULL,
      tick INTEGER NOT NULL,
      trader TEXT,
      PRIMARY KEY (tx_hash, log_index)
    );
    CREATE INDEX IF NOT EXISTS swaps_pool_block ON swaps(pool, block);
    CREATE INDEX IF NOT EXISTS swaps_trader ON swaps(trader) WHERE trader IS NOT NULL;

    -- price = human-unit quote (WETH) per base token
    CREATE TABLE IF NOT EXISTS candles (
      pool TEXT NOT NULL,
      minute_ts INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      vol_quote REAL NOT NULL DEFAULT 0,
      trades INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (pool, minute_ts)
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- paper trading
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      handle TEXT UNIQUE,
      created_ts INTEGER NOT NULL,
      -- paper bankroll in WETH wei
      balance_quote TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS positions (
      user_id TEXT NOT NULL,
      pool TEXT NOT NULL,
      qty TEXT NOT NULL,
      cost_quote TEXT NOT NULL,
      realized_quote TEXT NOT NULL DEFAULT '0',
      PRIMARY KEY (user_id, pool)
    );

    CREATE TABLE IF NOT EXISTS paper_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      pool TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('buy','sell')),
      qty TEXT NOT NULL,
      quote_amount TEXT NOT NULL,
      fee_quote TEXT NOT NULL,
      price_impact_bps REAL NOT NULL,
      fill_ratio REAL NOT NULL,
      spot_price REAL NOT NULL,
      exec_price REAL NOT NULL,
      block INTEGER NOT NULL,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS paper_trades_user ON paper_trades(user_id, ts);

    -- KOL tailing: mirror a wallet's buys with a fixed size, exit when it exits
    CREATE TABLE IF NOT EXISTS kol_tails (
      user_id TEXT NOT NULL,
      wallet TEXT NOT NULL,
      size_quote TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_ts INTEGER NOT NULL,
      -- only the wallet's swaps after this block get mirrored
      last_block INTEGER NOT NULL,
      PRIMARY KEY (user_id, wallet)
    );
  `)

  const tradeCols = db.prepare(`PRAGMA table_info(paper_trades)`).all() as { name: string }[]
  if (!tradeCols.some((c) => c.name === 'source')) {
    db.exec(`ALTER TABLE paper_trades ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'`)
  }
}

export function getMeta(db: Database.Database, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value
}

export function setMeta(db: Database.Database, key: string, value: string) {
  db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value,
  )
}

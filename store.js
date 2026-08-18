'use strict';
// Storage layer. Uses Postgres when DATABASE_URL is set (survives restarts),
// otherwise falls back to in-memory maps (resets on redeploy).

const useDb = !!process.env.DATABASE_URL;
let pool = null;

const mem = { games: new Map(), decks: new Map(), stats: new Map() };

async function init() {
  if (!useDb) { console.log('Store: in-memory mode (set DATABASE_URL for persistence).'); return; }
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  });
  await pool.query(`CREATE TABLE IF NOT EXISTS games (
    channel_id TEXT PRIMARY KEY,
    state JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS decks (
    user_id TEXT PRIMARY KEY,
    cards JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS stats (
    user_id TEXT PRIMARY KEY,
    wins INT NOT NULL DEFAULT 0,
    losses INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT now()
  )`);
  console.log('Store: Postgres mode ready.');
}

// ---- games ----
async function getGame(channelId) {
  if (!useDb) return mem.games.get(channelId) || null;
  const r = await pool.query('SELECT state FROM games WHERE channel_id=$1', [channelId]);
  return r.rows.length ? r.rows[0].state : null;
}
async function saveGame(channelId, state) {
  if (!useDb) { mem.games.set(channelId, state); return; }
  await pool.query(
    `INSERT INTO games(channel_id,state,updated_at) VALUES($1,$2,now())
     ON CONFLICT(channel_id) DO UPDATE SET state=$2, updated_at=now()`,
    [channelId, state]
  );
}

// ---- decks ----
async function getDeck(userId) {
  if (!useDb) return mem.decks.get(userId) || null;
  const r = await pool.query('SELECT cards FROM decks WHERE user_id=$1', [userId]);
  return r.rows.length ? r.rows[0].cards : null;
}
async function saveDeck(userId, cards) {
  if (!useDb) { mem.decks.set(userId, cards); return; }
  await pool.query(
    `INSERT INTO decks(user_id,cards,updated_at) VALUES($1,$2,now())
     ON CONFLICT(user_id) DO UPDATE SET cards=$2, updated_at=now()`,
    [userId, JSON.stringify(cards)]
  );
}

// ---- stats ----
async function getStats(userId) {
  if (!useDb) return mem.stats.get(userId) || { wins: 0, losses: 0 };
  const r = await pool.query('SELECT wins,losses FROM stats WHERE user_id=$1', [userId]);
  return r.rows.length ? r.rows[0] : { wins: 0, losses: 0 };
}
async function addResult(userId, won) {
  if (!useDb) {
    const cur = mem.stats.get(userId) || { wins: 0, losses: 0 };
    if (won) cur.wins++; else cur.losses++;
    mem.stats.set(userId, cur);
    return;
  }
  await pool.query(
    `INSERT INTO stats(user_id,wins,losses) VALUES($1,$2,$3)
     ON CONFLICT(user_id) DO UPDATE SET
       wins=stats.wins+$2, losses=stats.losses+$3, updated_at=now()`,
    [userId, won ? 1 : 0, won ? 0 : 1]
  );
}

module.exports = { init, getGame, saveGame, getDeck, saveDeck, getStats, addResult, useDb };

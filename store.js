'use strict';
// Storage layer. Uses Postgres when DATABASE_URL is set (survives restarts),
// otherwise falls back to in-memory maps (resets on redeploy).

const useDb = !!process.env.DATABASE_URL;
let pool = null;

const STARTING_CREDITS = 500;
const DAILY_AMOUNT = 50;

const mem = { games: new Map(), decks: new Map(), stats: new Map(), wallets: new Map() };

function todayStr() { return new Date().toISOString().slice(0, 10); } // UTC calendar day

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
  await pool.query(`CREATE TABLE IF NOT EXISTS wallets (
    user_id TEXT PRIMARY KEY,
    credits INT NOT NULL DEFAULT ${STARTING_CREDITS},
    last_daily DATE,
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

// ---- wallets / credits ----
// Every user starts with STARTING_CREDITS the first time we see their wallet.
async function getWallet(userId) {
  if (!useDb) {
    let w = mem.wallets.get(userId);
    if (!w) { w = { credits: STARTING_CREDITS, last_daily: null }; mem.wallets.set(userId, w); }
    return { credits: w.credits, last_daily: w.last_daily };
  }
  const r = await pool.query('SELECT credits, last_daily FROM wallets WHERE user_id=$1', [userId]);
  if (r.rows.length) {
    const row = r.rows[0];
    const ld = row.last_daily ? new Date(row.last_daily).toISOString().slice(0, 10) : null;
    return { credits: row.credits, last_daily: ld };
  }
  await pool.query('INSERT INTO wallets(user_id, credits) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING', [userId, STARTING_CREDITS]);
  return { credits: STARTING_CREDITS, last_daily: null };
}

async function getCredits(userId) {
  const w = await getWallet(userId);
  return w.credits;
}

// Add (or subtract, if negative) credits. Never lets the balance go below 0.
async function addCredits(userId, delta) {
  if (!useDb) {
    const w = await getWallet(userId);
    w.credits = Math.max(0, w.credits + delta);
    mem.wallets.set(userId, w);
    return w.credits;
  }
  await getWallet(userId); // ensure the row exists
  const r = await pool.query(
    `UPDATE wallets SET credits = GREATEST(0, credits + $2), updated_at=now()
     WHERE user_id=$1 RETURNING credits`,
    [userId, delta]
  );
  return r.rows[0].credits;
}

// Claim the once-per-day stipend. Returns { ok, amount, credits, nextIn }.
async function claimDaily(userId) {
  const today = todayStr();
  if (!useDb) {
    const w = await getWallet(userId);
    if (w.last_daily === today) return { ok: false, credits: w.credits, already: true };
    w.credits += DAILY_AMOUNT; w.last_daily = today;
    mem.wallets.set(userId, w);
    return { ok: true, amount: DAILY_AMOUNT, credits: w.credits };
  }
  await getWallet(userId);
  const r = await pool.query(
    `UPDATE wallets SET credits = credits + $2, last_daily = $3::date, updated_at=now()
     WHERE user_id=$1 AND (last_daily IS DISTINCT FROM $3::date)
     RETURNING credits`,
    [userId, DAILY_AMOUNT, today]
  );
  if (!r.rows.length) {
    const c = await getCredits(userId);
    return { ok: false, credits: c, already: true };
  }
  return { ok: true, amount: DAILY_AMOUNT, credits: r.rows[0].credits };
}

module.exports = {
  init, getGame, saveGame, getDeck, saveDeck, getStats, addResult, useDb,
  getWallet, getCredits, addCredits, claimDaily,
  STARTING_CREDITS, DAILY_AMOUNT,
};

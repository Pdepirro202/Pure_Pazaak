// Pazaak Discord bot — single-file version (easy to deploy).
// Discord signs the EXACT raw request bytes; we verify them with express.raw()
// BEFORE parsing JSON. In-memory game storage (resets on restart/redeploy).
'use strict';

const express = require('express');
const nacl = require('discord-interactions'); // provides verifyKey

const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const PORT = process.env.PORT || 3000;
const IMAGE_BASE_URL = process.env.IMAGE_BASE_URL || 'https://raw.githubusercontent.com/Pdepirro202/Pazaak/main';
const TABLE_IMAGE = process.env.TABLE_IMAGE || 'D.png';

if (!PUBLIC_KEY) {
  console.error('FATAL: DISCORD_PUBLIC_KEY environment variable is not set.');
  process.exit(1);
}

// ============================ ENGINE ============================
const WIN_SETS = 3, HAND_SIZE = 4, TARGET = 20;

function nextRand(s) {
  let a = s.rngState | 0;
  a = (a + 0x6D2B79F5) | 0;
  s.rngState = a >>> 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function drawMainCard(s) { return 1 + Math.floor(nextRand(s) * 10); }
function makeHand(s) {
  const h = [];
  for (let i = 0; i < HAND_SIZE; i++) {
    const mag = 1 + Math.floor(nextRand(s) * 6);
    const sign = nextRand(s) < 0.5 ? 1 : -1;
    h.push(sign * mag);
  }
  return h;
}
function newPlayer(s, id, isComputer) {
  return { id, isComputer: !!isComputer, board: [], sidePlayed: [], hand: makeHand(s), total: 0, stood: false, busted: false, playedThisTurn: false, sets: 0 };
}
function totalOf(p) {
  let t = 0;
  for (let i = 0; i < p.board.length; i++) t += p.board[i];
  for (let i = 0; i < p.sidePlayed.length; i++) t += p.sidePlayed[i];
  return t;
}
function other(w) { return w === 'p1' ? 'p2' : 'p1'; }
function glog(s, m) { s.log.push(m); if (s.log.length > 8) s.log.shift(); }
function newGame(mode, p1, p2, seed) {
  const s = { mode, rngState: (seed >>> 0) || 1, turn: 'p1', round: 1, phase: 'playing', log: [], winner: null, players: {} };
  s.players.p1 = newPlayer(s, p1, false);
  s.players.p2 = newPlayer(s, p2, mode === 'pvc');
  beginTurn(s); processAuto(s);
  return s;
}
function beginTurn(s) {
  const w = s.turn, p = s.players[w];
  p.playedThisTurn = false;
  if (p.stood || p.busted) return;
  const c = drawMainCard(s);
  p.board.push(c); p.total = totalOf(p);
  glog(s, w + ' drew ' + c + ' (total ' + p.total + ')');
  if (p.total > TARGET) {
    if (!canRescue(p)) { p.busted = true; glog(s, w + ' busted at ' + p.total + '!'); resolveRound(s); }
  } else if (p.total === TARGET) {
    p.stood = true; glog(s, w + ' hit 20 and stands'); switchTurn(s);
  }
}
function canRescue(p) {
  if (p.playedThisTurn) return false;
  for (let i = 0; i < p.hand.length; i++) if (p.total + p.hand[i] <= TARGET) return true;
  return false;
}
function switchTurn(s) {
  if (s.phase !== 'playing') return;
  const o = other(s.turn), op = s.players[o];
  if (op.stood || op.busted) {
    const cur = s.players[s.turn];
    if (cur.stood || cur.busted) { resolveRound(s); return; }
    beginTurn(s); return;
  }
  s.turn = o; beginTurn(s);
}
function resolveRound(s) {
  const p1 = s.players.p1, p2 = s.players.p2;
  let w = null;
  if (p1.busted && !p2.busted) w = 'p2';
  else if (p2.busted && !p1.busted) w = 'p1';
  else if (p1.busted && p2.busted) w = null;
  else if (p1.total > p2.total) w = 'p1';
  else if (p2.total > p1.total) w = 'p2';
  if (w) { s.players[w].sets += 1; glog(s, 'Round ' + s.round + ' to ' + w + ' (' + p1.total + ' vs ' + p2.total + '). Sets ' + p1.sets + '-' + p2.sets); }
  else { glog(s, 'Round ' + s.round + ' tied (' + p1.total + ' vs ' + p2.total + ').'); }
  if (p1.sets >= WIN_SETS || p2.sets >= WIN_SETS) {
    s.phase = 'gameOver'; s.winner = p1.sets >= WIN_SETS ? 'p1' : 'p2';
    glog(s, 'Match over - ' + s.winner + ' wins!'); return;
  }
  s.phase = 'playing'; s.round += 1;
  resetRound(s, w ? other(w) : 'p1');
}
function resetRound(s, starter) {
  ['p1', 'p2'].forEach(function (k) {
    const p = s.players[k];
    p.board = []; p.sidePlayed = []; p.total = 0; p.stood = false; p.busted = false; p.playedThisTurn = false;
  });
  s.turn = starter; beginTurn(s);
}
function processAuto(s) {
  let g = 0;
  while (s.phase === 'playing' && g++ < 200) {
    const w = s.turn, p = s.players[w];
    if (p.stood || p.busted) { switchTurn(s); continue; }
    if (!p.isComputer) break;
    computerTakeTurn(s);
  }
}
function computerTakeTurn(s) {
  const w = s.turn, p = s.players[w];
  if (p.total > TARGET) playBestCard(s, w);
  else if (p.total >= 18 && p.total < TARGET) playToTwenty(s, w);
  if (p.busted) return;
  if (p.total > TARGET) { p.busted = true; glog(s, w + ' busted at ' + p.total + '!'); resolveRound(s); return; }
  if (p.total >= 18) { p.stood = true; glog(s, w + ' stands at ' + p.total); switchTurn(s); return; }
  glog(s, w + ' ends turn at ' + p.total); switchTurn(s);
}
function playToTwenty(s, w) {
  const p = s.players[w];
  if (p.playedThisTurn) return;
  const idx = p.hand.indexOf(TARGET - p.total);
  if (idx >= 0) applySideCard(s, w, idx);
}
function playBestCard(s, w) {
  const p = s.players[w];
  if (p.playedThisTurn) return;
  let best = -1, bs = -Infinity;
  for (let i = 0; i < p.hand.length; i++) {
    const af = p.total + p.hand[i];
    if (af <= TARGET && af > bs) { bs = af; best = i; }
  }
  if (best >= 0) applySideCard(s, w, best);
}
function applySideCard(s, w, hi) {
  const p = s.players[w];
  if (p.playedThisTurn) return { ok: false, reason: 'already played a card this turn' };
  if (hi < 0 || hi >= p.hand.length) return { ok: false, reason: 'invalid card' };
  const c = p.hand.splice(hi, 1)[0];
  p.sidePlayed.push(c); p.playedThisTurn = true; p.total = totalOf(p);
  glog(s, w + ' played ' + (c >= 0 ? '+' + c : String(c)) + ' (total ' + p.total + ')');
  return { ok: true };
}
function applyHumanAction(s, w, action) {
  if (s.phase !== 'playing') return { ok: false, reason: 'game not in progress' };
  if (s.turn !== w) return { ok: false, reason: 'not your turn' };
  const p = s.players[w];
  if (p.isComputer) return { ok: false, reason: 'computer seat' };
  if (action.indexOf('play:') === 0) {
    const idx = parseInt(action.slice(5), 10);
    const r = applySideCard(s, w, idx);
    if (!r.ok) return r;
    if (p.total > TARGET && !canRescue(p)) { p.busted = true; glog(s, w + ' busted at ' + p.total + '!'); resolveRound(s); processAuto(s); }
    return { ok: true };
  }
  if (action === 'stand') { p.stood = true; glog(s, w + ' stands at ' + p.total); switchTurn(s); processAuto(s); return { ok: true }; }
  if (action === 'end') { glog(s, w + ' ends turn at ' + p.total); switchTurn(s); processAuto(s); return { ok: true }; }
  return { ok: false, reason: 'unknown action' };
}

// ========================= PRESENTATION =========================
function cardStr(c) { return c >= 0 ? '+' + c : String(c); }
function boardStr(p) {
  if (p.board.length === 0 && p.sidePlayed.length === 0) return '(empty)';
  const parts = [];
  for (let i = 0; i < p.board.length; i++) parts.push(String(p.board[i]));
  for (let j = 0; j < p.sidePlayed.length; j++) parts.push('[' + cardStr(p.sidePlayed[j]) + ']');
  return parts.join(' ');
}
function seatName(st, seat) {
  const p = st.players[seat];
  if (p.isComputer) return 'Computer';
  return p.name || ('<@' + p.id + '>');
}
function buildEmbed(st) {
  const p1 = st.players.p1, p2 = st.players.p2;
  const fields = [
    { name: seatName(st, 'p1') + ' - ' + p1.total + (p1.busted ? ' BUST' : (p1.stood ? ' STAND' : '')), value: 'Board: ' + boardStr(p1) + '\nSets: ' + p1.sets + '/' + WIN_SETS, inline: true },
    { name: seatName(st, 'p2') + ' - ' + p2.total + (p2.busted ? ' BUST' : (p2.stood ? ' STAND' : '')), value: 'Board: ' + boardStr(p2) + '\nSets: ' + p2.sets + '/' + WIN_SETS, inline: true },
  ];
  const desc = st.phase === 'gameOver'
    ? '**Match over - ' + seatName(st, st.winner) + ' wins!**'
    : 'Round ' + st.round + ' - Turn: ' + seatName(st, st.turn);
  const embed = { title: 'Pazaak', description: desc + '\n\n' + st.log.slice(-5).join('\n'), color: 5793266, fields };
  if (IMAGE_BASE_URL) embed.image = { url: IMAGE_BASE_URL + '/' + TABLE_IMAGE };
  return embed;
}
function buttonsFor(st, seat) {
  if (st.phase === 'gameOver') {
    return [{ type: 1, components: [
      { type: 2, style: 1, label: 'New game vs Computer', custom_id: 'pz|new|pvc' },
      { type: 2, style: 2, label: 'New PvP game', custom_id: 'pz|new|pvp' },
    ] }];
  }
  const rows = [];
  const p = st.players[seat];
  const cardRow = { type: 1, components: [] };
  for (let i = 0; i < p.hand.length && i < 4; i++) {
    cardRow.components.push({ type: 2, style: 1, label: cardStr(p.hand[i]), custom_id: 'pz|play|' + i, disabled: st.turn !== seat || p.playedThisTurn });
  }
  if (cardRow.components.length > 0) rows.push(cardRow);
  rows.push({ type: 1, components: [
    { type: 2, style: 3, label: 'Stand', custom_id: 'pz|stand', disabled: st.turn !== seat },
    { type: 2, style: 2, label: 'End Turn', custom_id: 'pz|end', disabled: st.turn !== seat },
  ] });
  return rows;
}
function joinButtons() { return [{ type: 1, components: [{ type: 2, style: 1, label: 'Join Game', custom_id: 'pz|join' }] }]; }

// =========================== STORAGE ===========================
const games = new Map(); // channelId -> state

// =========================== HANDLER ===========================
function parseInteraction(interaction) {
  const channel_id = interaction.channel_id || (interaction.channel && interaction.channel.id) || '';
  const member = interaction.member || {};
  const user = member.user || interaction.user || {};
  const out = {
    channel_id,
    user_id: user.id || '',
    user_name: user.global_name || user.username || 'Player',
    command: '', mode: 'pvc', action: '', interactionType: interaction.type,
  };
  if (interaction.type === 2) {
    out.command = 'start';
    const opts = (interaction.data && interaction.data.options) || [];
    for (let i = 0; i < opts.length; i++) if (opts[i].name === 'opponent') out.mode = opts[i].value === 'user' ? 'pvp' : 'pvc';
  } else if (interaction.type === 3) {
    const cid = (interaction.data && interaction.data.custom_id) || '';
    const parts = cid.split('|');
    if (parts[1] === 'join') out.command = 'join';
    else if (parts[1] === 'play') { out.command = 'move'; out.action = 'play:' + (parts[2] || '0'); }
    else if (parts[1] === 'stand') { out.command = 'move'; out.action = 'stand'; }
    else if (parts[1] === 'end') { out.command = 'move'; out.action = 'end'; }
    else if (parts[1] === 'new') { out.command = 'start'; out.mode = parts[2] === 'pvp' ? 'pvp' : 'pvc'; }
  }
  return out;
}
function ephemeral(content) { return { type: 4, data: { content, flags: 64 } }; }

function handleGame(interaction) {
  const hi = parseInteraction(interaction);
  const responseType = hi.interactionType === 2 ? 4 : 7;
  let st = games.get(hi.channel_id) || null;

  if (hi.command === 'start') {
    const seed = Math.floor(Math.random() * 2147483647) + 1;
    st = newGame(hi.mode, hi.user_id, hi.mode === 'pvp' ? '' : 'CPU', seed);
    st.players.p1.name = hi.user_name;
    st.players.p2.name = hi.mode === 'pvc' ? 'Computer' : '';
    st.joined = hi.mode === 'pvc';
  } else {
    if (!st) return ephemeral('No active game in this channel. Start one with /pazaak.');
    if (hi.command === 'join') {
      if (st.joined) return ephemeral('This game already has two players.');
      if (st.players.p1.id === hi.user_id) return ephemeral('You cannot join your own game.');
      st.players.p2.id = hi.user_id; st.players.p2.name = hi.user_name; st.players.p2.isComputer = false; st.joined = true;
    } else if (hi.command === 'move') {
      if (!st.joined) return ephemeral('Waiting for a second player to join.');
      const seat = st.players.p1.id === hi.user_id ? 'p1' : (st.players.p2.id === hi.user_id ? 'p2' : null);
      if (!seat) return ephemeral('You are not a player in this game.');
      const r = applyHumanAction(st, seat, hi.action);
      if (!r.ok) return ephemeral(r.reason);
    }
  }

  games.set(hi.channel_id, st);
  const components = st.joined ? buttonsFor(st, st.turn) : joinButtons();
  const embed = buildEmbed(st);
  if (!st.joined) embed.description = 'Player <@' + st.players.p1.id + '> started a PvP game. Press Join to play!';
  return { type: responseType, data: { embeds: [embed], components } };
}

// ============================ SERVER ============================
const app = express();

app.get('/', function (req, res) { res.status(200).send('Pazaak bot OK'); });

app.post('/interactions', express.raw({ type: '*/*' }), async function (req, res) {
  const signature = req.get('X-Signature-Ed25519');
  const timestamp = req.get('X-Signature-Timestamp');
  const rawBody = req.body; // Buffer
  if (!signature || !timestamp || !rawBody) return res.status(401).send('missing signature headers');

  let isValid = false;
  try {
    isValid = await nacl.verifyKey(rawBody, signature, timestamp, PUBLIC_KEY);
  } catch (e) { isValid = false; }
  if (!isValid) return res.status(401).send('invalid request signature');

  let interaction;
  try { interaction = JSON.parse(rawBody.toString('utf8')); } catch (e) { return res.status(400).send('invalid body'); }

  if (interaction.type === 1) return res.status(200).json({ type: 1 });
  if (interaction.type === 2 || interaction.type === 3) {
    try { return res.status(200).json(handleGame(interaction)); }
    catch (e) { console.error('handleGame error:', e); return res.status(200).json(ephemeral('Something went wrong.')); }
  }
  return res.status(200).json({ type: 1 });
});

app.listen(PORT, function () { console.log('Pazaak bot listening on port ' + PORT); });

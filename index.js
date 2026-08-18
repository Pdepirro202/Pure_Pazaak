// Pazaak Discord bot — typed cards, /deck builder, persistence, polished board.
'use strict';

const express = require('express');
const nacl = require('discord-interactions');
const E = require('./engine.js');
const store = require('./store.js');
const { renderBoard } = require('./board.js');

const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const PORT = process.env.PORT || 3000;
const IMAGE_BASE_URL = process.env.IMAGE_BASE_URL || 'https://raw.githubusercontent.com/Pdepirro202/Pazaak/main';

if (!PUBLIC_KEY) {
  console.error('FATAL: DISCORD_PUBLIC_KEY environment variable is not set.');
  process.exit(1);
}

// ========================= PRESENTATION =========================
function boardStr(p) {
  if (!p.placed.length) return '(empty)';
  return p.placed.map(function (e) {
    if (e.kind === 'main') return String(e.val);
    if (e.kind === 'flipcard') return '[flip]';
    if (e.kind === 'double') return '[x2]';
    return '[' + (e.val >= 0 ? '+' + e.val : e.val) + ']';
  }).join(' ');
}
function seatName(st, seat) {
  const p = st.players[seat];
  return p.isComputer ? 'Computer' : (p.name || ('<@' + p.id + '>'));
}
function buildEmbed(st) {
  const p1 = st.players.p1, p2 = st.players.p2;
  const fields = [
    { name: seatName(st, 'p1') + ' - ' + p1.total + (p1.busted ? ' BUST' : (p1.stood ? ' STAND' : '')), value: 'Board: ' + boardStr(p1) + '\nSets: ' + p1.sets + '/' + E.WIN_SETS, inline: true },
    { name: seatName(st, 'p2') + ' - ' + p2.total + (p2.busted ? ' BUST' : (p2.stood ? ' STAND' : '')), value: 'Board: ' + boardStr(p2) + '\nSets: ' + p2.sets + '/' + E.WIN_SETS, inline: true },
  ];
  const desc = st.phase === 'gameOver'
    ? '**Match over - ' + seatName(st, st.winner) + ' wins!**'
    : 'Round ' + st.round + ' - Turn: ' + seatName(st, st.turn);
  const embed = { title: 'Pazaak', description: desc + '\n\n' + st.log.slice(-6).join('\n'), color: 5793266, fields };
  if (st.boardUrl) embed.image = { url: st.boardUrl };
  return embed;
}
function gameButtons(st, seat) {
  if (st.phase === 'gameOver') {
    return [{ type: 1, components: [
      { type: 2, style: 1, label: 'New vs Computer', custom_id: 'pz|new|pvc' },
      { type: 2, style: 2, label: 'New PvP', custom_id: 'pz|new|pvp' },
    ] }];
  }
  const rows = [];
  const p = st.players[seat];
  const cardRow = { type: 1, components: [] };
  for (let i = 0; i < p.hand.length && i < 4; i++) {
    const code = p.hand[i];
    cardRow.components.push({
      type: 2, style: 1, label: E.cardLabel(code),
      custom_id: E.needsSign(code) ? 'pz|pick|' + i : 'pz|play|' + i,
      disabled: st.turn !== seat || p.playedThisTurn,
    });
  }
  if (cardRow.components.length) rows.push(cardRow);
  rows.push({ type: 1, components: [
    { type: 2, style: 3, label: 'Stand', custom_id: 'pz|stand', disabled: st.turn !== seat },
    { type: 2, style: 2, label: 'End Turn', custom_id: 'pz|end', disabled: st.turn !== seat },
  ] });
  return rows;
}
function signButtons(idx) {
  return [{ type: 1, components: [
    { type: 2, style: 3, label: 'Play as +', custom_id: 'pz|sign|' + idx + '|+' },
    { type: 2, style: 4, label: 'Play as -', custom_id: 'pz|sign|' + idx + '|-' },
  ] }];
}
function joinButtons() { return [{ type: 1, components: [{ type: 2, style: 1, label: 'Join Game', custom_id: 'pz|join' }] }]; }
function ephemeral(content, components) { const d = { content, flags: 64 }; if (components) d.components = components; return { type: 4, data: d }; }
function ephemeralUpdate(content) { return { type: 7, data: { content, embeds: [], components: [], flags: 64 } }; }

// ========================= DECK BUILDER =========================
function deckSummary(cards) {
  const counts = {};
  cards.forEach(function (c) { counts[c] = (counts[c] || 0) + 1; });
  return Object.keys(counts).map(function (c) { return E.cardLabel(c) + (counts[c] > 1 ? ' x' + counts[c] : ''); }).join(', ');
}
function deckBuilderView(cards) {
  const content = '**Your Pazaak side deck** (' + cards.length + '/' + E.DECK_SIZE + ')\n' +
    (cards.length ? deckSummary(cards) : '_empty_') +
    '\n\nPick cards to add. Deck must have exactly ' + E.DECK_SIZE + ' cards to save.';
  const opts = E.allCardCodes().map(function (c) { return { label: E.cardLabel(c), value: c, description: E.cardToImg(c) }; });
  const rows = [
    { type: 1, components: [{ type: 3, custom_id: 'pz|deckadd', placeholder: 'Add a card...', options: opts.slice(0, 25) }] },
    { type: 1, components: [
      { type: 2, style: 4, label: 'Clear', custom_id: 'pz|deckclear' },
      { type: 2, style: 2, label: 'Fill balanced', custom_id: 'pz|deckfill' },
      { type: 2, style: 3, label: 'Save deck', custom_id: 'pz|decksave', disabled: cards.length !== E.DECK_SIZE },
    ] },
  ];
  return { type: 4, data: { content, components: rows, flags: 64 } };
}

// ========================= INTERACTION PARSE =========================
function ctx(interaction) {
  const channel_id = interaction.channel_id || (interaction.channel && interaction.channel.id) || '';
  const member = interaction.member || {};
  const user = member.user || interaction.user || {};
  return { channel_id, user_id: user.id || '', user_name: user.global_name || user.username || 'Player', type: interaction.type };
}

const deckDraft = new Map();

async function recordResults(st) {
  const wSeat = st.winner, lSeat = wSeat === 'p1' ? 'p2' : 'p1';
  const w = st.players[wSeat], l = st.players[lSeat];
  if (w && !w.isComputer && w.id) await store.addResult(w.id, true);
  if (l && !l.isComputer && l.id) await store.addResult(l.id, false);
}

async function handle(interaction, baseUrl) {
  const c = ctx(interaction);

  if (interaction.type === 2) {
    const name = interaction.data && interaction.data.name;
    if (name === 'deck') {
      const saved = await store.getDeck(c.user_id);
      const draft = saved ? saved.slice() : [];
      deckDraft.set(c.user_id, draft);
      return deckBuilderView(draft);
    }
    if (name === 'stats') {
      const s = await store.getStats(c.user_id);
      return ephemeral('Your Pazaak record: **' + s.wins + 'W - ' + s.losses + 'L**');
    }
    if (name === 'pazaak') {
      let mode = 'pvc';
      const opts = (interaction.data.options) || [];
      for (let i = 0; i < opts.length; i++) if (opts[i].name === 'opponent') mode = opts[i].value === 'user' ? 'pvp' : 'pvc';
      return startGame(c, mode, baseUrl, 4);
    }
  }

  if (interaction.type === 3) {
    const cid = (interaction.data && interaction.data.custom_id) || '';
    const parts = cid.split('|');
    const kind = parts[1];

    if (kind === 'deckadd') {
      const draft = deckDraft.get(c.user_id) || [];
      const val = (interaction.data.values && interaction.data.values[0]) || '';
      if (val && draft.length < E.DECK_SIZE) draft.push(val);
      deckDraft.set(c.user_id, draft);
      return Object.assign(deckBuilderView(draft), { type: 7 });
    }
    if (kind === 'deckclear') { deckDraft.set(c.user_id, []); return Object.assign(deckBuilderView([]), { type: 7 }); }
    if (kind === 'deckfill') { const d = E.defaultDeck(); deckDraft.set(c.user_id, d.slice()); return Object.assign(deckBuilderView(d), { type: 7 }); }
    if (kind === 'decksave') {
      const draft = deckDraft.get(c.user_id) || [];
      if (draft.length !== E.DECK_SIZE) return ephemeralUpdate('Deck must have exactly ' + E.DECK_SIZE + ' cards.');
      await store.saveDeck(c.user_id, draft);
      return ephemeralUpdate('Saved your deck: ' + deckSummary(draft));
    }

    if (kind === 'new') return startGame(c, parts[2] === 'pvp' ? 'pvp' : 'pvc', baseUrl, 7);

    const st = await store.getGame(c.channel_id);
    if (!st) return ephemeral('No active game here. Start one with /pazaak.');

    if (kind === 'join') {
      if (st.joined) return ephemeral('This game already has two players.');
      if (st.players.p1.id === c.user_id) return ephemeral('You cannot join your own game.');
      const deck = (await store.getDeck(c.user_id)) || E.defaultDeck();
      st.players.p2.id = c.user_id; st.players.p2.name = c.user_name; st.players.p2.isComputer = false;
      st.players.p2.deck = deck; st.players.p2.hand = st.players.p2.hand;
      st.joined = true;
      return finish(st, c, baseUrl, 7);
    }
    if (kind === 'sign') {
      const idx = parseInt(parts[2], 10); const sign = parts[3];
      const seat = seatOf(st, c.user_id);
      if (!seat) return ephemeral('You are not in this game.');
      const r = E.applyHumanAction(st, seat, 'play:' + idx, sign);
      if (!r.ok) return ephemeral(r.reason);
      return finish(st, c, baseUrl, 7);
    }
    if (kind === 'play' || kind === 'stand' || kind === 'end') {
      const seat = seatOf(st, c.user_id);
      if (!seat) return ephemeral('You are not in this game.');
      const action = kind === 'play' ? 'play:' + parts[2] : kind;
      const r = E.applyHumanAction(st, seat, action, '');
      if (!r.ok) return ephemeral(r.reason);
      return finish(st, c, baseUrl, 7);
    }
  }
  return { type: 1 };
}

function seatOf(st, userId) {
  return st.players.p1.id === userId ? 'p1' : (st.players.p2.id === userId ? 'p2' : null);
}
async function startGame(c, mode, baseUrl, responseType) {
  const seed = Math.floor(Math.random() * 2147483647) + 1;
  const deck1 = (await store.getDeck(c.user_id)) || E.defaultDeck();
  const deck2 = mode === 'pvc' ? E.defaultDeck() : E.defaultDeck();
  const st = E.newGame(mode, c.user_id, mode === 'pvp' ? '' : 'CPU', seed, deck1, deck2);
  st.players.p1.name = c.user_name;
  st.players.p2.name = mode === 'pvc' ? 'Computer' : '';
  st.joined = mode === 'pvc';
  return finish(st, c, baseUrl, responseType);
}

async function finish(st, c, baseUrl, responseType) {
  if (st.phase === 'gameOver' && !st.recorded) { st.recorded = true; await recordResults(st); }
  st.rev = (st.rev || 0) + 1;
  if (baseUrl) st.boardUrl = baseUrl + '/board/' + encodeURIComponent(c.channel_id) + '.png?v=' + st.rev;
  await store.saveGame(c.channel_id, st);
  const embed = buildEmbed(st);
  let components;
  if (!st.joined) { embed.description = 'Player <@' + st.players.p1.id + '> started a PvP game. Press Join to play!'; components = joinButtons(); }
  else components = gameButtons(st, st.turn);
  return { type: responseType, data: { embeds: [embed], components } };
}

async function handlePick(interaction, baseUrl) {
  const c = ctx(interaction);
  const st = await store.getGame(c.channel_id);
  if (!st) return ephemeral('No active game here.');
  const parts = interaction.data.custom_id.split('|');
  const idx = parseInt(parts[2], 10);
  const seat = seatOf(st, c.user_id);
  if (!seat || st.turn !== seat) return ephemeral('It is not your turn.');
  const p = st.players[seat];
  if (p.playedThisTurn) return ephemeral('You already played a card this turn.');
  const code = p.hand[idx];
  if (!code) return ephemeral('Invalid card.');
  return { type: 7, data: { embeds: [buildEmbed(st)], components: signButtons(idx) } };
}

// ============================ SERVER ============================
const app = express();
app.get('/', function (req, res) { res.status(200).send('Pazaak bot OK'); });
app.get('/board/:id.png', async function (req, res) {
  try {
    const st = await store.getGame(req.params.id);
    if (!st) return res.status(404).send('no game');
    const buf = await renderBoard(st);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=30');
    return res.status(200).send(buf);
  } catch (e) { console.error('board error:', e); return res.status(500).send('render error'); }
});

app.post('/interactions', express.raw({ type: '*/*' }), async function (req, res) {
  const signature = req.get('X-Signature-Ed25519');
  const timestamp = req.get('X-Signature-Timestamp');
  const rawBody = req.body;
  if (!signature || !timestamp || !rawBody) return res.status(401).send('missing signature headers');
  let isValid = false;
  try { isValid = await nacl.verifyKey(rawBody, signature, timestamp, PUBLIC_KEY); } catch (e) { isValid = false; }
  if (!isValid) return res.status(401).send('invalid request signature');

  let interaction;
  try { interaction = JSON.parse(rawBody.toString('utf8')); } catch (e) { return res.status(400).send('invalid body'); }

  if (interaction.type === 1) return res.status(200).json({ type: 1 });
  const baseUrl = 'https://' + req.get('host');
  try {
    if (interaction.type === 3 && (interaction.data.custom_id || '').split('|')[1] === 'pick') {
      return res.status(200).json(await handlePick(interaction, baseUrl));
    }
    if (interaction.type === 2 || interaction.type === 3) {
      return res.status(200).json(await handle(interaction, baseUrl));
    }
  } catch (e) {
    console.error('handle error:', e);
    return res.status(200).json(ephemeral('Something went wrong.'));
  }
  return res.status(200).json({ type: 1 });
});

store.init().then(function () {
  app.listen(PORT, function () { console.log('Pazaak bot listening on port ' + PORT); });
}).catch(function (e) { console.error('store init failed:', e); process.exit(1); });

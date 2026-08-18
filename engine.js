'use strict';
// Pazaak engine with typed side cards (KOTOR-style).
// Card codes: p1..p6 (+N), m1..m6 (-N), d1..d6 (dual ±N, choose sign),
//             f12/f34/f56 (flip: flip sign of your placed cards of those magnitudes),
//             t (tiebreaker ±1, wins tied sets), D (double: doubles your last placed card).

const WIN_SETS = 3, HAND_SIZE = 4, DECK_SIZE = 10, TARGET = 20;

function cardToImg(code) {
  if (code[0] === 'p') return 'plus_' + code.slice(1) + '.png';
  if (code[0] === 'm') return 'minus_' + code.slice(1) + '.png';
  if (code[0] === 'd') return 'flip_plusminus_' + code.slice(1) + '.png';
  if (code[0] === 'f') return 'plusminus_' + code[1] + 'and' + code[2] + '.png';
  if (code === 't') return 'plusminus_1T.png';
  if (code === 'D') return 'D.png';
  return 'D.png';
}
function cardLabel(code) {
  if (code[0] === 'p') return '+' + code.slice(1);
  if (code[0] === 'm') return '-' + code.slice(1);
  if (code[0] === 'd') return '\u00B1' + code.slice(1);
  if (code[0] === 'f') return 'Flip ' + code[1] + '&' + code[2];
  if (code === 't') return '\u00B11 (T)';
  if (code === 'D') return 'Double';
  return code;
}
function needsSign(code) { return code[0] === 'd' || code === 't'; }
function cardMag(code) {
  if (code[0] === 'p' || code[0] === 'm' || code[0] === 'd') return parseInt(code.slice(1), 10);
  if (code === 't') return 1;
  return 0;
}
function allCardCodes() {
  const out = [];
  for (let n = 1; n <= 6; n++) out.push('p' + n);
  for (let n = 1; n <= 6; n++) out.push('m' + n);
  for (let n = 1; n <= 6; n++) out.push('d' + n);
  out.push('f12', 'f34', 'f56', 't', 'D');
  return out;
}
function defaultDeck() {
  return ['p1', 'p2', 'p3', 'm1', 'm2', 'm3', 'd4', 'd5', 'f34', 't'];
}

function nextRand(s) {
  let a = s.rngState | 0;
  a = (a + 0x6D2B79F5) | 0;
  s.rngState = a >>> 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function drawMainCard(s) { return 1 + Math.floor(nextRand(s) * 10); }

function drawHand(s, deck) {
  const pool = deck.slice();
  const hand = [];
  const n = Math.min(HAND_SIZE, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(nextRand(s) * pool.length);
    hand.push(pool.splice(idx, 1)[0]);
  }
  return hand;
}

function totalOf(p) { let t = 0; for (let i = 0; i < p.placed.length; i++) t += p.placed[i].val; return t; }

function newPlayer(s, id, isComputer, deck) {
  return {
    id, isComputer: !!isComputer, name: '',
    deck: (deck && deck.length ? deck.slice() : defaultDeck()),
    placed: [], hand: [], total: 0,
    stood: false, busted: false, playedThisTurn: false, tiebreaker: false, sets: 0,
  };
}

function other(w) { return w === 'p1' ? 'p2' : 'p1'; }
function glog(s, m) { s.log.push(m); if (s.log.length > 10) s.log.shift(); }

function newGame(mode, p1id, p2id, seed, deck1, deck2) {
  const s = { mode, rngState: (seed >>> 0) || 1, turn: 'p1', round: 1, phase: 'playing', log: [], winner: null, players: {} };
  s.players.p1 = newPlayer(s, p1id, false, deck1);
  s.players.p2 = newPlayer(s, p2id, mode === 'pvc', deck2);
  s.players.p1.hand = drawHand(s, s.players.p1.deck);
  s.players.p2.hand = drawHand(s, s.players.p2.deck);
  beginTurn(s); processAuto(s);
  return s;
}

function beginTurn(s) {
  const w = s.turn, p = s.players[w];
  p.playedThisTurn = false;
  if (p.stood || p.busted) return;
  const c = drawMainCard(s);
  p.placed.push({ val: c, img: 'green_' + c + '.png', mag: c, kind: 'main' });
  p.total = totalOf(p);
  glog(s, w + ' drew ' + c + ' (total ' + p.total + ')');
  if (p.total > TARGET) {
    if (!canRescue(p)) { p.busted = true; glog(s, w + ' busted at ' + p.total + '!'); resolveRound(s); }
  } else if (p.total === TARGET) {
    p.stood = true; glog(s, w + ' hit 20 and stands'); switchTurn(s);
  }
}

function canRescue(p) {
  if (p.playedThisTurn) return false;
  for (let i = 0; i < p.hand.length; i++) {
    const opts = cardResultDeltas(p, p.hand[i]);
    for (let k = 0; k < opts.length; k++) if (p.total + opts[k].delta <= TARGET) return true;
  }
  return false;
}

function cardResultDeltas(p, code) {
  if (code[0] === 'p') return [{ delta: +cardMag(code), choice: '' }];
  if (code[0] === 'm') return [{ delta: -cardMag(code), choice: '' }];
  if (code[0] === 'd') return [{ delta: +cardMag(code), choice: '+' }, { delta: -cardMag(code), choice: '-' }];
  if (code === 't') return [{ delta: +1, choice: '+' }, { delta: -1, choice: '-' }];
  if (code === 'D') { const last = p.placed[p.placed.length - 1]; return [{ delta: last ? last.val : 0, choice: '' }]; }
  if (code[0] === 'f') {
    const a = parseInt(code[1], 10), b = parseInt(code[2], 10);
    let d = 0;
    for (let i = 0; i < p.placed.length; i++) {
      const e = p.placed[i];
      if ((e.kind === 'side') && (e.mag === a || e.mag === b)) d += (-2 * e.val);
    }
    return [{ delta: d, choice: '' }];
  }
  return [{ delta: 0, choice: '' }];
}

function applyCard(s, w, handIndex, choice) {
  const p = s.players[w];
  if (p.playedThisTurn) return { ok: false, reason: 'You already played a card this turn.' };
  if (handIndex < 0 || handIndex >= p.hand.length) return { ok: false, reason: 'Invalid card.' };
  const code = p.hand[handIndex];

  if (code[0] === 'f') {
    const a = parseInt(code[1], 10), b = parseInt(code[2], 10);
    for (let i = 0; i < p.placed.length; i++) {
      const e = p.placed[i];
      if (e.kind === 'side' && (e.mag === a || e.mag === b)) {
        e.val = -e.val;
        e.img = e.val >= 0 ? 'plus_' + e.mag + '.png' : 'minus_' + e.mag + '.png';
      }
    }
    p.placed.push({ val: 0, img: cardToImg(code), mag: 0, kind: 'flipcard' });
  } else if (code === 'D') {
    const last = p.placed[p.placed.length - 1];
    const add = last ? last.val : 0;
    p.placed.push({ val: add, img: 'D.png', mag: 0, kind: 'double' });
  } else if (code[0] === 'd') {
    const sign = choice === '-' ? -1 : 1;
    const mag = cardMag(code);
    p.placed.push({ val: sign * mag, img: cardToImg(code), mag: mag, kind: 'side' });
  } else if (code === 't') {
    const sign = choice === '-' ? -1 : 1;
    p.placed.push({ val: sign * 1, img: cardToImg(code), mag: 1, kind: 'side' });
    p.tiebreaker = true;
  } else if (code[0] === 'p') {
    p.placed.push({ val: +cardMag(code), img: cardToImg(code), mag: cardMag(code), kind: 'side' });
  } else if (code[0] === 'm') {
    p.placed.push({ val: -cardMag(code), img: cardToImg(code), mag: cardMag(code), kind: 'side' });
  }

  p.hand.splice(handIndex, 1);
  p.playedThisTurn = true;
  p.total = totalOf(p);
  glog(s, w + ' played ' + cardLabel(code) + (choice ? choice : '') + ' (total ' + p.total + ')');
  return { ok: true };
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
  else {
    if (p1.tiebreaker && !p2.tiebreaker) w = 'p1';
    else if (p2.tiebreaker && !p1.tiebreaker) w = 'p2';
    else w = null;
  }
  if (w) { s.players[w].sets += 1; glog(s, 'Round ' + s.round + ' to ' + (w === 'p1' ? p1.name || 'P1' : p2.name || 'P2') + ' (' + p1.total + ' vs ' + p2.total + '). Sets ' + p1.sets + '-' + p2.sets); }
  else { glog(s, 'Round ' + s.round + ' tied (' + p1.total + ' vs ' + p2.total + ').'); }
  if (p1.sets >= WIN_SETS || p2.sets >= WIN_SETS) {
    s.phase = 'gameOver'; s.winner = p1.sets >= WIN_SETS ? 'p1' : 'p2';
    glog(s, 'Match over - ' + (s.players[s.winner].name || s.winner) + ' wins!'); return;
  }
  s.phase = 'playing'; s.round += 1;
  resetRound(s, w ? other(w) : 'p1');
}

function resetRound(s, starter) {
  ['p1', 'p2'].forEach(function (k) {
    const p = s.players[k];
    p.placed = []; p.total = 0; p.stood = false; p.busted = false; p.playedThisTurn = false; p.tiebreaker = false;
  });
  s.turn = starter; beginTurn(s);
}

function processAuto(s) {
  let g = 0;
  while (s.phase === 'playing' && g++ < 300) {
    const w = s.turn, p = s.players[w];
    if (p.stood || p.busted) { switchTurn(s); continue; }
    if (!p.isComputer) break;
    computerTakeTurn(s);
  }
}

function computerTakeTurn(s) {
  const w = s.turn, p = s.players[w];
  if (p.total > TARGET) bestRescue(s, w);
  else if (p.total >= 18 && p.total < TARGET) bestToTwenty(s, w);
  if (p.total > TARGET) { p.busted = true; glog(s, w + ' busted at ' + p.total + '!'); resolveRound(s); return; }
  if (p.total >= 18) { p.stood = true; glog(s, w + ' stands at ' + p.total); switchTurn(s); return; }
  glog(s, w + ' ends turn at ' + p.total); switchTurn(s);
}
function bestRescue(s, w) {
  const p = s.players[w];
  if (p.playedThisTurn) return;
  let bi = -1, bc = '', bt = -Infinity;
  for (let i = 0; i < p.hand.length; i++) {
    const opts = cardResultDeltas(p, p.hand[i]);
    for (let k = 0; k < opts.length; k++) {
      const nt = p.total + opts[k].delta;
      if (nt <= TARGET && nt > bt) { bt = nt; bi = i; bc = opts[k].choice; }
    }
  }
  if (bi >= 0) applyCard(s, w, bi, bc);
}
function bestToTwenty(s, w) {
  const p = s.players[w];
  if (p.playedThisTurn) return;
  let bi = -1, bc = '', bt = -Infinity;
  for (let i = 0; i < p.hand.length; i++) {
    const opts = cardResultDeltas(p, p.hand[i]);
    for (let k = 0; k < opts.length; k++) {
      const nt = p.total + opts[k].delta;
      if (nt <= TARGET && nt > bt) { bt = nt; bi = i; bc = opts[k].choice; }
    }
  }
  if (bi >= 0 && bt > p.total) applyCard(s, w, bi, bc);
}

function applyHumanAction(s, w, action, choice) {
  if (s.phase !== 'playing') return { ok: false, reason: 'Game is not in progress.' };
  if (s.turn !== w) return { ok: false, reason: 'It is not your turn.' };
  const p = s.players[w];
  if (p.isComputer) return { ok: false, reason: 'That seat is the computer.' };
  if (action.indexOf('play:') === 0) {
    const idx = parseInt(action.slice(5), 10);
    const r = applyCard(s, w, idx, choice || '');
    if (!r.ok) return r;
    if (p.total > TARGET && !canRescue(p)) { p.busted = true; glog(s, w + ' busted at ' + p.total + '!'); resolveRound(s); processAuto(s); }
    return { ok: true };
  }
  if (action === 'stand') { p.stood = true; glog(s, w + ' stands at ' + p.total); switchTurn(s); processAuto(s); return { ok: true }; }
  if (action === 'end') { glog(s, w + ' ends turn at ' + p.total); switchTurn(s); processAuto(s); return { ok: true }; }
  return { ok: false, reason: 'Unknown action.' };
}

module.exports = {
  WIN_SETS, HAND_SIZE, DECK_SIZE, TARGET,
  cardToImg, cardLabel, needsSign, cardMag, allCardCodes, defaultDeck,
  newGame, applyHumanAction, applyCard, totalOf, canRescue,
};

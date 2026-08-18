'use strict';
// Board image compositor: draws the 9-slot grid, placed card faces,
// a turn highlight, and the active player's hand face-up.
const Jimp = require('jimp');

const IMAGE_BASE_URL = process.env.IMAGE_BASE_URL || 'https://raw.githubusercontent.com/Pdepirro202/Pazaak/main';

const CARD_W = 110, CARD_H = 154, GAP = 10, PAD = 22, LABEL_H = 30, SLOTS = 9, HAND_GAP = 26;

const cache = new Map();
let font = null, fontBig = null;

async function loadFonts() {
  if (!font) font = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
  if (!fontBig) fontBig = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
}
async function getCard(filename) {
  if (cache.has(filename)) return cache.get(filename);
  const res = await fetch(IMAGE_BASE_URL + '/' + filename);
  if (!res.ok) throw new Error('fetch ' + filename + ' -> ' + res.status);
  const img = await Jimp.read(Buffer.from(await res.arrayBuffer()));
  img.resize(CARD_W, CARD_H);
  cache.set(filename, img);
  return img;
}
function emptySlot() {
  const s = new Jimp(CARD_W, CARD_H, 0x00000033);
  for (let x = 0; x < CARD_W; x++) { s.setPixelColor(0x2f6b4fff, x, 0); s.setPixelColor(0x2f6b4fff, x, CARD_H - 1); }
  for (let y = 0; y < CARD_H; y++) { s.setPixelColor(0x2f6b4fff, 0, y); s.setPixelColor(0x2f6b4fff, CARD_W - 1, y); }
  return s;
}

async function renderBoard(state) {
  await loadFonts();
  const seats = ['p1', 'p2'];
  const width = PAD * 2 + SLOTS * CARD_W + (SLOTS - 1) * GAP;
  const rowH = LABEL_H + CARD_H + PAD;
  const handH = LABEL_H + CARD_H + PAD;
  const height = PAD + 2 * rowH + handH;
  const canvas = new Jimp(width, height, 0x0b3d2eff);
  const slot = emptySlot();

  for (let r = 0; r < 2; r++) {
    const seat = seats[r];
    const p = state.players[seat];
    const y0 = PAD + r * rowH;
    if (state.phase === 'playing' && state.turn === seat) {
      const band = new Jimp(width - 8, rowH - 6, 0xf5c84233);
      canvas.composite(band, 4, y0 - 4);
    }
    const name = p.isComputer ? 'Computer' : (p.name || 'Player');
    const status = p.busted ? ' - BUST' : (p.stood ? ' - STAND' : '');
    const arrow = (state.phase === 'playing' && state.turn === seat) ? '> ' : '';
    canvas.print(font, PAD, y0, arrow + name + '   Total ' + p.total + '   Sets ' + p.sets + '/3' + status);
    const cy = y0 + LABEL_H;
    for (let i = 0; i < SLOTS; i++) {
      const cx = PAD + i * (CARD_W + GAP);
      canvas.composite(slot, cx, cy);
      const placed = p.placed[i];
      if (placed) {
        try { canvas.composite(await getCard(placed.img), cx, cy); }
        catch (e) { canvas.composite(new Jimp(CARD_W, CARD_H, 0x333333ff), cx, cy); }
      }
    }
  }

  const hy = PAD + 2 * rowH;
  const active = state.players[state.turn] || state.players.p1;
  canvas.print(font, PAD, hy, (active.name || 'Player') + "'s hand:");
  const hcy = hy + LABEL_H;
  for (let i = 0; i < active.hand.length; i++) {
    const cx = PAD + i * (CARD_W + HAND_GAP);
    try { canvas.composite(await getCard(cardImg(active.hand[i])), cx, hcy); }
    catch (e) { canvas.composite(new Jimp(CARD_W, CARD_H, 0x333333ff), cx, hcy); }
  }

  return canvas.getBufferAsync(Jimp.MIME_PNG);
}

function cardImg(code) {
  if (code[0] === 'p') return 'plus_' + code.slice(1) + '.png';
  if (code[0] === 'm') return 'minus_' + code.slice(1) + '.png';
  if (code[0] === 'd') return 'flip_plusminus_' + code.slice(1) + '.png';
  if (code[0] === 'f') return 'plusminus_' + code[1] + 'and' + code[2] + '.png';
  if (code === 't') return 'plusminus_1T.png';
  if (code === 'D') return 'D.png';
  return 'D.png';
}

module.exports = { renderBoard };

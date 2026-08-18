'use strict';
// Board image compositor: stitches the current cards onto one image.
const Jimp = require('jimp');

const IMAGE_BASE_URL = process.env.IMAGE_BASE_URL || 'https://raw.githubusercontent.com/Pdepirro202/Pazaak/main';

const CARD_W = 120, CARD_H = 168, GAP = 12, PAD = 24, LABEL_H = 34, SLOTS = 9;

const rawCache = new Map();   // filename -> Jimp image (card size)
let fontTitle = null, fontSmall = null;

async function loadFonts() {
  if (!fontTitle) fontTitle = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
  if (!fontSmall) fontSmall = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
}

async function getCard(filename) {
  if (rawCache.has(filename)) return rawCache.get(filename);
  const url = IMAGE_BASE_URL + '/' + filename;
  const res = await fetch(url);
  if (!res.ok) throw new Error('fetch ' + filename + ' -> ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  const img = await Jimp.read(buf);
  img.resize(CARD_W, CARD_H);
  rawCache.set(filename, img);
  return img;
}

// Map a board main-deck value (1..10) to its file.
function mainFile(v) { return 'green_' + v + '.png'; }
// Map a played side value (signed) to its file.
function sideFile(v) { return (v >= 0 ? 'plus_' + v : 'minus_' + Math.abs(v)) + '.png'; }

// Collect the ordered list of card filenames a player currently shows.
function playerFiles(p) {
  const files = [];
  for (let i = 0; i < p.board.length; i++) files.push(mainFile(p.board[i]));
  for (let j = 0; j < p.sidePlayed.length; j++) files.push(sideFile(p.sidePlayed[j]));
  return files;
}

function rowY(rowIndex) {
  return PAD + rowIndex * (LABEL_H + CARD_H + PAD);
}

async function renderBoard(state) {
  await loadFonts();
  const p1 = state.players.p1, p2 = state.players.p2;
  const f1 = playerFiles(p1), f2 = playerFiles(p2);

  const width = PAD * 2 + SLOTS * CARD_W + (SLOTS - 1) * GAP;
  const height = PAD + 2 * (LABEL_H + CARD_H + PAD);

  const canvas = new Jimp(width, height, 0x0b3d2eff); // dark green felt

  async function drawRow(rowIndex, seat, files) {
    const p = state.players[seat];
    const name = (p.isComputer ? 'Computer' : (p.name || 'Player'));
    const status = p.busted ? ' - BUST' : (p.stood ? ' - STAND' : '');
    const label = name + '  (' + p.total + ')  Sets ' + p.sets + '/3' + status;
    const y0 = rowY(rowIndex);
    canvas.print(fontSmall, PAD, y0, label);
    const cy = y0 + LABEL_H;
    for (let i = 0; i < files.length && i < SLOTS; i++) {
      const cx = PAD + i * (CARD_W + GAP);
      try {
        const card = await getCard(files[i]);
        canvas.composite(card, cx, cy);
      } catch (e) {
        const ph = new Jimp(CARD_W, CARD_H, 0x333333ff);
        canvas.composite(ph, cx, cy);
      }
    }
  }

  await drawRow(0, 'p1', f1);
  await drawRow(1, 'p2', f2);

  return canvas.getBufferAsync(Jimp.MIME_PNG);
}

module.exports = { renderBoard };

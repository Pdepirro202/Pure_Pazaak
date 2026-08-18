'use strict';
// Board image compositor styled after the KOTOR Pazaak table:
// brushed-metal frame, two 3x3 card grids, center score bubbles,
// red set pips on the sides, Player/Opponent hand rows, and the
// End Turn / Stand / Forfeit button panels.
const Jimp = require('jimp');

const IMAGE_BASE_URL = process.env.IMAGE_BASE_URL || 'https://raw.githubusercontent.com/Pdepirro202/Pazaak/main';

// ---- geometry ----
const CARD_W = 92, CARD_H = 128;         // single card size
const GRID_GAP = 10;                     // gap between cards in a grid
const COLS = 3, ROWS = 3;                // 3x3 = 9 slots per player
const GRID_W = COLS * CARD_W + (COLS - 1) * GRID_GAP;
const GRID_H = ROWS * CARD_H + (ROWS - 1) * GRID_GAP;

const PIP_COL_W = 70;                    // side columns that hold the set pips
const CENTER_W = 200;                    // center gutter with score bubbles
const TOP_H = 90;                        // top bar (names + scores)
const HAND_LABEL_H = 34;
const HAND_H = CARD_H + HAND_LABEL_H + 20;
const BTN_H = 120;                       // bottom button strip
const MARGIN = 26;

const WIDTH = MARGIN * 2 + PIP_COL_W * 2 + GRID_W * 2 + CENTER_W;
const HEIGHT = MARGIN + TOP_H + GRID_H + 24 + HAND_H + BTN_H + MARGIN;

// ---- colors (0xRRGGBBAA) ----
const C = {
  metalDark:  0x5f646aff,
  metalEdgeH: 0xd7dbe0ff, // highlight edge
  metalEdgeD: 0x3a3d41ff, // shadow edge
  panelDark:  0x24272bff,
  slotBlack:  0x101215ff,
  slotEdge:   0x000000ff,
  bubble:     0x07090bff,
  bubbleRim:  0x000000ff,
  pipLit:     0xd52a2aff,
  pipLitRim:  0xff6a6aff,
  pipDim:     0x4a1c1cff,
  gold:       0xf3c53fff,
  black:      0x000000ff,
  white:      0xffffffff,
  cardMiss:   0x2a2d31ff,
};

const cache = new Map();
let font16 = null, font32 = null, font16b = null, font64 = null;

async function loadFonts() {
  if (!font16)  font16  = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
  if (!font32)  font32  = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
  if (!font64)  font64  = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);
  if (!font16b) font16b = await Jimp.loadFont(Jimp.FONT_SANS_16_BLACK);
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

// ---- low level drawing helpers ----
function setPx(img, x, y, color) {
  if (x < 0 || y < 0 || x >= img.bitmap.width || y >= img.bitmap.height) return;
  img.setPixelColor(color, x | 0, y | 0);
}
function fillRect(img, x, y, w, h, color) {
  x |= 0; y |= 0; w |= 0; h |= 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) setPx(img, x + i, y + j, color);
}
function strokeRect(img, x, y, w, h, color, t) {
  t = t || 1;
  for (let k = 0; k < t; k++) {
    for (let i = 0; i < w; i++) { setPx(img, x + i, y + k, color); setPx(img, x + i, y + h - 1 - k, color); }
    for (let j = 0; j < h; j++) { setPx(img, x + k, y + j, color); setPx(img, x + w - 1 - k, y + j, color); }
  }
}
// raised metal panel: light top/left edge, dark bottom/right edge
function raisedPanel(img, x, y, w, h, face) {
  fillRect(img, x, y, w, h, face);
  for (let i = 0; i < w; i++) { setPx(img, x + i, y, C.metalEdgeH); setPx(img, x + i, y + 1, C.metalEdgeH); }
  for (let j = 0; j < h; j++) { setPx(img, x, y + j, C.metalEdgeH); setPx(img, x + 1, y + j, C.metalEdgeH); }
  for (let i = 0; i < w; i++) { setPx(img, x + i, y + h - 1, C.metalEdgeD); setPx(img, x + i, y + h - 2, C.metalEdgeD); }
  for (let j = 0; j < h; j++) { setPx(img, x + w - 1, y + j, C.metalEdgeD); setPx(img, x + w - 2, y + j, C.metalEdgeD); }
}
// recessed slot: dark fill, dark edge top/left, light edge bottom/right (inverse bevel)
function recessedSlot(img, x, y, w, h, face) {
  fillRect(img, x, y, w, h, face);
  for (let i = 0; i < w; i++) { setPx(img, x + i, y, C.metalEdgeD); }
  for (let j = 0; j < h; j++) { setPx(img, x, y + j, C.metalEdgeD); }
  for (let i = 0; i < w; i++) { setPx(img, x + i, y + h - 1, C.metalEdgeH); }
  for (let j = 0; j < h; j++) { setPx(img, x + w - 1, y + j, C.metalEdgeH); }
}
function fillEllipse(img, cx, cy, rx, ry, color) {
  for (let y = -ry; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++) {
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) setPx(img, cx + x, cy + y, color);
    }
  }
}
function ringEllipse(img, cx, cy, rx, ry, color, t) {
  t = t || 2;
  for (let y = -ry; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++) {
      const v = (x * x) / (rx * rx) + (y * y) / (ry * ry);
      if (v <= 1 && v >= 1 - t * 0.06) setPx(img, cx + x, cy + y, color);
    }
  }
}
function rowHash(y) { let h = (y * 2246822519) >>> 0; h ^= h >>> 13; h = (h * 3266489917) >>> 0; return (h >>> 24) & 0xff; }
function pxHash(x, y) { let h = ((x * 374761393 + y * 668265263) >>> 0); h ^= h >>> 15; h = (h * 2246822519) >>> 0; return (h >>> 24) & 0xff; }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

function brushedMetal(w, h) {
  const img = new Jimp(w, h, 0x000000ff);
  img.scan(0, 0, w, h, function (x, y, idx) {
    const rowDelta = (rowHash(y) / 255) * 14 - 7;          // horizontal brushed streaks
    const sparkle = (pxHash(x, y) & 3) - 1;                 // faint grain
    const vign = -Math.abs(y - h / 2) / h * 10;             // subtle vertical shading
    const val = clamp(Math.round(0x9c + rowDelta + sparkle + vign), 0x66, 0xcc);
    this.bitmap.data[idx] = val;
    this.bitmap.data[idx + 1] = val + 1;
    this.bitmap.data[idx + 2] = val + 6;                    // slight cool tint
    this.bitmap.data[idx + 3] = 255;
  });
  return img;
}

function centerText(img, font, cx, y, text) {
  const w = Jimp.measureText(font, text);
  img.print(font, Math.round(cx - w / 2), y, text);
}
// tint a run of white bitmap text to gold by drawing to a temp then recoloring
function printGold(img, font, x, y, text) {
  const w = Jimp.measureText(font, text) + 4;
  const h = Jimp.measureTextHeight(font, text, w) + 4;
  const tmp = new Jimp(w, h, 0x00000000);
  tmp.print(font, 0, 0, text);
  tmp.scan(0, 0, w, h, function (px, py, idx) {
    const a = this.bitmap.data[idx + 3];
    if (a > 20) {
      this.bitmap.data[idx] = 0xf3;
      this.bitmap.data[idx + 1] = 0xc5;
      this.bitmap.data[idx + 2] = 0x3f;
    }
  });
  img.composite(tmp, x, y);
}

// ---- main render ----
async function renderBoard(state) {
  await loadFonts();
  const canvas = brushedMetal(WIDTH, HEIGHT);

  const p1 = state.players.p1;
  const p2 = state.players.p2;
  const playing = state.phase === 'playing';

  // outer frame bevel
  raisedPanel(canvas, 6, 6, WIDTH - 12, HEIGHT - 12, 0x9ea2a8ff);
  // re-brush the interior so the panel fill doesn't flatten the texture
  const inner = brushedMetal(WIDTH - 40, HEIGHT - 40);
  canvas.composite(inner, 20, 20);

  // ---- top bar: name plates + score bubbles ----
  const nameBarY = MARGIN;
  const leftPlateX = MARGIN + PIP_COL_W;
  const rightPlateX = MARGIN + PIP_COL_W + GRID_W + CENTER_W;
  // dark name plates
  fillRect(canvas, leftPlateX, nameBarY, GRID_W, 34, C.panelDark);
  strokeRect(canvas, leftPlateX, nameBarY, GRID_W, 34, C.metalEdgeD, 1);
  fillRect(canvas, rightPlateX, nameBarY, GRID_W, 34, C.panelDark);
  strokeRect(canvas, rightPlateX, nameBarY, GRID_W, 34, C.metalEdgeD, 1);

  const p1name = p1.isComputer ? 'Computer' : (p1.name || 'Player');
  const p2name = p2.isComputer ? 'Computer' : (p2.name || 'Opponent');
  canvas.print(font16, leftPlateX + 12, nameBarY + 7, p1name.toUpperCase());
  const p2w = Jimp.measureText(font16, p2name.toUpperCase());
  canvas.print(font16, rightPlateX + GRID_W - 12 - p2w, nameBarY + 7, p2name.toUpperCase());

  // player status LED next to the name (red = active turn)
  fillEllipse(canvas, leftPlateX - 18, nameBarY + 17, 12, 12,
    (playing && state.turn === 'p1') ? C.pipLit : C.pipDim);
  ringEllipse(canvas, leftPlateX - 18, nameBarY + 17, 12, 12, C.metalEdgeD, 2);
  fillEllipse(canvas, rightPlateX + GRID_W + 18, nameBarY + 17, 12, 12,
    (playing && state.turn === 'p2') ? C.pipLit : C.pipDim);
  ringEllipse(canvas, rightPlateX + GRID_W + 18, nameBarY + 17, 12, 12, C.metalEdgeD, 2);

  // center score bubbles
  const centerX = MARGIN + PIP_COL_W + GRID_W + CENTER_W / 2;
  const bubbleY = nameBarY + 26;
  const bx1 = centerX - 52, bx2 = centerX + 52;
  fillEllipse(canvas, bx1, bubbleY, 46, 30, C.bubble);
  ringEllipse(canvas, bx1, bubbleY, 46, 30, C.metalEdgeH, 2);
  fillEllipse(canvas, bx2, bubbleY, 46, 30, C.bubble);
  ringEllipse(canvas, bx2, bubbleY, 46, 30, C.metalEdgeH, 2);
  centerText(canvas, font32, bx1, bubbleY - 18, String(p1.total));
  centerText(canvas, font32, bx2, bubbleY - 18, String(p2.total));

  // ---- set pips on the side columns (best of, /3) ----
  const gridTop = MARGIN + TOP_H;
  const pipGap = (GRID_H - 3 * 24) / 4;
  for (let i = 0; i < 3; i++) {
    const py = gridTop + pipGap + i * (24 + pipGap) + 12;
    // left = p1
    const lx = MARGIN + PIP_COL_W / 2;
    fillEllipse(canvas, lx, py, 16, 16, i < p1.sets ? C.pipLit : C.pipDim);
    ringEllipse(canvas, lx, py, 16, 16, i < p1.sets ? C.pipLitRim : C.metalEdgeD, 2);
    // right = p2
    const rx = WIDTH - MARGIN - PIP_COL_W / 2;
    fillEllipse(canvas, rx, py, 16, 16, i < p2.sets ? C.pipLit : C.pipDim);
    ringEllipse(canvas, rx, py, 16, 16, i < p2.sets ? C.pipLitRim : C.metalEdgeD, 2);
  }

  // ---- card grids ----
  const leftGridX = MARGIN + PIP_COL_W;
  const rightGridX = MARGIN + PIP_COL_W + GRID_W + CENTER_W;
  await drawGrid(canvas, p1, leftGridX, gridTop, playing && state.turn === 'p1');
  await drawGrid(canvas, p2, rightGridX, gridTop, playing && state.turn === 'p2');

  // ---- hand rows ----
  const handTop = gridTop + GRID_H + 24;
  // Player Hand (p1, face up)
  drawHandLabel(canvas, leftGridX, handTop, 'PLAYER HAND');
  await drawHand(canvas, p1, leftGridX, handTop + HAND_LABEL_H, true);
  // Opponent Hand (p2, face down)
  drawHandLabel(canvas, rightGridX, handTop, 'OPPONENT HAND');
  await drawHand(canvas, p2, rightGridX, handTop + HAND_LABEL_H, false);

  // ---- button strip (decorative, mirrors KOTOR layout) ----
  const btnY = handTop + HAND_H + 10;
  const btnW = (GRID_W - 12) / 2;
  drawButton(canvas, rightGridX, btnY, btnW, 34, 'END TURN');
  drawButton(canvas, rightGridX + btnW + 12, btnY, btnW, 34, 'STAND');
  drawButton(canvas, rightGridX, btnY + 44, GRID_W, 34, 'FORFEIT GAME');

  return canvas.getBufferAsync(Jimp.MIME_PNG);
}

async function drawGrid(canvas, player, gx, gy, isTurn) {
  // panel behind the grid
  raisedPanel(canvas, gx - 10, gy - 10, GRID_W + 20, GRID_H + 20, 0x8f9399ff);
  if (isTurn) strokeRect(canvas, gx - 10, gy - 10, GRID_W + 20, GRID_H + 20, C.gold, 3);
  for (let i = 0; i < 9; i++) {
    const col = i % COLS, row = (i / COLS) | 0;
    const cx = gx + col * (CARD_W + GRID_GAP);
    const cy = gy + row * (CARD_H + GRID_GAP);
    recessedSlot(canvas, cx, cy, CARD_W, CARD_H, C.slotBlack);
    const placed = player.placed[i];
    if (placed) {
      try { canvas.composite(await getCard(placed.img), cx, cy); }
      catch (e) { fillRect(canvas, cx + 2, cy + 2, CARD_W - 4, CARD_H - 4, C.cardMiss); }
    }
  }
}

function drawHandLabel(canvas, x, y, text) {
  fillRect(canvas, x, y, GRID_W, 26, C.panelDark);
  strokeRect(canvas, x, y, GRID_W, 26, C.metalEdgeD, 1);
  centerText(canvas, font16, x + GRID_W / 2, y + 5, text);
}

async function drawHand(canvas, player, x, y, faceUp) {
  const HAND_SLOTS = 4;
  const hgap = 16;
  const hw = (GRID_W - (HAND_SLOTS - 1) * hgap) / HAND_SLOTS;
  const scale = hw / CARD_W;
  const hh = Math.round(CARD_H * scale);
  const cards = player.hand || [];
  for (let i = 0; i < HAND_SLOTS; i++) {
    const cx = x + i * (hw + hgap);
    recessedSlot(canvas, cx, y, Math.round(hw), hh, C.slotBlack);
    if (i < cards.length) {
      try {
        const src = faceUp ? cardImg(cards[i]) : 'D.png';
        const img = (await getCard(src)).clone().resize(Math.round(hw), hh);
        canvas.composite(img, cx, y);
      } catch (e) { fillRect(canvas, cx + 2, y + 2, Math.round(hw) - 4, hh - 4, C.cardMiss); }
    }
  }
}

function drawButton(canvas, x, y, w, h, text) {
  fillRect(canvas, x, y, w, h, 0x101216ff);
  strokeRect(canvas, x, y, w, h, C.metalEdgeD, 1);
  strokeRect(canvas, x, y, w, h, 0x2c2f34ff, 1);
  printGold(canvas, font16, x + Math.round((w - Jimp.measureText(font16, text)) / 2), y + 8, text);
}

// duplicate of engine.cardToImg to avoid a circular require
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

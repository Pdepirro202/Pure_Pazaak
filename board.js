'use strict';
// Board image compositor styled after the KOTOR Pazaak table:
// rounded brushed-metal frame, two 3x3 card grids, a notched center
// score banner, domed corner LEDs, red set pips on the sides,
// Player/Opponent hand rows, and the End Turn / Stand / Forfeit panels.
const Jimp = require('jimp');

const IMAGE_BASE_URL = process.env.IMAGE_BASE_URL || 'https://raw.githubusercontent.com/Pdepirro202/Pazaak/main';

// ---- geometry ----
const CARD_W = 92, CARD_H = 128;         // single card size
const GRID_GAP = 12;                     // gap between cards in a grid
const COLS = 3, ROWS = 3;                // 3x3 = 9 slots per player
const GRID_W = COLS * CARD_W + (COLS - 1) * GRID_GAP;
const GRID_H = ROWS * CARD_H + (ROWS - 1) * GRID_GAP;

const PIP_COL_W = 74;                    // side columns that hold the set pips
const CENTER_W = 210;                    // center gutter with score banner
const TOP_H = 96;                        // top bar (names + scores)
const HAND_LABEL_H = 34;
const HAND_H = CARD_H + HAND_LABEL_H + 20;
const BTN_H = 120;                       // bottom button strip
const MARGIN = 28;

const WIDTH = MARGIN * 2 + PIP_COL_W * 2 + GRID_W * 2 + CENTER_W;
const HEIGHT = MARGIN + TOP_H + GRID_H + 26 + HAND_H + BTN_H + MARGIN;

// ---- colors (0xRRGGBBAA) ----
const C = {
  metalEdgeH: 0xdadee3ff, // highlight edge
  metalEdgeD: 0x34373bff, // shadow edge
  panelFace:  0x969aa0ff,
  panelDark:  0x1c1f22ff,
  slotBlack:  0x0c0e10ff,
  banner:     0x050708ff,
  pipLit:     0xe23434ff,
  pipLitHi:   0xff8a8aff,
  pipDim:     0x431a1aff,
  pipDimHi:   0x6a2a2aff,
  gold:       0xf3c53fff,
  white:      0xffffffff,
  cardMiss:   0x2a2d31ff,
};

const cache = new Map();
let font16 = null, font32 = null, font16b = null;

async function loadFonts() {
  if (!font16)  font16  = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
  if (!font32)  font32  = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
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
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= img.bitmap.width || y >= img.bitmap.height) return;
  img.setPixelColor(color, x, y);
}
function fillRect(img, x, y, w, h, color) {
  x |= 0; y |= 0; w |= 0; h |= 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) setPx(img, x + i, y + j, color);
}
// alpha-blend a single pixel of `color` (0xRRGGBBAA) over what's already there
function blendPx(img, x, y, color) {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= img.bitmap.width || y >= img.bitmap.height) return;
  const a = (color & 0xff) / 255;
  if (a <= 0) return;
  if (a >= 1) { img.setPixelColor(color, x, y); return; }
  const idx = (img.bitmap.width * y + x) << 2;
  const d = img.bitmap.data;
  const sr = (color >>> 24) & 0xff, sg = (color >>> 16) & 0xff, sb = (color >>> 8) & 0xff;
  d[idx]     = Math.round(sr * a + d[idx] * (1 - a));
  d[idx + 1] = Math.round(sg * a + d[idx + 1] * (1 - a));
  d[idx + 2] = Math.round(sb * a + d[idx + 2] * (1 - a));
  d[idx + 3] = 255;
}
// alpha-blend a filled rect over the canvas
function blendRect(img, x, y, w, h, color) {
  x |= 0; y |= 0; w |= 0; h |= 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) blendPx(img, x + i, y + j, color);
}
// alpha-blend a filled rounded rect over the canvas
function blendRoundRect(img, x, y, w, h, r, color) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (inRound(i, j, w, h, r)) blendPx(img, x + i, y + j, color);
}
// is (x,y) inside a rounded rect of size w,h with corner radius r (local coords)
function inRound(i, j, w, h, r) {
  if (i < 0 || j < 0 || i >= w || j >= h) return false;
  const cx = (i < r) ? r : (i > w - 1 - r ? w - 1 - r : i);
  const cy = (j < r) ? r : (j > h - 1 - r ? h - 1 - r : j);
  const dx = i - cx, dy = j - cy;
  return dx * dx + dy * dy <= r * r;
}
function fillRoundRect(img, x, y, w, h, r, color) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (inRound(i, j, w, h, r)) setPx(img, x + i, y + j, color);
}
function strokeRoundRect(img, x, y, w, h, r, color, t) {
  t = t || 1;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (!inRound(i, j, w, h, r)) continue;
    if (!inRound(i, j, w, h, r) ) continue;
    // edge if a neighbor t-away is outside
    if (!inRound(i - t, j, w, h, r) || !inRound(i + t, j, w, h, r) ||
        !inRound(i, j - t, w, h, r) || !inRound(i, j + t, w, h, r)) {
      setPx(img, x + i, y + j, color);
    }
  }
}
// rounded raised panel: light on top/left, dark on bottom/right
function roundPanel(img, x, y, w, h, r, face) {
  fillRoundRect(img, x, y, w, h, r, face);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (!inRound(i, j, w, h, r)) continue;
    const topLeft = !inRound(i - 2, j, w, h, r) || !inRound(i, j - 2, w, h, r);
    const botRight = !inRound(i + 2, j, w, h, r) || !inRound(i, j + 2, w, h, r);
    if (topLeft && i < w / 2 && j < h / 2) setPx(img, x + i, y + j, C.metalEdgeH);
    else if (botRight && (i > w / 2 || j > h / 2)) setPx(img, x + i, y + j, C.metalEdgeD);
    else if (topLeft) setPx(img, x + i, y + j, C.metalEdgeH);
    else if (botRight) setPx(img, x + i, y + j, C.metalEdgeD);
  }
}
// rounded recessed slot: inverse bevel (dark top/left, light bottom/right)
function roundSlot(img, x, y, w, h, r, face) {
  fillRoundRect(img, x, y, w, h, r, face);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (!inRound(i, j, w, h, r)) continue;
    const topLeft = !inRound(i - 1, j, w, h, r) || !inRound(i, j - 1, w, h, r);
    const botRight = !inRound(i + 1, j, w, h, r) || !inRound(i, j + 1, w, h, r);
    if (topLeft) setPx(img, x + i, y + j, C.metalEdgeD);
    else if (botRight) setPx(img, x + i, y + j, C.metalEdgeH);
  }
}
function fillEllipse(img, cx, cy, rx, ry, color) {
  for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++)
    if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) setPx(img, cx + x, cy + y, color);
}
function ringEllipse(img, cx, cy, rx, ry, color, t) {
  t = t || 2;
  for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
    const v = (x * x) / (rx * rx) + (y * y) / (ry * ry);
    if (v <= 1 && v >= 1 - t * 0.06) setPx(img, cx + x, cy + y, color);
  }
}
// glossy dome LED: radial gradient from a bright top-left highlight to base color
function domeLED(img, cx, cy, r, base, hi) {
  const br = (base >>> 24) & 0xff, bg = (base >>> 16) & 0xff, bb = (base >>> 8) & 0xff;
  const hr = (hi >>> 24) & 0xff, hg = (hi >>> 16) & 0xff, hb = (hi >>> 8) & 0xff;
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    if (x * x + y * y > r * r) continue;
    // distance from a highlight point up-left of center
    const hx = x + r * 0.4, hy = y + r * 0.4;
    let t = 1 - Math.sqrt(hx * hx + hy * hy) / (r * 1.6);
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const R = Math.round(br + (hr - br) * t);
    const G = Math.round(bg + (hg - bg) * t);
    const B = Math.round(bb + (hb - bb) * t);
    setPx(img, cx + x, cy + y, ((R << 24) | (G << 16) | (B << 8) | 0xff) >>> 0);
  }
  ringEllipse(img, cx, cy, r, r, C.metalEdgeD, 2);
}
function rowHash(y) { let h = (y * 2246822519) >>> 0; h ^= h >>> 13; h = (h * 3266489917) >>> 0; return (h >>> 24) & 0xff; }
function pxHash(x, y) { let h = ((x * 374761393 + y * 668265263) >>> 0); h ^= h >>> 15; h = (h * 2246822519) >>> 0; return (h >>> 24) & 0xff; }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

function brushedMetal(w, h) {
  const img = new Jimp(w, h, 0x000000ff);
  img.scan(0, 0, w, h, function (x, y, idx) {
    const rowDelta = (rowHash(y) / 255) * 14 - 7;
    const sparkle = (pxHash(x, y) & 3) - 1;
    const vign = -Math.abs(y - h / 2) / h * 10;
    const val = clamp(Math.round(0x9c + rowDelta + sparkle + vign), 0x66, 0xcc);
    this.bitmap.data[idx] = val;
    this.bitmap.data[idx + 1] = val + 1;
    this.bitmap.data[idx + 2] = val + 6;
    this.bitmap.data[idx + 3] = 255;
  });
  return img;
}

function centerText(img, font, cx, y, text) {
  img.print(font, Math.round(cx - Jimp.measureText(font, text) / 2), y, text);
}
function printTint(img, font, x, y, text, r, g, b) {
  const w = Jimp.measureText(font, text) + 4;
  const h = Jimp.measureTextHeight(font, text, w) + 4;
  const tmp = new Jimp(w, h, 0x00000000);
  tmp.print(font, 0, 0, text);
  tmp.scan(0, 0, w, h, function (px, py, idx) {
    if (this.bitmap.data[idx + 3] > 20) {
      this.bitmap.data[idx] = r; this.bitmap.data[idx + 1] = g; this.bitmap.data[idx + 2] = b;
    }
  });
  img.composite(tmp, x, y);
}
function printGold(img, font, x, y, text) { printTint(img, font, x, y, text, 0xf3, 0xc5, 0x3f); }
function printCyan(img, font, x, y, text) { printTint(img, font, x, y, text, 0x6f, 0xe6, 0xf0); }

// ---- main render ----
async function renderBoard(state) {
  await loadFonts();
  const canvas = brushedMetal(WIDTH, HEIGHT);

  const p1 = state.players.p1;
  const p2 = state.players.p2;
  const playing = state.phase === 'playing';

  // outer rounded frame bevel
  roundPanel(canvas, 6, 6, WIDTH - 12, HEIGHT - 12, 34, 0xa2a6acff);
  const inner = brushedMetal(WIDTH - 44, HEIGHT - 44);
  // clip inner texture to a rounded rect
  const mask = new Jimp(WIDTH - 44, HEIGHT - 44, 0x00000000);
  fillRoundRect(mask, 0, 0, WIDTH - 44, HEIGHT - 44, 26, 0xffffffff);
  inner.mask(mask, 0, 0);
  canvas.composite(inner, 22, 22);

  const leftGridX = MARGIN + PIP_COL_W;
  const rightGridX = MARGIN + PIP_COL_W + GRID_W + CENTER_W;
  const nameBarY = MARGIN;

  // ---- name plates ----
  fillRoundRect(canvas, leftGridX, nameBarY, GRID_W, 36, 8, C.panelDark);
  fillRoundRect(canvas, rightGridX, nameBarY, GRID_W, 36, 8, C.panelDark);

  const p1name = p1.isComputer ? 'Computer' : (p1.name || 'Player');
  const p2name = p2.isComputer ? 'Computer' : (p2.name || 'Opponent');
  canvas.print(font16, leftGridX + 14, nameBarY + 8, p1name.toUpperCase());
  const p2w = Jimp.measureText(font16, p2name.toUpperCase());
  canvas.print(font16, rightGridX + GRID_W - 14 - p2w, nameBarY + 8, p2name.toUpperCase());

  // ---- big domed corner LEDs (like the screenshot's red/gray domes) ----
  domeLED(canvas, MARGIN + 26, nameBarY + 18, 22,
    (playing && state.turn === 'p1') ? C.pipLit : C.pipDim,
    (playing && state.turn === 'p1') ? C.pipLitHi : C.pipDimHi);
  domeLED(canvas, WIDTH - MARGIN - 26, nameBarY + 18, 22,
    (playing && state.turn === 'p2') ? C.pipLit : C.pipDim,
    (playing && state.turn === 'p2') ? C.pipLitHi : C.pipDimHi);

  // ---- notched center score banner ----
  const centerX = MARGIN + PIP_COL_W + GRID_W + CENTER_W / 2;
  const bannerW = CENTER_W - 20, bannerH = 52;
  const bannerX = centerX - bannerW / 2, bannerY = nameBarY - 2;
  fillRoundRect(canvas, bannerX, bannerY, bannerW, bannerH, 22, C.banner);
  strokeRoundRect(canvas, bannerX, bannerY, bannerW, bannerH, 22, C.metalEdgeH, 2);
  // two score wells inside the banner
  const bx1 = centerX - 44, bx2 = centerX + 44;
  fillEllipse(canvas, bx1, bannerY + bannerH / 2, 34, 20, 0x000000ff);
  fillEllipse(canvas, bx2, bannerY + bannerH / 2, 34, 20, 0x000000ff);
  centerText(canvas, font32, bx1, bannerY + bannerH / 2 - 17, String(p1.total));
  centerText(canvas, font32, bx2, bannerY + bannerH / 2 - 17, String(p2.total));

  // ---- set pips on side columns ----
  const gridTop = MARGIN + TOP_H;
  const pipGap = (GRID_H - 3 * 30) / 4;
  for (let i = 0; i < 3; i++) {
    const py = gridTop + pipGap + i * (30 + pipGap) + 15;
    const lx = MARGIN + PIP_COL_W / 2;
    domeLED(canvas, lx, py, 15, i < p1.sets ? C.pipLit : C.pipDim, i < p1.sets ? C.pipLitHi : C.pipDimHi);
    const rx = WIDTH - MARGIN - PIP_COL_W / 2;
    domeLED(canvas, rx, py, 15, i < p2.sets ? C.pipLit : C.pipDim, i < p2.sets ? C.pipLitHi : C.pipDimHi);
  }

  // ---- card grids ----
  await drawGrid(canvas, p1, leftGridX, gridTop, playing && state.turn === 'p1', false);
  await drawGrid(canvas, p2, rightGridX, gridTop, playing && state.turn === 'p2', false);

  // ---- hand rows ----
  const handTop = gridTop + GRID_H + 26;
  drawHandLabel(canvas, leftGridX, handTop, 'PLAYER HAND');
  await drawHand(canvas, p1, leftGridX, handTop + HAND_LABEL_H, true);
  drawHandLabel(canvas, rightGridX, handTop, 'OPPONENT HAND');
  await drawHand(canvas, p2, rightGridX, handTop + HAND_LABEL_H, false);

  // ---- decorative button strip ----
  const btnY = handTop + HAND_H + 10;
  const btnW = (GRID_W - 12) / 2;
  drawButton(canvas, rightGridX, btnY, btnW, 34, 'END TURN');
  drawButton(canvas, rightGridX + btnW + 12, btnY, btnW, 34, 'STAND');
  drawButton(canvas, rightGridX, btnY + 44, GRID_W, 34, 'FORFEIT GAME');

  // ---- win / lose result banner (KOTOR-style overlay) ----
  // In PvC the human is seat p1, so we use the requested "You" wording.
  // In PvP the board image is shared by both players, so we name the winner.
  const pvc = state.mode === 'pvc' || p2.isComputer;
  let banner = null, win = false, tie = false;
  if (state.phase === 'gameOver') {
    win = state.winner === 'p1';
    if (pvc) banner = win ? 'You have defeated your opponent.' : 'You have been defeated.';
    else banner = (state.winner === 'p1' ? p1name : p2name) + ' wins the match.';
  } else if (state.setBanner === 'tie') {
    tie = true; banner = 'The set is a draw.';
  } else if (state.setBanner) {
    win = state.setBanner === 'p1';
    if (pvc) banner = win ? 'You have won the set.' : 'Your opponent wins the set.';
    else banner = (state.setBanner === 'p1' ? p1name : p2name) + ' wins the set.';
  }
  if (banner) drawResultBanner(canvas, banner, win, tie);

  return canvas.getBufferAsync(Jimp.MIME_PNG);
}

// wrap a string to at most `maxW` px per line for the given font
function wrapLines(font, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (Jimp.measureText(font, test) > maxW && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

// Centered KOTOR-style result dialog: dark navy panel, thick gold rounded
// border, cyan message text, and a gold-bordered "OK" button.
function drawResultBanner(canvas, text, win, tie) {
  const boxW = Math.round(WIDTH * 0.52);
  const padX = 34, lineH = 34;
  const lines = wrapLines(font32, text, boxW - padX * 2);

  const btnW = 96, btnH = 40, btnGap = 22;
  const textBlockH = lines.length * lineH;
  const boxH = 28 + textBlockH + btnGap + btnH + 28;
  const x = Math.round((WIDTH - boxW) / 2);
  const y = Math.round((HEIGHT - boxH) / 2);

  // lightly dim the table behind the dialog so the board stays visible
  blendRect(canvas, 0, 0, WIDTH, HEIGHT, 0x00000033);

  // drop shadow
  blendRoundRect(canvas, x + 6, y + 8, boxW, boxH, 20, 0x00000066);
  // navy panel (translucent so the board shows through)
  blendRoundRect(canvas, x, y, boxW, boxH, 20, 0x0a1622cc);
  // thick gold border (double stroke)
  strokeRoundRect(canvas, x, y, boxW, boxH, 20, 0xf3c53fff, 3);
  strokeRoundRect(canvas, x + 4, y + 4, boxW - 8, boxH - 8, 16, 0x8a6d1eff, 1);

   // cyan message text, centered line by line
  let ty = y + 26;
  for (const ln of lines) {
    const tw = Jimp.measureText(font32, ln);
    printCyan(canvas, font32, Math.round(x + (boxW - tw) / 2), ty, ln);
    ty += lineH;
  }

  // gold-bordered OK button
  const bx = Math.round(x + (boxW - btnW) / 2);
  const by = y + boxH - 28 - btnH;
  fillRoundRect(canvas, bx, by, btnW, btnH, 10, 0x0a1622ff);
  strokeRoundRect(canvas, bx, by, btnW, btnH, 10, 0xf3c53fff, 2);
  const ow = Jimp.measureText(font16, 'OK');
  printGold(canvas, font16, Math.round(bx + (btnW - ow) / 2), by + 11, 'OK');
}

async function drawGrid(canvas, player, gx, gy, isTurn, grey) {
  roundPanel(canvas, gx - 12, gy - 12, GRID_W + 24, GRID_H + 24, 16, C.panelFace);
  if (isTurn) strokeRoundRect(canvas, gx - 12, gy - 12, GRID_W + 24, GRID_H + 24, 16, C.gold, 3);
  for (let i = 0; i < 9; i++) {
    const col = i % COLS, row = (i / COLS) | 0;
    const cx = gx + col * (CARD_W + GRID_GAP);
    const cy = gy + row * (CARD_H + GRID_GAP);
    roundSlot(canvas, cx, cy, CARD_W, CARD_H, 10, C.slotBlack);
    const placed = player.placed[i];
    if (placed) {
      if (grey) {
        // Opponent's played cards are hidden: draw a blank grey card, no face/text.
        greyCard(canvas, cx, cy, CARD_W, CARD_H, 10);
      } else {
        try { canvas.composite(await roundCard(placed.img, CARD_W, CARD_H), cx, cy); }
        catch (e) { fillRoundRect(canvas, cx + 3, cy + 3, CARD_W - 6, CARD_H - 6, 8, C.cardMiss); }
      }
    }
  }
}

// A featureless grey card face (rounded, subtly beveled) — used to hide opponent cards.
function greyCard(img, x, y, w, h, r) {
  fillRoundRect(img, x, y, w, h, r, 0x8a9098ff);
  // soft inner panel so it reads as a card, not a flat block
  fillRoundRect(img, x + 6, y + 6, w - 12, h - 12, r - 3, 0x767c84ff);
  // top-left highlight / bottom-right shadow bevel
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (!inRound(i, j, w, h, r)) continue;
    const topLeft = !inRound(i - 2, j, w, h, r) || !inRound(i, j - 2, w, h, r);
    const botRight = !inRound(i + 2, j, w, h, r) || !inRound(i, j + 2, w, h, r);
    if (topLeft) setPx(img, x + i, y + j, 0xb9bfc6ff);
    else if (botRight) setPx(img, x + i, y + j, 0x4c5158ff);
  }
}

// fetch a card and clip it to rounded corners so it seats in the rounded slot
async function roundCard(filename, w, h) {
  const src = (await getCard(filename)).clone().resize(w, h);
  const mask = new Jimp(w, h, 0x00000000);
  fillRoundRect(mask, 0, 0, w, h, 10, 0xffffffff);
  src.mask(mask, 0, 0);
  return src;
}

function drawHandLabel(canvas, x, y, text) {
  fillRoundRect(canvas, x, y, GRID_W, 26, 8, C.panelDark);
  centerText(canvas, font16, x + GRID_W / 2, y + 5, text);
}

async function drawHand(canvas, player, x, y, faceUp) {
  const HAND_SLOTS = 4;
  const hgap = 16;
  const hw = Math.round((GRID_W - (HAND_SLOTS - 1) * hgap) / HAND_SLOTS);
  const hh = Math.round(CARD_H * (hw / CARD_W));
  const cards = player.hand || [];
  for (let i = 0; i < HAND_SLOTS; i++) {
    const cx = x + i * (hw + hgap);
    roundSlot(canvas, cx, y, hw, hh, 8, C.slotBlack);
    if (i < cards.length) {
      if (!faceUp) {
        // Opponent's side deck is concealed: blank grey card, no face/text.
        greyCard(canvas, cx, y, hw, hh, 8);
      } else {
        try {
          canvas.composite(await roundCard(cardImg(cards[i]), hw, hh), cx, y);
        } catch (e) { fillRoundRect(canvas, cx + 3, y + 3, hw - 6, hh - 6, 6, C.cardMiss); }
      }
    }
  }
}

function drawButton(canvas, x, y, w, h, text) {
  fillRoundRect(canvas, x, y, w, h, 8, 0x0d0f12ff);
  strokeRoundRect(canvas, x, y, w, h, 8, 0x2c2f34ff, 1);
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

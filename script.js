// ============================================================
// SHADE LINE — Perception Game
// ============================================================

// ── DOM refs ──────────────────────────────────────────────────
const startScreen  = document.getElementById("start-screen");
const endScreen    = document.getElementById("end-screen");
const gameUI       = document.getElementById("game-ui");
const canvas       = document.getElementById("game-canvas");
const ctx          = canvas.getContext("2d");
const roundDisplay = document.getElementById("round-display");
const scoreDisplay = document.getElementById("score-display");
const feedbackText = document.getElementById("feedback-text");
const feedbackBar  = document.getElementById("feedback-bar");
const finalScore   = document.getElementById("final-score");
const finalGrade   = document.getElementById("final-grade");
const finalDetail  = document.getElementById("final-detail");

document.getElementById("start-btn").addEventListener("click", startGame);
document.getElementById("restart-btn").addEventListener("click", startGame);

// ── Constants ─────────────────────────────────────────────────
const TOTAL_ROUNDS    = 20;
const REVEAL_DURATION = 1100; // ms to show the reveal before advancing

// Lightness delta between the two shade regions.
// Larger = more obvious; smaller = harder.
const MAX_DELTA = 6;    // starting shade diff is already tight
const MIN_DELTA = 0.4;  // at peak difficulty: essentially imperceptible

// Tolerance: max horizontal px distance from the line that counts as a hit.
const BASE_TOLERANCE = 36;
const MIN_TOLERANCE  = 12;

// Width of the soft gradient blend at the boundary (CSS px).
// Just wide enough to remove the hard aliased edge — not a visible cue.
const BLEND_WIDTH = 3;

// ── Game state ────────────────────────────────────────────────
let round        = 0;
let difficulty   = 0.70;   // 0 = easiest, 1 = hardest — start already hard
let totalPoints  = 0;      // weighted score accumulator
let correctCount = 0;
let wrongCount   = 0;
let waiting      = false;
let currentRound = null;

// ── Adaptive difficulty ───────────────────────────────────────
// Uses both a streak counter (fast response) and a rolling average (smoothing).
let streak = 0;  // positive = consecutive hits, negative = consecutive misses
const PERF_WINDOW = 5;
const perfHistory = [];

function updateDifficulty(wasHit) {
  // Every correct answer pushes difficulty up immediately.
  // A miss pulls it back a little — but less than a hit raises it,
  // so sustained performance keeps the pressure on.
  if (wasHit) {
    difficulty = Math.min(1, difficulty + 0.03);
  } else {
    difficulty = Math.max(0, difficulty - 0.05);
  }

  // Streak bonus: 4 correct in a row → gentle extra nudge
  streak = wasHit ? Math.max(0, streak) + 1 : Math.min(0, streak) - 1;
  if (streak >= 4) {
    difficulty = Math.min(1, difficulty + 0.03);
    streak = 0;
  } else if (streak <= -3) {
    difficulty = Math.max(0, difficulty - 0.08);
    streak = 0;
  }
}

function shadeDelta() {
  return MAX_DELTA - difficulty * (MAX_DELTA - MIN_DELTA);
}

function tolerance() {
  return BASE_TOLERANCE - difficulty * (BASE_TOLERANCE - MIN_TOLERANCE);
}

// ── Game flow ─────────────────────────────────────────────────
function startGame() {
  round        = 0;
  difficulty   = 0.70;
  totalPoints  = 0;
  correctCount = 0;
  wrongCount   = 0;
  waiting      = false;
  currentRound = null;
  streak       = 0;
  perfHistory.length = 0;

  startScreen.classList.add("hidden");
  endScreen.classList.add("hidden");
  gameUI.classList.remove("hidden");

  resizeCanvas();
  nextRound();
}

function nextRound() {
  round++;
  waiting = false;
  updateHUD();
  clearFeedback();
  currentRound = generateRound();
  drawRound(currentRound);
}

function endGame() {
  gameUI.classList.add("hidden");
  endScreen.classList.remove("hidden");

  // Score is percentage of max possible (each round max = 1.0 at hardest, 0.5 at easiest)
  const pct = Math.round((totalPoints / TOTAL_ROUNDS) * 100);
  finalScore.textContent  = pct;
  finalGrade.textContent  = gradeMessage(pct);
  finalDetail.textContent = `${correctCount} correct · ${wrongCount} missed`;
}

function gradeMessage(pct) {
  if (pct >= 85) return "Exceptional — almost inhuman.";
  if (pct >= 65) return "Sharp eyes. Well done.";
  if (pct >= 45) return "Solid. Respectable perception.";
  if (pct >= 25) return "Room to improve.";
  return "The shades were cruel. Try again.";
}

// ── Round generation ──────────────────────────────────────────
function generateRound() {
  const W = cssW();
  const H = cssH();

  const hue        = Math.random() * 360;
  const saturation = 40 + Math.random() * 35;  // 40–75%
  const lightBase  = 35 + Math.random() * 28;  // 35–63%
  const delta      = shadeDelta();

  // Randomly decide which side is lighter
  const flip   = Math.random() < 0.5;
  const lightL = lightBase + (flip ? 0 : delta);
  const lightR = lightBase + (flip ? delta : 0);

  const colorL = `hsl(${hue.toFixed(1)},${saturation.toFixed(1)}%,${lightL.toFixed(1)}%)`;
  const colorR = `hsl(${hue.toFixed(1)},${saturation.toFixed(1)}%,${lightR.toFixed(1)}%)`;

  // lineX: horizontal position of the dividing boundary (20%–80% of width)
  const margin = 0.20;
  const lineX  = (margin + Math.random() * (1 - 2 * margin)) * W;

  return { W, H, colorL, colorR, lineX };
}

// ── Drawing ───────────────────────────────────────────────────

// Draw the two shaded regions with a soft gradient blend at the boundary.
// No hard edge — the two shades simply meet each other.
function drawRound(r) {
  const { W, H, colorL, colorR, lineX } = r;

  const grad = ctx.createLinearGradient(0, 0, W, 0);
  const t0 = Math.max(0, (lineX - BLEND_WIDTH) / W);
  const t1 = Math.min(1, (lineX + BLEND_WIDTH) / W);
  grad.addColorStop(0,  colorL);
  grad.addColorStop(t0, colorL);
  grad.addColorStop(t1, colorR);
  grad.addColorStop(1,  colorR);

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

// Draw the reveal overlay (called after the player clicks).
// Result color (green/red) stays OFF the canvas — it lives in the border glow
// and the feedback bar. The canvas only shows neutral white markers so they
// read clearly regardless of the shade hue underneath.
function drawReveal(r, clickX, isHit) {
  const { W, H, lineX } = r;
  const tol  = tolerance();
  const dist = Math.abs(clickX - lineX);

  // 1 — Tolerance band: very faint white strip showing the accepted zone
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.fillRect(lineX - tol, 0, tol * 2, H);

  // 2 — Player's click line (wrong only — dashed white)
  if (!isHit) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.38)";
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(clickX, 0);
    ctx.lineTo(clickX, H);
    ctx.stroke();
    ctx.restore();
  }

  // 3 — True line: solid white, thin, subtle glow — neutral, no green/red here
  ctx.save();
  ctx.shadowColor = "rgba(255,255,255,0.45)";
  ctx.shadowBlur  = 8;
  ctx.strokeStyle = "rgba(255,255,255,0.88)";
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(lineX, 0);
  ctx.lineTo(lineX, H);
  ctx.stroke();
  ctx.restore();

  // 4 — Badges: small pill labels, dark bg so they float over any shade color
  if (isHit) {
    const label = dist <= tol * 0.3 ? "✓  Perfect" : "✓  Correct";
    drawCenteredBadge(W / 2, H * 0.08, label, "#4ade80", "rgba(0,0,0,0.70)");
  } else {
    drawCenteredBadge(W / 2, H * 0.08, "✕  Missed", "#f87171", "rgba(0,0,0,0.70)");
    drawLineBadge(lineX, H * 0.46, "← Line was here", "rgba(255,255,255,0.88)", "rgba(0,0,0,0.65)", W);
    const midX = (lineX + clickX) / 2;
    drawLineBadge(midX, H * 0.63, `${Math.round(dist)} px off`, "#e0c070", "rgba(0,0,0,0.65)", W);
  }

  // 5 — Add colored glow to the canvas border (via CSS class on the wrapper)
  document.getElementById("canvas-wrapper").classList.add(isHit ? "reveal-hit" : "reveal-miss");
}

// Centered badge (for the top-of-canvas result label)
function drawCenteredBadge(cx, y, text, textColor, bgColor) {
  ctx.save();
  ctx.font         = "700 13px system-ui, -apple-system, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign    = "center";
  const pad = 12;
  const tw  = ctx.measureText(text).width;
  const bw  = tw + pad * 2;
  const bh  = 28;
  ctx.fillStyle = bgColor;
  roundRect(cx - bw / 2, y - bh / 2, bw, bh, 7);
  ctx.fill();
  ctx.fillStyle = textColor;
  ctx.fillText(text, cx, y);
  ctx.restore();
}

// Draw a small pill label anchored to an x position, flipped if too close to an edge.
function drawLineBadge(anchorX, y, text, textColor, bgColor, canvasW) {
  ctx.save();
  ctx.font         = "600 13px system-ui, -apple-system, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign    = "left";

  const pad = 9;
  const tw  = ctx.measureText(text).width;
  const bw  = tw + pad * 2;
  const bh  = 26;

  // Place label to the right of the anchor; flip left if it would overflow
  const rightX = anchorX + 10;
  const leftX  = anchorX - bw - 10;
  const bx     = (rightX + bw < canvasW - 8) ? rightX : leftX;
  const by     = y - bh / 2;

  // Background pill
  ctx.fillStyle = bgColor;
  roundRect(bx, by, bw, bh, 6);
  ctx.fill();

  // Text
  ctx.fillStyle = textColor;
  ctx.fillText(text, bx + pad, y);
  ctx.restore();
}

// Cross-browser rounded rect path helper (avoids ctx.roundRect which is newer).
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

// ── Input handling ────────────────────────────────────────────
canvas.addEventListener("click", onCanvasClick);
canvas.addEventListener("touchend", (e) => {
  e.preventDefault();
  const t    = e.changedTouches[0];
  const rect = canvas.getBoundingClientRect();
  // Convert touch position to CSS-pixel canvas space
  const cx = (t.clientX - rect.left) * (cssW() / rect.width);
  handleGuess(cx);
}, { passive: false });

function onCanvasClick(e) {
  const rect = canvas.getBoundingClientRect();
  const cx   = (e.clientX - rect.left) * (cssW() / rect.width);
  handleGuess(cx);
}

function handleGuess(cx) {
  if (waiting || !currentRound) return;
  waiting = true;

  const { lineX } = currentRound;
  const tol   = tolerance();
  const dist  = Math.abs(cx - lineX);
  const isHit = dist <= tol;
  const pts   = calcPoints(dist, tol);

  totalPoints  += pts;
  if (isHit) correctCount++; else wrongCount++;

  updateDifficulty(isHit);
  showFeedback(dist, tol, isHit);
  updateHUD();

  drawRound(currentRound);
  drawReveal(currentRound, cx, isHit);

  setTimeout(() => {
    if (round >= TOTAL_ROUNDS) endGame();
    else nextRound();
  }, REVEAL_DURATION);
}

// ── Scoring ───────────────────────────────────────────────────
// Each round yields 0–1 point.
// Weight = 0.5 at min difficulty, 1.0 at max difficulty.
// Proximity factor = smooth curve from 1 (exact) to 0 (at tolerance boundary).
function calcPoints(dist, tol) {
  const norm = dist / tol;
  if (norm > 1) return 0;
  const proximity   = Math.pow(1 - norm, 1.4);
  const diffWeight  = 0.5 + difficulty * 0.5;
  return proximity * diffWeight;
}

// ── HUD & Feedback ────────────────────────────────────────────
function updateHUD() {
  roundDisplay.textContent = `Round ${Math.min(round, TOTAL_ROUNDS)} / ${TOTAL_ROUNDS}`;
  // Show score as percentage of max possible so far
  const maxSoFar = (round - (waiting ? 0 : 0)); // keeps updating
  scoreDisplay.textContent = `Score: ${Math.round((totalPoints / TOTAL_ROUNDS) * 100)}`;
}

function clearFeedback() {
  feedbackText.textContent = "\u00a0";
  feedbackText.className   = "";
  feedbackBar.className    = "";
  const wrapper = document.getElementById("canvas-wrapper");
  wrapper.classList.remove("reveal-hit", "reveal-miss");
}

function showFeedback(dist, tol, isHit) {
  let msg, cls;

  if (!isHit) {
    msg = `Missed  —  ${Math.round(dist)} px off`;
    cls = "miss";
  } else if (dist <= tol * 0.25) {
    msg = "Perfect!";
    cls = "good";
  } else if (dist <= tol * 0.6) {
    msg = "Got it!";
    cls = "ok";
  } else {
    msg = "Close enough!";
    cls = "ok";
  }

  feedbackText.textContent = msg;
  feedbackText.className   = cls;
  feedbackBar.className    = cls; // tints the bar background too
}

// ── Canvas helpers ────────────────────────────────────────────
// Return canvas dimensions in CSS (logical) pixels.
function cssW() {
  return canvas.width / (window.devicePixelRatio || 1);
}
function cssH() {
  return canvas.height / (window.devicePixelRatio || 1);
}

// ── Canvas sizing ─────────────────────────────────────────────
function resizeCanvas() {
  const wrapper = document.getElementById("canvas-wrapper");
  const rect    = wrapper.getBoundingClientRect();
  const dpr     = window.devicePixelRatio || 1;

  canvas.width  = Math.round(rect.width  * dpr);
  canvas.height = Math.round(rect.height * dpr);
  canvas.style.width  = rect.width  + "px";
  canvas.style.height = rect.height + "px";

  ctx.scale(dpr, dpr);
}

window.addEventListener("resize", () => {
  if (gameUI.classList.contains("hidden")) return;
  resizeCanvas();
  if (currentRound) {
    currentRound.W = cssW();
    currentRound.H = cssH();
    drawRound(currentRound);
  }
});

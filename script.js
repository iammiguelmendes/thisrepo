// ============================================================
// SHADE LINE — Game Logic  (game.html only)
// ============================================================

// ── DOM refs ──────────────────────────────────────────────────
const startOverlay     = document.getElementById("start-overlay");
const startBtn         = document.getElementById("start-btn");
const startBestBanner  = document.getElementById("start-best-banner");
const startBestValue   = document.getElementById("start-best-value");
const startSub         = document.querySelector(".start-sub");
const challengeMessage = document.getElementById("challenge-message");
const endOverlay       = document.getElementById("end-overlay");
const newRecordBadge   = document.getElementById("new-record-badge");
const bestScoreEnd     = document.getElementById("best-score-end");
const endBestValue     = document.getElementById("end-best-value");
const endScoreValue    = document.getElementById("end-score-value");
const endGradeMessage  = document.getElementById("end-grade-message");
const endCorrectValue  = document.getElementById("end-correct-value");
const endMissedValue   = document.getElementById("end-missed-value");
const endRoundsValue   = document.getElementById("end-rounds-value");
const endDeValue       = document.getElementById("end-de-value");
const scoreCardCanvas  = document.getElementById("score-card-canvas");
const shareChallengeBtn = document.getElementById("share-challenge-btn");
const copyCardBtn      = document.getElementById("copy-card-btn");
const downloadCardBtn  = document.getElementById("download-card-btn");
const gameUI           = document.getElementById("game-ui");
const canvas           = document.getElementById("game-canvas");
const ctx              = canvas.getContext("2d");
const roundDisplay     = document.getElementById("round-display");
const scoreDisplay     = document.getElementById("score-display");
const deltaDisplay     = document.getElementById("delta-display");
const feedbackText     = document.getElementById("feedback-text");
const feedbackBar      = document.getElementById("feedback-bar");

// ── Constants ─────────────────────────────────────────────────
const TOTAL_ROUNDS    = 30;
const REVEAL_DURATION = 1100; // ms to show the reveal before advancing

// Lightness delta between the two shade regions.
const MAX_DELTA = 6.4;  // opening rounds are slightly more forgiving
const MIN_DELTA = 0.4;  // at peak difficulty: essentially imperceptible

// Tolerance: max horizontal px distance from the line that counts as a hit.
const HIT_TOLERANCE = 15;

// Soft gradient blend width at boundary (px) — just enough to kill the hard edge.
const BLEND_WIDTH = 3;

// ── Game state ────────────────────────────────────────────────
let round        = 0;
let difficulty   = 0.48;
let correctCount = 0;
let wrongCount   = 0;
let bestDe       = Infinity; // smallest ΔE the player correctly identified (their JND)
let waiting      = false;
let currentRound = null;
let lastHue      = 220; // tracked for the score card background tint

// ── Adaptive difficulty ───────────────────────────────────────
let streak = 0;

function updateDifficulty(wasHit) {
  // Every correct answer pushes difficulty up; a miss pulls it back.
  difficulty = wasHit
    ? Math.min(1, difficulty + 0.022)
    : Math.max(0, difficulty - 0.04);

  // Streak bonus: 4 correct in a row → extra nudge up
  streak = wasHit ? Math.max(0, streak) + 1 : Math.min(0, streak) - 1;
  if (streak >= 4) {
    difficulty = Math.min(1, difficulty + 0.018);
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
  return HIT_TOLERANCE;
}

// ── localStorage helpers ──────────────────────────────────────
function getBestScore() {
  return parseFloat(localStorage.getItem("sl_best") || "0");
}

function saveBestScore(score) {
  if (score > getBestScore()) {
    localStorage.setItem("sl_best", String(score));
    return true;
  }
  return false;
}

function getPlayCount() {
  return parseInt(localStorage.getItem("sl_plays") || "0");
}

function incrementPlayCount() {
  localStorage.setItem("sl_plays", String(getPlayCount() + 1));
}

function getChallengeScore() {
  const raw = new URLSearchParams(window.location.search).get("challenge");
  if (raw === null) return null;
  if (!/^\d{1,3}$/.test(raw)) return "invalid";

  const score = Number(raw);
  if (!Number.isInteger(score) || score < 0 || score > 100) return "invalid";

  return score;
}

function goTo404() {
  const target = new URL("/404.html", window.location.origin);
  window.location.replace(target.toString());
}

function shouldAutoStart() {
  const params = new URLSearchParams(window.location.search);
  return params.get("autostart") === "1" && getChallengeScore() === null;
}

// ── Start overlay best-score display ─────────────────────────
function updateStartBest() {
  const best = getBestScore();
  if (best > 0 && startBestBanner) {
    startBestValue.textContent = Math.round(best) + "%";
    startBestBanner.classList.remove("hidden");
  }
}

function configureChallengePrompt() {
  const challengeScore = getChallengeScore();
  if (challengeScore === null) return;
  if (challengeScore === "invalid") {
    goTo404();
    return;
  }

  startSub.textContent = "A friend challenged you.";
  challengeMessage.textContent = `Their accuracy was ${challengeScore}%. Can you do better?`;
  challengeMessage.classList.remove("hidden");
  startBestBanner.classList.add("hidden");
  startBtn.textContent = "Start Challenge";
}

function buildChallengeURL(score) {
  const safeScore = Math.max(0, Math.min(100, Math.round(score)));
  if (window.location.protocol === "file:") {
    return new URL(`./play/index.html?challenge=${safeScore}`, window.location.href).toString();
  }
  return new URL(`/play?challenge=${safeScore}`, window.location.origin).toString();
}

async function shareChallenge() {
  const score = Math.round((correctCount / TOTAL_ROUNDS) * 100);
  const url   = buildChallengeURL(score);
  const text  = `My accuracy was ${score}%. Can you do better?`;

  try {
    if (navigator.share) {
      await navigator.share({ title: "Shade Line Challenge", text, url });
      flashBtn(shareChallengeBtn, "Shared ✓");
      return;
    }
  } catch {
    // Fall through to clipboard/manual fallback.
  }

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
      flashBtn(shareChallengeBtn, "Link copied ✓");
      return;
    }
  } catch {
    // Fall through to manual fallback.
  }

  window.prompt("Copy this challenge link:", url);
  flashBtn(shareChallengeBtn, "Link ready");
}

// ── Game flow ─────────────────────────────────────────────────
function startGame() {
  round        = 0;
  // Repeat plays still start a bit harder, but ramp more gently.
  difficulty   = Math.min(0.68, 0.48 + getPlayCount() * 0.01);
  correctCount = 0;
  wrongCount   = 0;
  bestDe       = Infinity;
  waiting      = false;
  currentRound = null;
  streak       = 0;

  startOverlay.classList.add("hidden");
  endOverlay.classList.add("hidden");
  gameUI.classList.remove("hidden");

  incrementPlayCount();
  resizeCanvas();
  nextRound();
}

function nextRound() {
  round++;
  waiting = false;
  clearFeedback();
  currentRound = generateRound();
  updateHUD();
  drawRound(currentRound);
}

function endGame() {
  gameUI.classList.add("hidden");

  const acc       = Math.round((correctCount / TOTAL_ROUNDS) * 100);
  const isNewBest = saveBestScore(acc);

  endScoreValue.textContent   = String(acc);
  endGradeMessage.textContent = gradeMessage(acc);
  endCorrectValue.textContent = String(correctCount);
  endMissedValue.textContent  = String(wrongCount);
  endRoundsValue.textContent  = String(TOTAL_ROUNDS);
  endDeValue.textContent      = bestDe === Infinity ? "—" : bestDe.toFixed(4);

  renderScoreCardPreview(acc);

  if (isNewBest) {
    newRecordBadge.classList.remove("hidden");
    bestScoreEnd.classList.add("hidden");
  } else {
    newRecordBadge.classList.add("hidden");
    bestScoreEnd.classList.remove("hidden");
    endBestValue.textContent = Math.round(getBestScore()) + "%";
  }

  endOverlay.classList.remove("hidden");
}

// ── Score card ────────────────────────────────────────────────
// Builds an off-screen canvas with the shareable score graphic.
function buildScoreCard(acc) {
  const W = 800, H = 420;
  const c = document.createElement("canvas");
  c.width  = W;
  c.height = H;
  const cx = c.getContext("2d");

  // Background — subtle tint from the last round's hue
  const bg = cx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, `hsl(${lastHue}, 18%, 8%)`);
  bg.addColorStop(1, `hsl(${lastHue}, 12%, 5%)`);
  cx.fillStyle = bg;
  cx.fillRect(0, 0, W, H);

  // Outer border
  cx.strokeStyle = "rgba(255,255,255,0.07)";
  cx.lineWidth = 1;
  cx.strokeRect(0.5, 0.5, W - 1, H - 1);

  // Logo / label
  cx.font = "700 11px system-ui, -apple-system, sans-serif";
  cx.fillStyle = "rgba(255,255,255,0.28)";
  cx.textAlign = "center";
  cx.textBaseline = "top";
  cx.fillText("SHADE LINE", W / 2, 32);

  // Accuracy number
  cx.font = "800 120px system-ui, -apple-system, sans-serif";
  cx.fillStyle = "#ffffff";
  cx.textBaseline = "middle";
  cx.fillText(String(acc) + "%", W / 2, H / 2 - 18);

  // Difference (JND)
  cx.font = "400 18px system-ui, -apple-system, sans-serif";
  cx.fillStyle = "rgba(255,255,255,0.28)";
  const deCardLabel = bestDe === Infinity ? "—" : "Difference " + bestDe.toFixed(4);
  cx.fillText(deCardLabel, W / 2, H / 2 + 64);

  // Grade
  cx.font = "400 17px system-ui, -apple-system, sans-serif";
  cx.fillStyle = "rgba(255,255,255,0.55)";
  cx.fillText(gradeMessage(acc), W / 2, H / 2 + 96);

  // Round stats
  cx.font = "400 13px system-ui, -apple-system, sans-serif";
  cx.fillStyle = "rgba(255,255,255,0.22)";
  cx.fillText(correctCount + " correct · " + wrongCount + " missed · " + TOTAL_ROUNDS + " rounds", W / 2, H - 44);

  // URL hint
  cx.font = "400 11px system-ui, -apple-system, sans-serif";
  cx.fillStyle = "rgba(255,255,255,0.14)";
  cx.fillText(window.location.hostname || "shade-line", W / 2, H - 22);

  return c;
}

// Draws the score card into the visible preview canvas in the end overlay.
function renderScoreCardPreview(acc) {
  const card = buildScoreCard(acc);
  // Match the preview canvas resolution to the card
  scoreCardCanvas.width  = card.width;
  scoreCardCanvas.height = card.height;
  scoreCardCanvas.getContext("2d").drawImage(card, 0, 0);
}

// Copy score card PNG to clipboard.
async function copyScoreCard() {
  const card = buildScoreCard(Math.round((correctCount / TOTAL_ROUNDS) * 100));
  card.toBlob(async (blob) => {
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      flashBtn(copyCardBtn, "Copied ✓");
    } catch {
      // Clipboard API unavailable — fall back to download
      triggerDownload(card);
      flashBtn(copyCardBtn, "Saved instead");
    }
  }, "image/png");
}

// Download score card as PNG.
function downloadScoreCard() {
  triggerDownload(
    buildScoreCard(Math.round((correctCount / TOTAL_ROUNDS) * 100))
  );
}

function triggerDownload(cardCanvas) {
  const score = Math.round((correctCount / TOTAL_ROUNDS) * 100);
  const a = document.createElement("a");
  a.download = `shade-line-${score}.png`;
  a.href = cardCanvas.toDataURL("image/png");
  a.click();
}

function flashBtn(btn, msg) {
  if (!btn) return;
  const orig = btn.textContent;
  btn.textContent = msg;
  btn.disabled = true;
  setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2200);
}

// Hide copy button if Clipboard API with images is not supported.
if (!window.ClipboardItem || !navigator.clipboard) {
  copyCardBtn.style.display = "none";
}

// ── Perceptual color difference (ΔE, Oklab) ───────────────────
// Converts HSL (h: 0–360, s/l: 0–100) → sRGB (0–1)
function hslToRGB(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

// sRGB (0–1) → Oklab {L, a, b}
function srgbToOklab(r, g, b) {
  const lin = (c) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const rl = lin(r), gl = lin(g), bl = lin(b);
  const l = 0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl;
  const m = 0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl;
  const s = 0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
  };
}

function calcDeltaE(h, sat, lL, lR) {
  const lab1 = srgbToOklab(...hslToRGB(h, sat, lL));
  const lab2 = srgbToOklab(...hslToRGB(h, sat, lR));
  const dL = lab1.L - lab2.L, da = lab1.a - lab2.a, db = lab1.b - lab2.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

// ── Round generation ──────────────────────────────────────────
function generateRound() {
  const W = cssW();
  const H = cssH();

  const hue        = Math.random() * 360;
  const saturation = 40 + Math.random() * 35;  // 40–75%
  const lightBase  = 35 + Math.random() * 28;  // 35–63%
  const delta      = shadeDelta();

  lastHue = hue; // track for score card background

  const flip   = Math.random() < 0.5;
  const lightL = lightBase + (flip ? 0 : delta);
  const lightR = lightBase + (flip ? delta : 0);

  const colorL = `hsl(${hue.toFixed(1)},${saturation.toFixed(1)}%,${lightL.toFixed(1)}%)`;
  const colorR = `hsl(${hue.toFixed(1)},${saturation.toFixed(1)}%,${lightR.toFixed(1)}%)`;

  const margin = 0.20;
  const lineX  = (margin + Math.random() * (1 - 2 * margin)) * W;
  const de     = calcDeltaE(hue, saturation, lightL, lightR);

  return { W, H, colorL, colorR, lineX, de };
}

// ── Drawing ───────────────────────────────────────────────────

// Draw the two shaded regions. The boundary is a soft gradient — no hard edge.
function drawRound(r) {
  const { W, H, colorL, colorR, lineX } = r;

  const grad = ctx.createLinearGradient(0, 0, W, 0);
  const t0   = Math.max(0, (lineX - BLEND_WIDTH) / W);
  const t1   = Math.min(1, (lineX + BLEND_WIDTH) / W);
  grad.addColorStop(0,  colorL);
  grad.addColorStop(t0, colorL);
  grad.addColorStop(t1, colorR);
  grad.addColorStop(1,  colorR);

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

// Draw the reveal overlay after the player clicks.
// Result colour lives in the border glow + feedback bar — NOT as a canvas fill tint.
function drawReveal(r, clickX, isHit) {
  const { W, H, lineX } = r;
  const tol  = tolerance();
  const dist = Math.abs(clickX - lineX);

  // Tolerance zone — very faint white band
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.fillRect(lineX - tol, 0, tol * 2, H);

  // Player's click line (miss only)
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

  // True line — neutral white, works on any hue background
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

  // Badges
  if (isHit) {
    const label = dist <= tol * 0.3 ? "✓  Perfect" : "✓  Correct";
    drawCenteredBadge(W / 2, H * 0.08, label, "#4ade80", "rgba(0,0,0,0.70)");
  } else {
    drawCenteredBadge(W / 2, H * 0.08, "✕  Missed", "#f87171", "rgba(0,0,0,0.70)");
    drawLineBadge(lineX, H * 0.46, "← Line was here", "rgba(255,255,255,0.88)", "rgba(0,0,0,0.65)", W);
    const midX = (lineX + clickX) / 2;
    drawLineBadge(midX, H * 0.63, `${Math.round(dist)} px off`, "#e0c070", "rgba(0,0,0,0.65)", W);
  }

  // Border glow via CSS class
  document.getElementById("canvas-wrapper").classList.add(isHit ? "reveal-hit" : "reveal-miss");
}

function drawCenteredBadge(cx, y, text, textColor, bgColor) {
  ctx.save();
  ctx.font         = "700 13px system-ui, -apple-system, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign    = "center";
  const pad = 12;
  const tw  = ctx.measureText(text).width;
  ctx.fillStyle = bgColor;
  rrect(cx - (tw + pad * 2) / 2, y - 14, tw + pad * 2, 28, 7);
  ctx.fill();
  ctx.fillStyle = textColor;
  ctx.fillText(text, cx, y);
  ctx.restore();
}

function drawLineBadge(anchorX, y, text, textColor, bgColor, canvasW) {
  ctx.save();
  ctx.font         = "600 13px system-ui, -apple-system, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign    = "left";
  const pad = 9;
  const tw  = ctx.measureText(text).width;
  const bw  = tw + pad * 2;
  const bh  = 26;
  const bx  = (anchorX + 10 + bw < canvasW - 8) ? anchorX + 10 : anchorX - bw - 10;
  ctx.fillStyle = bgColor;
  rrect(bx, y - bh / 2, bw, bh, 6);
  ctx.fill();
  ctx.fillStyle = textColor;
  ctx.fillText(text, bx + pad, y);
  ctx.restore();
}

// Cross-browser rounded rect path (avoids ctx.roundRect which is newer).
function rrect(x, y, w, h, r) {
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
  const cx   = (t.clientX - rect.left) * (cssW() / rect.width);
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
  const tol    = tolerance();
  const dist   = Math.abs(cx - lineX);
  const isHit  = dist <= tol;

  if (isHit) { correctCount++; bestDe = Math.min(bestDe, currentRound.de); }
  else wrongCount++;

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

function gradeMessage(pct) {
  if (pct >= 85) return "Exceptional — almost inhuman.";
  if (pct >= 65) return "Sharp eyes. Well done.";
  if (pct >= 45) return "Solid. Respectable perception.";
  if (pct >= 25) return "Room to improve.";
  return "The shades were cruel. Try again.";
}

// ── HUD & Feedback ────────────────────────────────────────────
function updateHUD() {
  roundDisplay.textContent = `Round ${Math.min(round, TOTAL_ROUNDS)} / ${TOTAL_ROUNDS}`;
  scoreDisplay.textContent = round > 1
    ? `Acc: ${Math.round((correctCount / (round - 1)) * 100)}%`
    : `Acc: —`;
  if (deltaDisplay && currentRound) {
    deltaDisplay.textContent = `Diff ${currentRound.de.toFixed(4)}`;
  }
}

function clearFeedback() {
  feedbackText.textContent = "\u00a0";
  feedbackText.className   = "";
  feedbackBar.className    = "";
  document.getElementById("canvas-wrapper").classList.remove("reveal-hit", "reveal-miss");
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
  feedbackBar.className    = cls;
}

// ── Canvas helpers ────────────────────────────────────────────
function cssW() { return canvas.width  / (window.devicePixelRatio || 1); }
function cssH() { return canvas.height / (window.devicePixelRatio || 1); }

function resizeCanvas() {
  const wrapper = document.getElementById("canvas-wrapper");
  const rect    = wrapper.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;

  const cs   = getComputedStyle(wrapper);
  const padH = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const padV = parseFloat(cs.paddingTop)  + parseFloat(cs.paddingBottom);
  const w    = rect.width  - padH;
  const h    = rect.height - padV;
  if (!w || !h) return false;

  const dpr     = window.devicePixelRatio || 1;
  canvas.width        = Math.round(w * dpr);
  canvas.height       = Math.round(h * dpr);
  canvas.style.width  = w + "px";
  canvas.style.height = h + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return true;
}

window.addEventListener("resize", () => {
  if (gameUI.classList.contains("hidden")) return;
  if (!resizeCanvas()) return;
  if (currentRound) {
    currentRound.W = cssW();
    currentRound.H = cssH();
    drawRound(currentRound);
  }
});

// ── Event listeners ───────────────────────────────────────────
startBtn.addEventListener("click", startGame);

document.getElementById("restart-btn").addEventListener("click", startGame);

shareChallengeBtn.addEventListener("click", shareChallenge);

copyCardBtn.addEventListener("click", copyScoreCard);

downloadCardBtn.addEventListener("click", downloadScoreCard);

// ── Init ──────────────────────────────────────────────────────
updateStartBest();
configureChallengePrompt();

if (shouldAutoStart()) {
  const boot = () => startGame();
  if (document.readyState === "complete") {
    setTimeout(boot, 0);
  } else {
    window.addEventListener("load", boot, { once: true });
  }
}

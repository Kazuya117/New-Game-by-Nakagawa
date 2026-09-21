// プードルとキャッチボール
// ドラッグで引っぱって投げたボールを、黒いミディアムプードルがキャッチするゲーム
(() => {
'use strict';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// ---------------------------------------------------------------
// 定数
// ---------------------------------------------------------------
const W = 960, H = 540;
const GROUND = 440;            // 地面の y 座標
const PX_PER_M = 40;           // 1m あたりのピクセル数
const G = 900;                 // 重力 (px/s^2)
const STEP = 1 / 120;          // 物理の固定タイムステップ
const BALL_R = 9;
const THROWS = 10;             // 1ゲームの投球数

const HAND_X = 150, HAND_Y = GROUND - 100;   // 飼い主の手の基本位置 (距離の基準点)
const MAX_PULL = 190;          // 引っぱりの最大長さ (px)
const PULL_TO_V = 5;           // 引っぱり長さ → 初速の係数

const DOG_HOME_X = 235;
const DOG_SPEED = 320;         // ボールを追う速さ (px/s)
const DOG_RETURN_SPEED = 430;  // 持って帰る速さ
const DOG_REACT = 0.15;        // 投げてから走り出すまでの反応時間
const JUMP_STEPS = 30;         // ジャンプしてから口が届くまでのステップ数 (0.25秒)
const JUMP_A = -0.35;          // ジャンプ時の体の角度
const ZONE_HALF = 55;          // ボーナスゾーンの半幅

// 犬の体の基準点 (右向き・足元原点のローカル座標)
const HIP_X = -22;
const HIP_STAND_Y = -40;
const HIP_SIT_Y = -22;
const SHOULDER = { x: 42, y: -2 };   // 腰から見た肩の位置
const HEAD = { x: 52, y: -30 };      // 腰から見た頭の中心
const MOUTH_REL = { x: 20, y: 7 };   // 頭の中心から見た口の位置

const FUR = '#17171b';
const FUR_FAR = '#2a2a31';
const FUR_CURL = '#3d3d49';
const FONT = '"Hiragino Maru Gothic ProN", "BIZ UDPGothic", "Yu Gothic UI", Meiryo, sans-serif';
const BEST_KEY = 'poodle-catch-best';
const TAU = Math.PI * 2;

// ---------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (lo, hi) => lo + Math.random() * (hi - lo);

function rot(x, y, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: x * c - y * s, y: x * s + y * c };
}

// 犬の口の位置 (右向きローカル座標)
function mouthLocal(a, hipY, ha = 0) {
  const m = rot(MOUTH_REL.x, MOUTH_REL.y, ha);
  const r = rot(HEAD.x + m.x, HEAD.y + m.y, a);
  return { x: HIP_X + r.x, y: hipY + r.y };
}
const MOUTH_STAND = mouthLocal(0, HIP_STAND_Y);   // {x: 50, y: -63}

function loadBest() {
  try { return +localStorage.getItem(BEST_KEY) || 0; } catch (e) { return 0; }
}
function saveBest(v) {
  try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) { /* 保存できなくても遊べる */ }
}

// ---------------------------------------------------------------
// サウンド (WebAudio の簡単な合成音)
// ---------------------------------------------------------------
let actx = null;
let soundOn = true;

let audioUnlocked = false;

// タップ操作のたびに呼ぶ。iOS Safari はユーザー操作中でないと音声を開始できない
function initAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // iPhone の消音スイッチがオンでも鳴るように「メディア再生」扱いにする (iOS 16.4+)
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* 非対応でも問題なし */ }
    actx = new AC();
  }
  // iOS では suspended のほか interrupted (着信・アプリ切り替え後) にもなる
  if (actx.state !== 'running') {
    const p = actx.resume();
    if (p && p.catch) p.catch(() => {});
  }
  if (!audioUnlocked) {
    // 無音のバッファを再生して、音声出力を確実に有効化する
    const src = actx.createBufferSource();
    src.buffer = actx.createBuffer(1, 1, 22050);
    src.connect(actx.destination);
    src.start(0);
    if (actx.state === 'running') audioUnlocked = true;
  }
}

function tone(f1, f2, dur, type = 'sine', vol = 0.12, delay = 0) {
  if (!actx || !soundOn) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, t);
  o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(actx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

const sfx = {
  throw() { tone(300, 900, 0.18, 'triangle', 0.08); },
  bounce() { tone(180, 80, 0.1, 'sine', 0.2); },
  catch() { tone(880, 880, 0.1, 'sine', 0.12); tone(1320, 1320, 0.2, 'sine', 0.12, 0.09); },
  bonus() { tone(1047, 1047, 0.1, 'sine', 0.1, 0.25); tone(1568, 1568, 0.25, 'sine', 0.1, 0.34); },
  bark() { tone(520, 250, 0.09, 'sawtooth', 0.09); tone(560, 260, 0.1, 'sawtooth', 0.09, 0.17); },
  miss() { tone(400, 170, 0.45, 'triangle', 0.1); },
  finish() { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.22, 'sine', 0.1, i * 0.13)); },
};

// ---------------------------------------------------------------
// ゲーム状態
// ---------------------------------------------------------------
const game = {
  mode: 'title',     // title | aim | flight | caught | miss | return | gameover
  modeTime: 0,
  time: 0,
  score: 0,
  best: loadBest(),
  newBest: false,
  throwsLeft: THROWS,
  round: 0,
  wind: 0,
  zone: null,
  combo: 0,
  catches: 0,
  airCatches: 0,
  longest: 0,
  hint: '',
  hintTime: 0,
};

const ball = { x: HAND_X, y: HAND_Y, vx: 0, vy: 0, held: 'player', touched: false, rolling: false, justBounced: false, spin: 0 };

const dog = {
  x: DOG_HOME_X, facing: 1, vx: 0,
  pose: 'sit',        // sit | stand | run | jump | happy | sad
  phase: 0,           // 走りアニメーションの位相
  ha: 0,              // 頭の角度
  jx: 0, jy: 0, jvy: 0,
  jump: null,         // {n, dx, dy, ha0}
  falling: false,
  react: 0,
  landX: 0,
  hasBall: false,
};

const owner = { throwTime: 99, throwDir: { x: 1, y: -1 } };
let drag = null;       // {sx, sy, x, y}
const popups = [];
const particles = [];
const clouds = [
  { x: 120, y: 70, s: 1.0 }, { x: 420, y: 120, s: 0.7 },
  { x: 650, y: 55, s: 1.2 }, { x: 880, y: 140, s: 0.8 },
];

function setMode(m) { game.mode = m; game.modeTime = 0; }

function addPopup(text, x, y, color = '#fff', size = 26, delay = 0) {
  popups.push({ text, x: clamp(x, 110, W - 110), y, color, size, t: -delay });
}

function burst(x, y, n, colors) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), v = rand(80, 260);
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, t: 0, life: rand(0.5, 0.9), color: colors[i % colors.length], r: rand(3, 6) });
  }
}

function startGame() {
  game.score = 0; game.throwsLeft = THROWS; game.round = 0; game.combo = 0;
  game.catches = 0; game.airCatches = 0; game.longest = 0; game.newBest = false;
  popups.length = 0; particles.length = 0;
  dog.x = DOG_HOME_X; dog.facing = 1; dog.pose = 'sit'; dog.hasBall = false;
  dog.jump = null; dog.falling = false; dog.jx = dog.jy = 0;
  ball.held = 'player';
  nextRound();
}

function nextRound() {
  game.round++;
  // 3球目から風が吹く
  game.wind = game.round >= 3 ? Math.round(rand(-120, 120) / 10) * 10 : 0;
  game.zone = { x: rand(430, 860) };
  ball.held = 'player'; ball.touched = false; ball.rolling = false; ball.vx = ball.vy = 0;
  setMode('aim');
}

// ---------------------------------------------------------------
// ボールの物理
// ---------------------------------------------------------------
function stepBall(b, wind) {
  const dt = STEP;
  if (b.rolling) {
    b.vx *= Math.exp(-2.2 * dt);
    if (Math.abs(b.vx) < 5) b.vx = 0;
    b.x += b.vx * dt;
    b.spin += b.vx * dt / BALL_R;
    return;
  }
  b.vx += wind * dt;
  b.vy += G * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  b.spin += b.vx * dt / BALL_R * 0.5;
  if (b.y >= GROUND - BALL_R) {
    b.y = GROUND - BALL_R;
    b.touched = true;
    if (b.vy > 140) {
      b.vy = -b.vy * 0.5;
      b.vx *= 0.72;
      b.justBounced = true;
    } else {
      b.vy = 0;
      b.rolling = true;
    }
  }
}

function cloneBall(b) {
  return { x: b.x, y: b.y, vx: b.vx, vy: b.vy, touched: b.touched, rolling: b.rolling, justBounced: false, spin: 0 };
}

// 最初に地面に着く位置
function predictLanding(b) {
  const c = cloneBall(b);
  for (let i = 0; i < 6 / STEP && !c.touched; i++) stepBall(c, game.wind);
  return c.x;
}

// n ステップ後のボール (途中で地面に触れたら null)
function predictAfter(b, n) {
  const c = cloneBall(b);
  c.touched = false;
  for (let i = 0; i < n; i++) {
    stepBall(c, game.wind);
    if (c.touched) return null;
  }
  return c;
}

// ---------------------------------------------------------------
// 投げる
// ---------------------------------------------------------------
function pullVector() {
  if (!drag) return null;
  let px = drag.sx - drag.x, py = drag.sy - drag.y;
  const len = Math.hypot(px, py);
  if (len < 1) return { x: 0, y: 0, len: 0 };
  const k = Math.min(len, MAX_PULL) / len;
  return { x: px * k, y: py * k, len: len * k };
}

function handPos() {
  if (game.mode === 'aim' && drag) {
    const p = pullVector();
    return { x: HAND_X - p.x * 0.3, y: HAND_Y - p.y * 0.3 };
  }
  if (owner.throwTime < 0.5) {
    // 投げ終わりのフォロースルー
    const u = Math.min(1, owner.throwTime / 0.12);
    return { x: HAND_X + owner.throwDir.x * 28 * u, y: HAND_Y + owner.throwDir.y * 28 * u };
  }
  return { x: HAND_X, y: HAND_Y };
}

function isValidPull(p) { return p && p.len >= 20 && p.x * PULL_TO_V > 60; }

function releaseThrow() {
  const p = pullVector();
  const h = handPos();
  drag = null;
  canvas.classList.remove('dragging');
  if (!p || p.len < 20) return;
  if (!isValidPull(p)) {
    game.hint = '左下に引っぱって、右上に向かって投げよう！';
    game.hintTime = 2.5;
    return;
  }
  ball.x = h.x; ball.y = h.y;
  ball.vx = p.x * PULL_TO_V; ball.vy = p.y * PULL_TO_V;
  ball.held = null; ball.touched = false; ball.rolling = false;
  owner.throwTime = 0;
  owner.throwDir = { x: p.x / p.len, y: p.y / p.len };
  game.throwsLeft--;
  dog.react = DOG_REACT;
  dog.landX = predictLanding(ball);
  sfx.throw();
  setMode('flight');
}

// ---------------------------------------------------------------
// 犬の行動
// ---------------------------------------------------------------
function updateDogChase() {
  const dt = STEP;
  if (dog.jump) { updateJump(); return; }
  dog.react -= dt;
  if (dog.react > 0) return;

  // 着地前は落下予測地点へ、着地後は転がるボールを少し先読みして追う
  let tx = ball.touched ? ball.x + ball.vx * 0.25 : dog.landX;
  tx = clamp(tx, 30, W - 10);
  const diff = tx - dog.x;
  if (Math.abs(diff) > 60) dog.facing = Math.sign(diff);
  const desired = tx - dog.facing * MOUTH_STAND.x;
  const d = desired - dog.x;
  if (Math.abs(d) <= DOG_SPEED * dt) {
    dog.x = desired; dog.vx = 0; dog.pose = 'stand';
  } else {
    dog.vx = Math.sign(d) * DOG_SPEED;
    dog.x += dog.vx * dt;
    dog.pose = 'run';
  }

  const mx = dog.x + dog.facing * MOUTH_STAND.x;

  // 低いボールはそのままパクッ
  const h = GROUND - ball.y;
  if (Math.abs(ball.x - mx) < 22 && h < 100) { catchBall(false); return; }

  // ジャンプキャッチの判定: 0.25秒後のボール位置に口が届くなら跳ぶ
  if (!ball.rolling && ball.vy > -150) {
    const p = predictAfter(ball, JUMP_STEPS);
    if (p) {
      const m = mouthLocal(JUMP_A, HIP_STAND_Y);
      const dx = p.x - (dog.x + dog.facing * m.x);
      const dy = p.y - (GROUND + m.y);
      const ph = GROUND - p.y;
      if (ph > 70 && ph < 185 && Math.abs(dx) < 80 && dx * dog.facing > -30 && dy < 0) {
        dog.jump = { n: 0, dx, dy, ha0: dog.ha };
        dog.pose = 'jump';
        dog.vx = 0;
      }
    }
  }
}

function updateJump() {
  const j = dog.jump;
  j.n++;
  const u = j.n / JUMP_STEPS;
  dog.jx = j.dx * u;
  dog.jy = j.dy * (1 - (1 - u) * (1 - u));
  dog.ha = j.ha0 * (1 - u);
  if (j.n >= JUMP_STEPS) {
    const stretch = Math.abs(j.dx) > 45;
    dog.x += j.dx; dog.jx = 0;
    dog.jump = null; dog.falling = true; dog.jvy = 0;
    catchBall(stretch);
  }
}

function updateDogFall() {
  if (!dog.falling) return;
  dog.jvy += 1800 * STEP;
  dog.jy += dog.jvy * STEP;
  if (dog.jy >= 0) { dog.jy = 0; dog.falling = false; dog.pose = 'happy'; }
}

function catchBall(stretch) {
  const air = !ball.touched;
  const dist = Math.max(0, (ball.x - HAND_X) / PX_PER_M);
  const base = Math.round(dist);
  let pts = air ? base * 2 : base;
  const px = ball.x, py = Math.min(ball.y, GROUND - 90) - 40;

  ball.held = 'dog'; dog.hasBall = true; dog.vx = 0;
  if (!dog.falling) dog.pose = 'happy';

  game.catches++;
  game.longest = Math.max(game.longest, dist);
  let line = 0;
  if (air) {
    game.airCatches++;
    game.combo++;
    addPopup(stretch ? 'ダイビングキャッチ！' : 'ナイスキャッチ！', px, py, '#ffe45c', 30);
    if (stretch) pts += 10;
    const inZone = game.zone && Math.abs(ball.x - game.zone.x) <= ZONE_HALF;
    if (inZone) {
      pts += 30;
      addPopup('★ボーナスゾーン +30', px, py + 62 + 26 * line++, '#ffb02e', 22, 0.25);
      sfx.bonus();
    }
    if (game.combo >= 2) {
      const c = 5 * (game.combo - 1);
      pts += c;
      addPopup(`${game.combo}れんぞく！ +${c}`, px, py + 62 + 26 * line++, '#ff8fb3', 22, 0.35);
    }
    burst(ball.x, ball.y, 16, ['#ffe45c', '#fff', '#ffb02e']);
  } else {
    game.combo = 0;
    addPopup('バウンドキャッチ', px, py, '#d8f0ff', 26);
    burst(ball.x, ball.y, 6, ['#fff', '#d8f0ff']);
  }
  addPopup(`${dist.toFixed(1)}m  +${pts}`, px, py + 32, '#fff', 24, 0.1);
  game.score += pts;
  sfx.catch();
  sfx.bark();
  setMode('caught');
}

function missBall() {
  game.combo = 0;
  ball.held = 'gone';
  dog.pose = 'sad'; dog.vx = 0;
  addPopup('とおすぎた…！', W - 160, GROUND - 170, '#d8e4ff', 28);
  sfx.miss();
  setMode('miss');
}

function updateReturn() {
  dog.facing = -1;
  dog.pose = 'run';
  dog.vx = -DOG_RETURN_SPEED;
  dog.x += dog.vx * STEP;
  if (dog.x <= DOG_HOME_X) {
    dog.x = DOG_HOME_X; dog.facing = 1; dog.vx = 0; dog.pose = 'sit'; dog.hasBall = false;
    if (game.throwsLeft <= 0) {
      ball.held = 'player';
      if (game.score > game.best) { game.best = game.score; game.newBest = true; saveBest(game.best); }
      sfx.finish();
      setMode('gameover');
    } else {
      nextRound();
    }
  }
}

// ---------------------------------------------------------------
// 更新
// ---------------------------------------------------------------
function update() {
  const dt = STEP;
  game.time += dt;
  game.modeTime += dt;
  owner.throwTime += dt;
  if (game.hintTime > 0) game.hintTime -= dt;

  for (const c of clouds) {
    c.x += (8 + game.wind * 0.2) * c.s * dt;
    if (c.x > W + 120) c.x = -120;
    if (c.x < -120) c.x = W + 120;
  }
  for (let i = popups.length - 1; i >= 0; i--) {
    popups[i].t += dt;
    if (popups[i].t > 1.5) popups.splice(i, 1);
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.t += dt; p.vy += 500 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.t > p.life) particles.splice(i, 1);
  }

  switch (game.mode) {
    case 'flight':
      stepBall(ball, game.wind);
      if (ball.justBounced) { sfx.bounce(); ball.justBounced = false; }
      updateDogChase();
      if (game.mode === 'flight' && (ball.x > W + 40 || ball.x < -40)) missBall();
      break;
    case 'caught':
      updateDogFall();
      if (game.modeTime > 1.1 && !dog.falling) setMode('return');
      break;
    case 'miss':
      if (game.modeTime > 1.4) setMode('return');
      break;
    case 'return':
      updateReturn();
      break;
  }

  if (dog.pose === 'run') dog.phase += dt * 15;

  // ボールの位置 (持たれている間)
  if (ball.held === 'player') { const h = handPos(); ball.x = h.x; ball.y = h.y; }

  // 頭をボールの方へ向ける
  let target = 0;
  if (dog.pose === 'sad') target = 0.55;
  else if (!dog.hasBall && !dog.jump && ball.held !== 'gone') {
    const pose = dogPose();
    const hc = rot(HEAD.x, HEAD.y, pose.a);
    const hx = dog.x + dog.facing * (HIP_X + hc.x), hy = GROUND + pose.hipY + hc.y;
    target = clamp(Math.atan2(ball.y - hy, (ball.x - hx) * dog.facing) - pose.a, -0.75, 0.4);
  }
  if (!dog.jump) dog.ha += (target - dog.ha) * Math.min(1, dt * 10);
}

// ---------------------------------------------------------------
// 描画: 背景
// ---------------------------------------------------------------
function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND);
  sky.addColorStop(0, '#6ec3ff');
  sky.addColorStop(1, '#d4f1ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // 太陽
  ctx.fillStyle = 'rgba(255, 244, 180, 0.5)';
  ctx.beginPath(); ctx.arc(820, 80, 58, 0, TAU); ctx.fill();
  ctx.fillStyle = '#fff2a8';
  ctx.beginPath(); ctx.arc(820, 80, 40, 0, TAU); ctx.fill();

  // 雲
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  for (const c of clouds) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, 24 * c.s, 0, TAU);
    ctx.arc(c.x + 28 * c.s, c.y - 10 * c.s, 30 * c.s, 0, TAU);
    ctx.arc(c.x + 62 * c.s, c.y, 24 * c.s, 0, TAU);
    ctx.arc(c.x + 30 * c.s, c.y + 8 * c.s, 26 * c.s, 0, TAU);
    ctx.fill();
  }

  // 遠くの丘
  ctx.fillStyle = '#a5dba0';
  ctx.beginPath();
  ctx.moveTo(0, GROUND - 10);
  ctx.quadraticCurveTo(160, GROUND - 120, 380, GROUND - 40);
  ctx.quadraticCurveTo(560, GROUND - 130, 760, GROUND - 50);
  ctx.quadraticCurveTo(880, GROUND - 100, W, GROUND - 60);
  ctx.lineTo(W, GROUND); ctx.lineTo(0, GROUND);
  ctx.fill();

  // 木
  const trees = [[40, 1.1], [330, 0.8], [610, 0.9], [900, 1.0]];
  for (const [tx, s] of trees) {
    const by = GROUND - 22;
    ctx.fillStyle = '#8a6240';
    ctx.fillRect(tx - 5 * s, by - 60 * s, 10 * s, 62 * s);
    ctx.fillStyle = '#5cb26a';
    ctx.beginPath();
    ctx.arc(tx, by - 80 * s, 34 * s, 0, TAU);
    ctx.arc(tx - 24 * s, by - 60 * s, 24 * s, 0, TAU);
    ctx.arc(tx + 24 * s, by - 60 * s, 24 * s, 0, TAU);
    ctx.fill();
  }

  // 芝生
  const grass = ctx.createLinearGradient(0, GROUND - 24, 0, H);
  grass.addColorStop(0, '#86d46a');
  grass.addColorStop(1, '#4fa844');
  ctx.fillStyle = grass;
  ctx.fillRect(0, GROUND - 24, W, H - GROUND + 24);
  ctx.strokeStyle = 'rgba(40, 120, 40, 0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 40; i++) {
    const gx = (i * 97) % W, gy = GROUND + 8 + ((i * 53) % 80);
    ctx.beginPath();
    ctx.moveTo(gx, gy); ctx.lineTo(gx - 3, gy - 8);
    ctx.moveTo(gx + 4, gy); ctx.lineTo(gx + 6, gy - 9);
    ctx.stroke();
  }
}

function drawMarkers() {
  for (let m = 5; HAND_X + m * PX_PER_M < W - 15; m += 5) {
    const x = HAND_X + m * PX_PER_M;
    ctx.fillStyle = '#9b7a55';
    ctx.fillRect(x - 2, GROUND - 4, 4, 30);
    ctx.fillStyle = '#fff8e6';
    roundRect(x - 19, GROUND + 22, 38, 20, 5); ctx.fill();
    ctx.strokeStyle = '#9b7a55'; ctx.lineWidth = 2; ctx.stroke();
    text(`${m}m`, x, GROUND + 33, 13, '#6b4d2c', 'center', false);
  }
}

function drawZone() {
  if (!game.zone || game.mode === 'title' || game.mode === 'gameover') return;
  const z = game.zone, pulse = 0.5 + 0.15 * Math.sin(game.time * 4);
  ctx.save();
  ctx.fillStyle = `rgba(255, 221, 70, ${pulse})`;
  ctx.beginPath(); ctx.ellipse(z.x, GROUND + 4, ZONE_HALF, 10, 0, 0, TAU); ctx.fill();
  ctx.setLineDash([7, 5]);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
  text('★', z.x, GROUND + 5, 16, '#fff', 'center', false);
}

// ---------------------------------------------------------------
// 描画: 飼い主
// ---------------------------------------------------------------
function drawOwner() {
  const g = GROUND, h = handPos();
  ctx.lineCap = 'round';
  // 影
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath(); ctx.ellipse(106, g + 3, 30, 6, 0, 0, TAU); ctx.fill();
  // 足
  ctx.strokeStyle = '#3b5b8c'; ctx.lineWidth = 12;
  ctx.beginPath(); ctx.moveTo(101, g - 68); ctx.lineTo(95, g - 6); ctx.moveTo(111, g - 68); ctx.lineTo(118, g - 6); ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(93, g - 3); ctx.lineTo(103, g - 3); ctx.moveTo(116, g - 3); ctx.lineTo(126, g - 3); ctx.stroke();
  // 体
  ctx.fillStyle = '#f08a5d';
  roundRect(90, g - 136, 32, 74, 12); ctx.fill();
  // 頭
  ctx.fillStyle = '#f6cfa3';
  ctx.beginPath(); ctx.arc(107, g - 154, 16, 0, TAU); ctx.fill();
  ctx.fillStyle = '#3a2a20';
  ctx.beginPath(); ctx.arc(105, g - 158, 16.5, Math.PI * 0.95, Math.PI * 1.95); ctx.fill();
  ctx.fillStyle = '#2b2b2b';
  ctx.beginPath(); ctx.arc(115, g - 154, 1.8, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#a0522d'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(113, g - 149, 5, 0.2, 1.4); ctx.stroke();
  // 腕
  ctx.strokeStyle = '#f08a5d'; ctx.lineWidth = 11;
  const sx = 110, sy = g - 124;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(lerp(sx, h.x, 0.45), lerp(sy, h.y, 0.45)); ctx.stroke();
  ctx.strokeStyle = '#f6cfa3'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(lerp(sx, h.x, 0.45), lerp(sy, h.y, 0.45)); ctx.lineTo(h.x, h.y); ctx.stroke();
}

// ---------------------------------------------------------------
// 描画: 黒いミディアムプードル
// ---------------------------------------------------------------
function dogPose() {
  switch (dog.pose) {
    case 'sit': return { a: -0.5, hipY: HIP_SIT_Y };
    case 'run': return { a: Math.sin(dog.phase * 2) * 0.05, hipY: HIP_STAND_Y - Math.abs(Math.sin(dog.phase)) * 4 };
    case 'jump': {
      if (dog.jump) return { a: JUMP_A * Math.min(1, dog.jump.n / JUMP_STEPS * 3), hipY: HIP_STAND_Y };
      return { a: clamp(JUMP_A + dog.jvy / 900, JUMP_A, 0.12), hipY: HIP_STAND_Y };
    }
    case 'happy': return { a: 0, hipY: HIP_STAND_Y - Math.abs(Math.sin(game.time * 11)) * 7 };
    default: return { a: 0, hipY: HIP_STAND_Y };
  }
}

function dogMouthWorld() {
  const pose = dogPose();
  const m = mouthLocal(pose.a, pose.hipY, dog.ha);
  return { x: dog.x + dog.jx + dog.facing * m.x, y: GROUND + dog.jy + m.y };
}

function fluff(cx, cy, r, bumps = 9, phase = 0) {
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
  for (let i = 0; i < bumps; i++) {
    const a = phase + i / bumps * TAU;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78, r * 0.4, 0, TAU); ctx.fill();
  }
}

function fluffEllipse(cx, cy, rx, ry, bumps = 12) {
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU); ctx.fill();
  for (let i = 0; i < bumps; i++) {
    const a = i / bumps * TAU;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rx * 0.85, cy + Math.sin(a) * ry * 0.85, Math.min(rx, ry) * 0.42, 0, TAU); ctx.fill();
  }
}

function curl(x, y, r, a0) {
  ctx.beginPath(); ctx.arc(x, y, r, a0, a0 + 2.4); ctx.stroke();
}

function drawLeg(jx, jy, ang, len, color) {
  const fx = jx + Math.sin(ang) * len, fy = jy + Math.cos(ang) * len;
  ctx.strokeStyle = color; ctx.lineWidth = 9; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(jx, jy); ctx.lineTo(fx, fy); ctx.stroke();
  ctx.fillStyle = color;
  fluff(fx, fy - 3, 6.5, 6);
}

function drawDog() {
  const pose = dogPose();
  const a = pose.a, hipY = pose.hipY;
  const airborne = dog.pose === 'jump';
  const t = game.time;

  // 影
  const shadowK = clamp(1 + dog.jy / 300, 0.4, 1);
  ctx.fillStyle = `rgba(0,0,0,${0.18 * shadowK})`;
  ctx.beginPath(); ctx.ellipse(dog.x + dog.jx + dog.facing * 8, GROUND + 4, 44 * shadowK, 7 * shadowK, 0, 0, TAU); ctx.fill();

  ctx.save();
  ctx.translate(dog.x + dog.jx, GROUND + dog.jy);
  ctx.scale(dog.facing, 1);

  const hip = { x: HIP_X, y: hipY };
  const sr = rot(SHOULDER.x, SHOULDER.y, a);
  const sh = { x: HIP_X + sr.x, y: hipY + sr.y };

  // 足の角度
  let legs;   // [後ろ奥, 前奥, 後ろ手前, 前手前] = {ang, len}
  if (dog.pose === 'run') {
    const p = dog.phase;
    const L = (ph) => ({ ang: Math.sin(ph) * 0.75, len: -hipY * (1 - 0.18 * Math.max(0, Math.cos(ph))) });
    legs = [L(p + Math.PI), L(p + 0.5), L(p + Math.PI + 0.6), L(p)];
  } else if (airborne) {
    const k = dog.jump ? 1 : 0.5;
    legs = [{ ang: -0.95 * k, len: 36 }, { ang: 1.0 * k, len: 34 }, { ang: -0.75 * k, len: 36 }, { ang: 1.2 * k, len: 34 }];
  } else {
    legs = [{ ang: -0.06, len: -hipY }, { ang: 0.06, len: -sh.y }, { ang: 0.06, len: -hipY }, { ang: -0.04, len: -sh.y }];
  }

  // 奥の足
  if (dog.pose === 'sit') {
    drawLeg(sh.x - 5, sh.y + 4, 0.02, -sh.y - 4, FUR_FAR);
  } else {
    drawLeg(hip.x + 5, hip.y + 4, legs[0].ang, legs[0].len - 4, FUR_FAR);
    drawLeg(sh.x - 5, sh.y + 4, legs[1].ang, legs[1].len - 4, FUR_FAR);
  }

  // しっぽ (ポンポン付き)
  let wag = 0;
  if (dog.pose === 'sit' || dog.pose === 'happy') wag = Math.sin(t * 18) * 0.45;
  else if (dog.pose === 'stand') wag = Math.sin(t * 10) * 0.25;
  else if (dog.pose === 'run') wag = Math.sin(dog.phase) * 0.2;
  const tailBase = dog.pose === 'sad' ? -2.3 : -0.35;
  ctx.save();
  ctx.translate(hip.x, hip.y);
  ctx.rotate(a);
  ctx.translate(-8, -8);
  ctx.rotate(tailBase + wag);
  ctx.strokeStyle = FUR; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -20); ctx.stroke();
  ctx.fillStyle = FUR;
  fluff(0, -26, 8.5, 7);
  ctx.restore();

  // 体
  ctx.save();
  ctx.translate(hip.x, hip.y);
  ctx.rotate(a);
  ctx.fillStyle = FUR;
  fluffEllipse(21, -2, 30, 16, 14);
  fluff(40, -5, 15, 8);        // 胸
  fluff(-2, -1, 15, 8);        // おしり
  ctx.strokeStyle = FUR_CURL; ctx.lineWidth = 1.6;
  curl(10, -6, 4, 0.5); curl(24, 2, 4, 2.5); curl(34, -9, 3.5, 4.2); curl(0, 2, 3.5, 1.2); curl(44, 0, 3.5, 3.3);
  ctx.restore();

  // 手前の足
  if (dog.pose === 'sit') {
    ctx.fillStyle = FUR;
    fluff(hip.x + 6, hip.y + 6, 15, 8);
    ctx.strokeStyle = FUR; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hip.x + 6, -5); ctx.lineTo(hip.x + 28, -5); ctx.stroke();
    fluff(hip.x + 30, -6, 6.5, 6);
    drawLeg(sh.x + 3, sh.y + 4, 0.05, -sh.y - 4, FUR);
  } else {
    drawLeg(hip.x, hip.y + 4, legs[2].ang, legs[2].len - 4, FUR);
    drawLeg(sh.x, sh.y + 4, legs[3].ang, legs[3].len - 4, FUR);
  }

  // 首・頭
  ctx.save();
  ctx.translate(hip.x, hip.y);
  ctx.rotate(a);
  ctx.strokeStyle = FUR; ctx.lineWidth = 17; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(40, -8); ctx.lineTo(HEAD.x - 3, HEAD.y + 6); ctx.stroke();
  // 首輪
  ctx.strokeStyle = '#e0453c'; ctx.lineWidth = 5; ctx.lineCap = 'butt';
  ctx.beginPath(); ctx.moveTo(38, -19); ctx.lineTo(54, -13); ctx.stroke();
  ctx.fillStyle = '#ffd24a';
  ctx.beginPath(); ctx.arc(49, -11, 3.2, 0, TAU); ctx.fill();

  ctx.translate(HEAD.x, HEAD.y);
  ctx.rotate(dog.ha);
  ctx.fillStyle = FUR;
  // マズル
  ctx.beginPath(); ctx.ellipse(13, 3, 12, 6.5, -0.05, 0, TAU); ctx.fill();
  // 舌
  const tongueOut = !dog.hasBall && (dog.pose === 'run' || dog.pose === 'sit' || dog.pose === 'happy' || dog.pose === 'stand');
  if (tongueOut) {
    ctx.fillStyle = '#ff8fa3';
    ctx.beginPath(); ctx.ellipse(17, 10 + Math.sin(t * 12) * 0.8, 3.2, 5.5, 0.2, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = FUR;
  ctx.beginPath(); ctx.arc(0, 0, 13, 0, TAU); ctx.fill();
  // トップノット
  fluff(-2, -14, 11.5, 8, 0.3);
  // 鼻
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(24.5, 1, 3.2, 0, TAU); ctx.fill();
  ctx.fillStyle = '#6a6a78';
  ctx.beginPath(); ctx.arc(25.2, 0, 1.1, 0, TAU); ctx.fill();
  // 目
  if (dog.pose === 'happy') {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(6, -2, 3.2, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  } else {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(6, -3, 3.3, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2a1608';
    ctx.beginPath(); ctx.arc(6.8, -3, 2.2, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(7.5, -3.9, 0.8, 0, TAU); ctx.fill();
  }
  // 耳 (ふわふわのたれ耳)
  let earSwing = dog.pose === 'run' ? -0.35 + Math.sin(dog.phase * 2) * 0.2 : 0;
  if (airborne) earSwing = dog.jump ? 0.3 : -0.9;
  if (dog.pose === 'happy') earSwing = Math.sin(t * 11) * 0.25;
  ctx.save();
  ctx.translate(-7, -5);
  ctx.rotate(0.25 + earSwing);
  ctx.fillStyle = FUR;
  fluffEllipse(0, 12, 7.5, 15, 10);
  ctx.strokeStyle = FUR_CURL; ctx.lineWidth = 1.5;
  curl(0, 8, 3, 1); curl(1, 18, 3, 3);
  ctx.restore();
  ctx.strokeStyle = FUR_CURL; ctx.lineWidth = 1.5;
  curl(-3, -16, 3.5, 3.6); curl(3, -12, 3, 0.4);
  ctx.restore();

  ctx.restore();
}

// ---------------------------------------------------------------
// 描画: ボール・エフェクト・UI
// ---------------------------------------------------------------
function drawBall() {
  if (ball.held === 'gone') return;
  let x = ball.x, y = ball.y;
  if (ball.held === 'dog') { const m = dogMouthWorld(); x = m.x; y = m.y + 2; ball.x = x; ball.y = y; }
  if (!ball.held) {
    const k = clamp(1 - (GROUND - y) / 400, 0.3, 1);
    ctx.fillStyle = `rgba(0,0,0,${0.2 * k})`;
    ctx.beginPath(); ctx.ellipse(x, GROUND + 4, 10 * k, 3.5 * k, 0, 0, TAU); ctx.fill();
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ball.spin);
  ctx.fillStyle = '#d4ee3a';
  ctx.beginPath(); ctx.arc(0, 0, BALL_R, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#8aa317'; ctx.lineWidth = 1; ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(-8, 0, 7, -0.9, 0.9); ctx.stroke();
  ctx.beginPath(); ctx.arc(8, 0, 7, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke();
  ctx.restore();
}

function drawAim() {
  if (game.mode !== 'aim' || !drag) return;
  const p = pullVector();
  if (!p || p.len < 20) return;
  const h = handPos();
  const ok = isValidPull(p);
  const power = p.len / MAX_PULL;

  // 方向と強さの矢印
  ctx.strokeStyle = ok ? `hsl(${120 - power * 120}, 85%, 50%)` : 'rgba(150,150,150,0.8)';
  ctx.lineWidth = 5; ctx.lineCap = 'round';
  const ex = h.x + p.x * 0.45, ey = h.y + p.y * 0.45;
  ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(ex, ey); ctx.stroke();
  const ang = Math.atan2(p.y, p.x);
  ctx.beginPath();
  ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(ang - 0.5) * 12, ey - Math.sin(ang - 0.5) * 12);
  ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(ang + 0.5) * 12, ey - Math.sin(ang + 0.5) * 12);
  ctx.stroke();

  if (!ok) return;
  // 軌道プレビュー (はじめの0.55秒ぶんだけ)
  const c = { x: h.x, y: h.y, vx: p.x * PULL_TO_V, vy: p.y * PULL_TO_V, touched: false, rolling: false, spin: 0 };
  for (let i = 1; i <= 66 && !c.touched; i++) {
    stepBall(c, game.wind);
    if (i % 6 === 0) {
      ctx.fillStyle = `rgba(255,255,255,${0.9 - i / 66 * 0.7})`;
      ctx.beginPath(); ctx.arc(c.x, c.y, 4, 0, TAU); ctx.fill();
    }
  }
}

function drawEffects() {
  for (const p of particles) {
    ctx.globalAlpha = clamp(1 - p.t / p.life, 0, 1);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const p of popups) {
    if (p.t < 0) continue;
    const pop = p.t < 0.15 ? 0.6 + p.t / 0.15 * 0.4 : 1;
    ctx.globalAlpha = clamp((1.5 - p.t) / 0.4, 0, 1);
    text(p.text, p.x, p.y - p.t * 22, p.size * pop, p.color, 'center', true);
  }
  ctx.globalAlpha = 1;
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function text(str, x, y, size, color, align = 'center', outline = true) {
  ctx.font = `bold ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (outline) {
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(30, 40, 60, 0.85)';
    ctx.lineWidth = Math.max(3, size / 6);
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

const SOUND_BTN = { x: W - 52, y: 12, w: 40, h: 40 };

function drawSoundButton() {
  const b = SOUND_BTN;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  roundRect(b.x, b.y, b.w, b.h, 10); ctx.fill();
  const cx = b.x + 16, cy = b.y + 20;
  ctx.fillStyle = '#35507a';
  ctx.beginPath();
  ctx.moveTo(cx - 8, cy - 4); ctx.lineTo(cx - 3, cy - 4); ctx.lineTo(cx + 4, cy - 10);
  ctx.lineTo(cx + 4, cy + 10); ctx.lineTo(cx - 3, cy + 4); ctx.lineTo(cx - 8, cy + 4);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#35507a'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
  if (soundOn) {
    ctx.beginPath(); ctx.arc(cx + 5, cy, 6, -0.8, 0.8); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + 5, cy, 11, -0.8, 0.8); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(cx + 9, cy - 5); ctx.lineTo(cx + 18, cy + 5); ctx.moveTo(cx + 18, cy - 5); ctx.lineTo(cx + 9, cy + 5); ctx.stroke();
  }
}

function drawHUD() {
  // スコア
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  roundRect(12, 12, 190, 62, 12); ctx.fill();
  text('スコア', 26, 30, 14, '#5b6f8f', 'left', false);
  text(String(game.score), 26, 54, 26, '#25324a', 'left', false);
  text(`ベスト ${Math.max(game.best, 0)}`, 190, 30, 13, '#5b6f8f', 'right', false);

  // 残りのボール
  const n = game.throwsLeft, bw = 22 * THROWS + 16;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  roundRect(W / 2 - bw / 2, 12, bw, 36, 12); ctx.fill();
  for (let i = 0; i < THROWS; i++) {
    const bx = W / 2 - bw / 2 + 19 + i * 22;
    ctx.fillStyle = i < n ? '#d4ee3a' : 'rgba(0,0,0,0.12)';
    ctx.beginPath(); ctx.arc(bx, 30, 8, 0, TAU); ctx.fill();
    if (i < n) { ctx.strokeStyle = '#8aa317'; ctx.lineWidth = 1; ctx.stroke(); }
  }

  // 風
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  roundRect(W - 200, 12, 138, 40, 12); ctx.fill();
  const ws = game.wind / 50;
  if (game.wind === 0) {
    text('風  なし', W - 131, 32, 16, '#5b6f8f', 'center', false);
  } else {
    text('風', W - 186, 32, 16, '#5b6f8f', 'left', false);
    const dir = Math.sign(game.wind), len = 14 + Math.abs(ws) * 8;
    const cx = W - 138, cy = 32;
    ctx.strokeStyle = dir > 0 ? '#2f9e6a' : '#e0653c'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - dir * len / 2, cy); ctx.lineTo(cx + dir * len / 2, cy);
    ctx.lineTo(cx + dir * (len / 2 - 7), cy - 6);
    ctx.moveTo(cx + dir * len / 2, cy); ctx.lineTo(cx + dir * (len / 2 - 7), cy + 6);
    ctx.stroke();
    text(`${Math.abs(ws).toFixed(1)}m`, W - 72, 32, 15, '#25324a', 'right', false);
  }

  if (game.mode === 'aim') {
    if (game.hintTime > 0) {
      text(game.hint, W / 2, 96, 20, '#fff');
    } else if (game.round === 1 && !drag) {
      text('画面をドラッグして引っぱり、はなすとボールを投げるよ！', W / 2, 96, 20, '#fff');
      text('遠くでノーバウンドキャッチするほど高得点。★の上ならボーナス！', W / 2, 124, 16, '#fff');
    } else if (game.round === 3 && !drag) {
      text('風が吹いてきた！ 風向きに気をつけよう', W / 2, 96, 20, '#fff');
    }
  }
}

function drawTitle() {
  ctx.fillStyle = 'rgba(20, 40, 70, 0.35)';
  ctx.fillRect(0, 0, W, H);
  text('プードルとキャッチボール', W / 2, 150, 52, '#fff');
  text('ボールを投げて、黒いプードルにキャッチしてもらおう！', W / 2, 215, 22, '#ffe45c');
  if (Math.sin(game.time * 4) > -0.4) text('クリック / タップでスタート', W / 2, 300, 26, '#fff');
  if (game.best > 0) text(`ベストスコア  ${game.best}`, W / 2, 350, 18, '#d8f0ff');
}

function drawGameOver() {
  const k = clamp(game.modeTime / 0.35, 0, 1);
  ctx.fillStyle = `rgba(20, 40, 70, ${0.45 * k})`;
  ctx.fillRect(0, 0, W, H);
  const pw = 460, ph = 330, px = W / 2 - pw / 2 + 110, py = 70 + (1 - k) * 30;
  ctx.globalAlpha = k;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  roundRect(px, py, pw, ph, 22); ctx.fill();
  const cx = px + pw / 2;
  text('おしまい！', cx, py + 44, 30, '#25324a', 'center', false);
  text(String(game.score), cx, py + 110, 72, '#e0653c', 'center', false);
  text(game.newBest ? '★ ベストスコア更新！ ★' : `ベスト ${game.best}`, cx, py + 164, 18, game.newBest ? '#e09a00' : '#5b6f8f', 'center', false);
  text(`キャッチ ${game.catches}/${THROWS}   ノーバウンド ${game.airCatches}   最長 ${game.longest.toFixed(1)}m`, cx, py + 200, 16, '#25324a', 'center', false);
  const s = game.score;
  const msg = s >= 450 ? '最高のパートナーだワン！' : s >= 300 ? 'すごいワン！もう一回！' : s >= 150 ? 'いい感じだワン！' : 'もっと遊びたいワン！';
  text(`🐾 ${msg}`, cx, py + 244, 22, '#25324a', 'center', false);
  if (game.modeTime > 0.8 && Math.sin(game.time * 4) > -0.4) text('クリック / タップでもう一度', cx, py + 292, 18, '#5b6f8f', 'center', false);
  ctx.globalAlpha = 1;
}

let scale = 1;

function render() {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawBackground();
  drawMarkers();
  drawZone();
  drawOwner();
  drawDog();
  drawBall();
  drawAim();
  drawEffects();
  if (game.mode === 'title') drawTitle();
  else {
    drawHUD();
    if (game.mode === 'gameover') drawGameOver();
  }
  drawSoundButton();
}

// ---------------------------------------------------------------
// 入力
// ---------------------------------------------------------------
function toGame(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  initAudio();
  const p = toGame(e);
  const b = SOUND_BTN;
  if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) { soundOn = !soundOn; return; }
  if (game.mode === 'title') { startGame(); return; }
  if (game.mode === 'gameover') { if (game.modeTime > 0.8) startGame(); return; }
  if (game.mode === 'aim') {
    drag = { sx: p.x, sy: p.y, x: p.x, y: p.y };
    game.hintTime = 0;
    canvas.classList.add('dragging');
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 古いブラウザ向け */ }
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = toGame(e);
  drag.x = p.x; drag.y = p.y;
});

function endDrag() { if (drag && game.mode === 'aim') releaseThrow(); drag = null; canvas.classList.remove('dragging'); }
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', () => { drag = null; canvas.classList.remove('dragging'); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
// iOS Safari は指を離したタイミングでないと音を有効化できないことがある
window.addEventListener('touchend', initAudio, { passive: true });
window.addEventListener('pointerup', initAudio);
window.addEventListener('click', initAudio);
// iOS でのダブルタップ拡大・ピンチ拡大を防ぐ
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
// 画面の向きを変えたとき、レイアウト確定後にサイズを取り直す
window.addEventListener('orientationchange', () => setTimeout(resize, 300));

// ---------------------------------------------------------------
// メインループ
// ---------------------------------------------------------------
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(r.width * dpr));
  canvas.height = Math.max(1, Math.round(r.width * dpr * H / W));
  scale = canvas.width / W;
}
window.addEventListener('resize', resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
resize();

let last = performance.now(), acc = 0;
function frame(now) {
  acc += Math.min(0.05, (now - last) / 1000);
  last = now;
  while (acc >= STEP) { update(); acc -= STEP; }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// デバッグ・動作確認用
window.__game = { game, ball, dog, startGame, throwBall(vx, vy) {
  if (game.mode !== 'aim') return false;
  drag = { sx: 0, sy: 0, x: -vx / PULL_TO_V, y: -vy / PULL_TO_V };
  releaseThrow();
  return true;
} };
})();

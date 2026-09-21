// うちの子の写真登録
// 写真を選んで顔の位置を調整し、丸く切り抜いた画像をこの端末 (localStorage) にだけ保存する
(() => {
'use strict';

const KEY = 'poodle-catch-photo';
const OUT = 256;          // 保存する顔画像の一辺 (px)
const MAX_SRC = 1400;     // 編集用に縮小する元画像の最大辺
const MAX_ZOOM = 6;       // 最小倍率に対する最大拡大率
const TAU = Math.PI * 2;

const api = { image: null, openEditor };
window.DogPhoto = api;

const $ = (id) => document.getElementById(id);
const fileInput = $('photo-file');
const addBtn = $('photo-add');
const delBtn = $('photo-del');
const thumb = $('photo-thumb');
const editor = $('editor');
const edCanvas = $('ed-canvas');
const edZoom = $('ed-zoom');
const ectx = edCanvas.getContext('2d');

// ---------------------------------------------------------------
// 保存・読み込み
// ---------------------------------------------------------------
function syncUI() {
  const has = !!api.image;
  thumb.hidden = !has;
  delBtn.hidden = !has;
  if (has) thumb.src = api.image.src;
  addBtn.textContent = has ? '📷 写真を変更' : '📷 うちの子の写真を登録';
}

function setPhoto(dataUrl) {
  const img = new Image();
  img.onload = () => { api.image = img; syncUI(); };
  img.src = dataUrl;
}

function clearPhoto() {
  api.image = null;
  try { localStorage.removeItem(KEY); } catch (e) { /* 何もしない */ }
  syncUI();
}

try {
  const saved = localStorage.getItem(KEY);
  if (saved) setPhoto(saved);
} catch (e) { /* 保存領域が使えなくても遊べる */ }
syncUI();

// ---------------------------------------------------------------
// 写真の選択
// ---------------------------------------------------------------
addBtn.addEventListener('click', () => { fileInput.value = ''; fileInput.click(); });
delBtn.addEventListener('click', () => { if (confirm('登録した写真を削除して、プードルに戻しますか？')) clearPhoto(); });

fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  openEditor(url, () => URL.revokeObjectURL(url));
});

// ---------------------------------------------------------------
// 顔の位置合わせエディタ
// ---------------------------------------------------------------
let ed = null;   // {src, w, h, cx, cy, zoom, minZoom, size, R}

function openEditor(url, onLoaded) {
  const img = new Image();
  img.onload = () => {
    // 大きな写真は編集しやすいサイズに縮小しておく
    const k = Math.min(1, MAX_SRC / Math.max(img.naturalWidth, img.naturalHeight));
    const src = document.createElement('canvas');
    src.width = Math.max(1, Math.round(img.naturalWidth * k));
    src.height = Math.max(1, Math.round(img.naturalHeight * k));
    src.getContext('2d').drawImage(img, 0, 0, src.width, src.height);
    if (onLoaded) onLoaded();
    ed = { src, w: src.width, h: src.height, cx: src.width / 2, cy: src.height / 2, zoom: 1, minZoom: 1, size: 0, R: 0 };
    editor.hidden = false;
    layoutEditor(true);
  };
  img.onerror = () => { if (onLoaded) onLoaded(); alert('この画像は読み込めませんでした。別の写真を選んでください。'); };
  img.src = url;
}

function layoutEditor(reset) {
  if (!ed) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = edCanvas.clientWidth;
  edCanvas.width = edCanvas.height = Math.round(size * dpr);
  const ratio = ed.size ? size / ed.size : 1;
  ed.size = size;
  ed.R = size * 0.42;
  ed.minZoom = ed.R * 2 / Math.min(ed.w, ed.h);
  ed.zoom = reset ? ed.minZoom * 1.4 : ed.zoom * ratio;
  clampEditor();
  renderEditor();
}

function clampEditor() {
  ed.zoom = Math.max(ed.minZoom, Math.min(ed.minZoom * MAX_ZOOM, ed.zoom));
  const r = ed.R / ed.zoom;   // 丸枠の半径 (画像座標)
  ed.cx = Math.max(r, Math.min(ed.w - r, ed.cx));
  ed.cy = Math.max(r, Math.min(ed.h - r, ed.cy));
  edZoom.value = Math.log(ed.zoom / ed.minZoom) / Math.log(MAX_ZOOM);
}

function renderEditor() {
  const s = ed.size, z = ed.zoom, d = edCanvas.width / s;
  ectx.setTransform(d, 0, 0, d, 0, 0);
  ectx.fillStyle = '#111';
  ectx.fillRect(0, 0, s, s);
  ectx.drawImage(ed.src, s / 2 - ed.cx * z, s / 2 - ed.cy * z, ed.w * z, ed.h * z);
  // 丸枠の外を暗くする
  ectx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ectx.beginPath();
  ectx.rect(0, 0, s, s);
  ectx.arc(s / 2, s / 2, ed.R, 0, TAU, true);
  ectx.fill('evenodd');
  ectx.strokeStyle = '#fff';
  ectx.lineWidth = 3;
  ectx.setLineDash([8, 6]);
  ectx.beginPath(); ectx.arc(s / 2, s / 2, ed.R, 0, TAU); ectx.stroke();
  ectx.setLineDash([]);
}

function zoomBy(f) {
  ed.zoom *= f;
  clampEditor();
  renderEditor();
}

// ドラッグで移動、2本指でピンチ拡大
const pts = new Map();
const pinchDist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };

edCanvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { edCanvas.setPointerCapture(e.pointerId); } catch (err) { /* 古いブラウザ向け */ }
});
edCanvas.addEventListener('pointermove', (e) => {
  const p = pts.get(e.pointerId);
  if (!p || !ed) return;
  const before = pts.size === 2 ? pinchDist() : 0;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  // 2本指のときは1本あたり半分ずつ動かす
  const k = pts.size === 2 ? 0.5 : 1;
  ed.cx -= dx * k / ed.zoom;
  ed.cy -= dy * k / ed.zoom;
  if (before > 0) ed.zoom *= pinchDist() / before;
  clampEditor();
  renderEditor();
});
const endPointer = (e) => pts.delete(e.pointerId);
edCanvas.addEventListener('pointerup', endPointer);
edCanvas.addEventListener('pointercancel', endPointer);
edCanvas.addEventListener('wheel', (e) => { e.preventDefault(); if (ed) zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });

edZoom.addEventListener('input', () => {
  if (!ed) return;
  ed.zoom = ed.minZoom * Math.pow(MAX_ZOOM, +edZoom.value);
  clampEditor();
  renderEditor();
});

function closeEditor() { editor.hidden = true; ed = null; pts.clear(); }

$('ed-cancel').addEventListener('click', closeEditor);
$('ed-ok').addEventListener('click', () => {
  if (!ed) return;
  // 丸枠の中を OUT×OUT の正方形に書き出す (描画時に丸く切り抜く)
  const out = document.createElement('canvas');
  out.width = out.height = OUT;
  const k = OUT / (ed.R * 2) * ed.zoom;
  const octx = out.getContext('2d');
  octx.fillStyle = '#17171b';
  octx.fillRect(0, 0, OUT, OUT);
  octx.drawImage(ed.src, OUT / 2 - ed.cx * k, OUT / 2 - ed.cy * k, ed.w * k, ed.h * k);
  const dataUrl = out.toDataURL('image/jpeg', 0.88);
  try { localStorage.setItem(KEY, dataUrl); } catch (e) { alert('写真を保存できませんでした。今回だけこの写真で遊べます。'); }
  setPhoto(dataUrl);
  closeEditor();
});

window.addEventListener('resize', () => { if (ed) layoutEditor(false); });
window.addEventListener('orientationchange', () => setTimeout(() => { if (ed) layoutEditor(false); }, 300));
})();

import './polyfills.js';
import './style.css';
import { detect, humanSize } from './format.js';
import { ViewerError } from './errors.js';
import { listenNativeOpen } from './native.js';

const $ = (id) => document.getElementById(id);
const els = {
  bar: $('bar'), fname: $('fname'), fmeta: $('fmeta'), actions: $('actions'),
  empty: $('empty'), loading: $('loading'), loadingText: $('loading-text'),
  error: $('error'), errorText: $('error-text'), viewer: $('viewer'), picker: $('picker'),
};

// 형식별 뷰어는 필요할 때만 불러온다 (앱 시작을 빠르게)
const LOADERS = {
  pdf: () => import('./viewers/pdf.js'),
  hwp: () => import('./viewers/hwp.js'),
  hwpx: () => import('./viewers/hwp.js'),
  docx: () => import('./viewers/docx.js'),
  xlsx: () => import('./viewers/xlsx.js'),
  pptx: () => import('./viewers/pptx.js'),
};

let current = null;
let token = 0;

function show(which) {
  for (const k of ['empty', 'loading', 'error', 'viewer']) els[k].hidden = k !== which;
}

function setActions(list = []) {
  els.actions.replaceChildren(
    ...list.map((a) => {
      const b = document.createElement('button');
      b.className = 'btn';
      b.type = 'button';
      b.textContent = a.label;
      b.addEventListener('click', a.onClick);
      return b;
    })
  );
}

function showError(e) {
  console.warn(e);
  els.errorText.textContent =
    e instanceof ViewerError ? e.message : '파일을 여는 중 문제가 생겼어요. 파일이 손상됐을 수 있어요.';
  show('error');
}

async function openDocument({ name, size, getBuffer }) {
  const my = ++token;
  const t0 = performance.now();
  try {
    current?.destroy();
  } catch { /* ignore */ }
  current = null;
  els.viewer.replaceChildren();
  setActions([]);
  els.bar.hidden = false;
  els.fname.textContent = name;
  els.fmeta.textContent = '여는 중…';
  els.loadingText.textContent = '여는 중…';
  show('loading');
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  try {
    const buffer = await getBuffer();
    if (my !== token) return;
    const fmt = await detect(name, buffer);
    els.fmeta.textContent = `${fmt.label} · ${humanSize(size ?? buffer.byteLength)}`;
    const mod = await LOADERS[fmt.kind]();
    if (my !== token) return;
    els.viewer.hidden = false; // 크기 계산이 필요한 뷰어를 위해 먼저 보이게
    els.loading.hidden = true;
    const view = await mod.open(els.viewer, buffer, { name, kind: fmt.kind, setActions });
    if (my !== token) {
      view.destroy();
      return;
    }
    current = view;
    show('viewer');
    window.__perf = Object.assign(window.__perf || {}, { openMs: Math.round(performance.now() - t0), kind: fmt.kind });
    reportOpened(my, fmt.kind, t0);
  } catch (e) {
    if (my !== token) return;
    els.viewer.replaceChildren();
    els.fmeta.textContent = '열 수 없음';
    showError(e);
  }
}

// 열린 결과를 로그로 남긴다(adb logcat 시험용). 디버그 빌드에서만 보이고, 릴리스 앱에서는 출력되지 않는다.
async function reportOpened(my, kind, t0) {
  for (let i = 0; i < 20 && my === token; i++) {
    const text = els.viewer.innerText || '';
    if (text.trim() || i === 19) {
      console.info('munseo:opened ' + JSON.stringify({ kind, ms: Math.round(performance.now() - t0), chars: text.length, head: text.trim().slice(0, 40) }));
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

function pickFile() {
  els.picker.value = '';
  els.picker.click();
}
els.picker.addEventListener('change', () => {
  const f = els.picker.files && els.picker.files[0];
  if (f) openDocument({ name: f.name, size: f.size, getBuffer: () => f.arrayBuffer() });
});
for (const id of ['btn-open', 'btn-open-top', 'btn-open-err']) $(id).addEventListener('click', pickFile);

// 다른 앱(파일 앱 등)에서 탭해서 열린 파일: 앱이 꺼져 있을 때도, 켜져 있을 때도 들어온다
listenNativeOpen(openDocument);

window.__app = { openDocument };

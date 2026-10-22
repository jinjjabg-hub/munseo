import './polyfills.js';
import './style.css';
import { detect, humanSize } from './format.js';
import { ViewerError } from './errors.js';
import { FileOpen, isNative, listenNativeOpen, pickNative, printToPdf, saveToDocuments, sharePath, shareOriginal } from './native.js';

const $ = (id) => document.getElementById(id);
const els = {
  bar: $('bar'), fname: $('fname'), fmeta: $('fmeta'), actions: $('actions'), tools: $('tools'),
  empty: $('empty'), loading: $('loading'), loadingText: $('loading-text'),
  error: $('error'), errorText: $('error-text'), viewer: $('viewer'), picker: $('picker'),
  btnSearch: $('btn-search'), btnSave: $('btn-save'), btnShare: $('btn-share'),
  findbar: $('findbar'), findInput: $('find-input'), findCount: $('find-count'),
  msg: $('msg'), msgText: $('msg-text'), printRoot: $('print-root'),
};

// 형식별 뷰어는 필요할 때만 불러온다 (앱 시작을 빠르게)
const LOADERS = {
  pdf: () => import('./viewers/pdf.js'),
  hwp: () => import('./viewers/flow.js'),
  hwpx: () => import('./viewers/flow.js'),
  doc: () => import('./viewers/flow.js'),
  ppt: () => import('./viewers/flow.js'),
  rtf: () => import('./viewers/flow.js'),
  odf: () => import('./viewers/flow.js'),
  text: () => import('./viewers/text.js'),
  image: () => import('./viewers/image.js'),
  docx: () => import('./viewers/docx.js'),
  xlsx: () => import('./viewers/xlsx.js'),
  pptx: () => import('./viewers/pptx.js'),
};

let current = null; // 지금 열린 뷰어
let currentDoc = null; // { name, kind, path }
let token = 0;

function show(which) {
  for (const k of ['empty', 'loading', 'error', 'viewer']) els[k].hidden = k !== which;
}

function setActions(list = []) {
  if (current) els.tools.hidden = els.btnSearch.hidden && els.btnSave.hidden && els.btnShare.hidden && !list.length;
  els.actions.replaceChildren(
    ...list.map((a) => {
      const b = document.createElement('button');
      b.className = 'btn tool';
      b.type = 'button';
      b.textContent = a.label;
      b.addEventListener('click', a.onClick);
      return b;
    })
  );
}

function showMsg(text, isErr = false) {
  els.msgText.textContent = text;
  els.msg.classList.toggle('err', isErr);
  els.msg.hidden = false;
}
const hideMsg = () => { els.msg.hidden = true; };
$('msg-close').addEventListener('click', hideMsg);

function showError(e) {
  console.warn(e);
  els.errorText.textContent =
    e instanceof ViewerError ? e.message : '파일을 여는 중 문제가 생겼어요. 파일이 손상됐을 수 있어요.';
  show('error');
}

// ---------------- 문서 열기 ----------------
async function openDocument({ name, size, path, getBuffer }) {
  const my = ++token;
  const t0 = performance.now();
  try {
    current?.destroy();
  } catch { /* ignore */ }
  current = null;
  currentDoc = null;
  closeFind();
  hideMsg();
  els.viewer.replaceChildren();
  els.printRoot.replaceChildren();
  setActions([]);
  els.tools.hidden = true;
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
    currentDoc = { name, kind: fmt.kind, path };
    updateTools(fmt);
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

// 형식에 맞는 도구만 보여준다: 검색 / (PDF가 아니면) PDF로 저장 / (PDF면) 공유
function updateTools(fmt) {
  els.btnSearch.hidden = !current.search;
  els.btnSave.hidden = !current.printable;
  els.btnShare.hidden = !(fmt.kind === 'pdf' && isNative && currentDoc.path);
  const any = !els.btnSearch.hidden || !els.btnSave.hidden || !els.btnShare.hidden || els.actions.children.length > 0;
  els.tools.hidden = !any;
}
// 뷰어가 도구 버튼(워드의 읽기 모드 등)을 나중에 바꿀 수 있다

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

// ---------------- 파일 고르기 ----------------
function pickFile() {
  if (isNative) {
    pickNative().catch((e) => showMsg('파일 선택을 열 수 없어요: ' + (e && e.message ? e.message : e), true));
    return;
  }
  els.picker.value = '';
  els.picker.click();
}
els.picker.addEventListener('change', () => {
  const f = els.picker.files && els.picker.files[0];
  if (f) openDocument({ name: f.name, size: f.size, getBuffer: () => f.arrayBuffer() });
});
for (const id of ['btn-open', 'btn-open-top', 'btn-open-err']) $(id).addEventListener('click', pickFile);

// ---------------- 검색 ----------------
let findTimer = 0;
function openFind() {
  if (!current || !current.search) return;
  els.findbar.hidden = false;
  els.findInput.focus();
  els.findInput.select();
}
function closeFind() {
  clearTimeout(findTimer);
  if (!els.findbar.hidden) els.findbar.hidden = true;
  els.findInput.value = '';
  els.findCount.textContent = '';
  current?.search?.clear();
}
const showCount = (r) => {
  els.findCount.textContent = r.count ? `${r.index + 1} / ${r.count}` : '결과 없음';
  return r;
};
async function runFind() {
  if (!current || !current.search) return { count: 0, index: -1 };
  const q = els.findInput.value;
  if (!q.trim()) {
    await current.search.clear();
    els.findCount.textContent = '';
    return { count: 0, index: -1 };
  }
  els.findCount.textContent = '찾는 중…';
  return showCount(await current.search.find(q));
}
const step = async (dir) => {
  if (!current || !current.search || !els.findInput.value.trim()) return { count: 0, index: -1 };
  return showCount(await current.search[dir]());
};
els.btnSearch.addEventListener('click', () => (els.findbar.hidden ? openFind() : closeFind()));
els.findInput.addEventListener('input', () => { clearTimeout(findTimer); findTimer = setTimeout(runFind, 350); });
els.findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); clearTimeout(findTimer); els.findInput.blur(); if (els.findCount.textContent && els.findCount.textContent !== '찾는 중…') step(e.shiftKey ? 'prev' : 'next'); else runFind(); }
  if (e.key === 'Escape') closeFind();
});
$('find-next').addEventListener('click', () => step('next'));
$('find-prev').addEventListener('click', () => step('prev'));
$('find-close').addEventListener('click', closeFind);

// ---------------- PDF로 저장 / 공유 ----------------
const settle = async (root) => {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await Promise.all([...root.querySelectorAll('img')].map((i) => (i.decode ? i.decode().catch(() => {}) : Promise.resolve())));
};
const safeBase = (name) => (name.replace(/\.[^.\\/]+$/, '').replace(/[\\/:*?"<>|\r\n]+/g, '_').trim() || '문서').slice(0, 80);

let saving = false;
async function savePdf({ share = true } = {}) {
  if (!current || !current.print || saving) return null;
  saving = true;
  els.btnSave.disabled = true;
  showMsg('PDF로 만드는 중이에요…');
  try {
    const { node, orientation, note } = await current.print();
    els.printRoot.replaceChildren(node);
    await settle(els.printRoot);
    const base = safeBase(currentDoc.name);
    if (!isNative) {
      window.print(); // 브라우저(시험용): 인쇄 창에서 PDF로 저장
      hideMsg();
      return { location: '(브라우저 인쇄)' };
    }
    const out = await printToPdf(base, orientation === 'landscape');
    const saved = await saveToDocuments(out.path, base + '.pdf');
    showMsg(`저장했어요: ${saved.location}` + (note ? ` (${note})` : ''));
    if (share) {
      try { await sharePath(out.path, base); } catch { /* 공유 창을 닫은 경우 */ }
    }
    return { ...saved, pages: out.pages, path: out.path };
  } catch (e) {
    console.warn(e);
    showMsg('PDF로 저장하지 못했어요. ' + (e && e.message ? e.message : ''), true);
    return null;
  } finally {
    els.printRoot.replaceChildren();
    els.btnSave.disabled = false;
    saving = false;
  }
}
async function sharePdf() {
  if (!currentDoc || !currentDoc.path) return;
  try {
    await shareOriginal(currentDoc.path, currentDoc.name);
  } catch (e) {
    showMsg('공유하지 못했어요. ' + (e && e.message ? e.message : ''), true);
  }
}
els.btnSave.addEventListener('click', () => savePdf());
els.btnShare.addEventListener('click', sharePdf);

// 다른 앱(파일 앱 등)에서 탭해서 열린 파일: 앱이 꺼져 있을 때도, 켜져 있을 때도 들어온다
listenNativeOpen(openDocument);

// 시험·진단용 손잡이
window.__app = {
  fileOpen: FileOpen,
  openDocument,
  search: async (q) => { openFind(); els.findInput.value = q; return runFind(); },
  next: () => step('next'),
  prev: () => step('prev'),
  savePdf,
  sharePdf,
  // 시험용: 인쇄용 내용을 만들어 화면 밖 print-root에 올려 둔다 (브라우저 PDF 출력으로 확인)
  preparePrint: async () => {
    const { node, orientation } = await current.print();
    els.printRoot.replaceChildren(node);
    await settle(els.printRoot);
    return orientation;
  },
  state: () => ({ doc: currentDoc, canSearch: !!(current && current.search), canSave: !!(current && current.printable) }),
};

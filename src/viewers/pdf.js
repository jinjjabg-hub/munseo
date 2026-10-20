// PDF: 보이는 쪽만 그린다(스크롤하면 불러오고, 멀어지면 비운다). 글자 선택 가능.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
// 워커를 .js 파일로 묶어 쓴다 (안드로이드 내부 서버가 .mjs를 자바스크립트로 인식하지 못할 수 있음)
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker';
import 'pdfjs-dist/legacy/web/pdf_viewer.css';
import { encrypted, corrupt, ViewerError } from '../errors.js';
import { attachPinch } from '../zoom.js';

pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();

const GAP = 8; // 쪽 사이 간격(px)
const SIDE = 8; // 좌우 여백(px)
const MAX_PIXELS = 12e6; // 한 쪽 캔버스 최대 픽셀(메모리 보호)

export async function open(container, buffer, ctx = {}) {
  const t0 = performance.now();
  const data = new Uint8Array(buffer);
  const base = import.meta.env.BASE_URL || './';
  const task = pdfjs.getDocument({
    data,
    cMapUrl: base + 'pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: base + 'pdfjs/standard_fonts/',
    wasmUrl: base + 'pdfjs/wasm/',
    iccUrl: base + 'pdfjs/iccs/',
    isEvalSupported: false,
    enableXfa: false,
  });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (e) {
    if (e && e.name === 'PasswordException') throw encrypted('암호가 걸린 PDF예요. 암호를 푼 파일로 다시 열어주세요.');
    if (e && (e.name === 'InvalidPDFException' || e.name === 'MissingPDFException' || e.name === 'FormatError'))
      throw corrupt('PDF 파일이 손상됐거나 읽을 수 없어요.');
    if (e instanceof ViewerError) throw e;
    throw corrupt('PDF를 읽는 중 문제가 생겼어요.');
  }

  const scroller = document.createElement('div');
  scroller.className = 'scroller';
  scroller.tabIndex = 0;
  const pagesEl = document.createElement('div');
  pagesEl.className = 'pdf-pages';
  scroller.appendChild(pagesEl);
  const indicator = document.createElement('div');
  indicator.className = 'pdf-indicator';
  container.append(scroller, indicator);

  const N = pdf.numPages;
  const first = await pdf.getPage(1);
  const base1 = first.getViewport({ scale: 1 });
  // 쪽별 원래 크기(1배율). 처음엔 1쪽 크기로 가정하고, 백그라운드에서 실제 크기로 고친다.
  const sizes = new Array(N + 1).fill(null);
  sizes[1] = { w: base1.width, h: base1.height };
  const defaultSize = () => sizes[1];

  let zoom = 1; // 폭 맞춤 기준 배율(사용자 확대)
  const fitScale = () => Math.max(0.1, (scroller.clientWidth - SIDE * 2) / base1.width);
  const scaleNow = () => fitScale() * zoom;

  const pageEls = [null];
  const states = [null]; // {renderedScale, task, textLayer}
  for (let n = 1; n <= N; n++) {
    const el = document.createElement('div');
    el.className = 'pdf-page';
    el.dataset.n = String(n);
    pagesEl.appendChild(el);
    pageEls.push(el);
    states.push({ scale: 0, task: null, busy: false, textDiv: null, canvas: null });
  }

  function layoutAll() {
    const s = scaleNow();
    for (let n = 1; n <= N; n++) {
      const sz = sizes[n] || defaultSize();
      pageEls[n].style.width = sz.w * s + 'px';
      pageEls[n].style.height = sz.h * s + 'px';
    }
  }

  let firstPaintMs = null;
  async function renderPage(n) {
    const st = states[n];
    const s = scaleNow();
    if (st.busy || Math.abs(st.scale - s) < 1e-4) return;
    st.busy = true;
    try {
      const page = n === 1 ? first : await pdf.getPage(n);
      const vp0 = page.getViewport({ scale: 1 });
      if (!sizes[n] || Math.abs(sizes[n].w - vp0.width) > 0.5 || Math.abs(sizes[n].h - vp0.height) > 0.5) {
        sizes[n] = { w: vp0.width, h: vp0.height };
        layoutAll();
      }
      const viewport = page.getViewport({ scale: scaleNow() });
      let dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (viewport.width * viewport.height * dpr * dpr > MAX_PIXELS) dpr = Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height));

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
      canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
      const renderTask = page.render({
        canvasContext: canvas.getContext('2d', { alpha: false }),
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
        background: '#ffffff',
      });
      st.task = renderTask;
      await renderTask.promise;

      // 글자 선택·검색용 투명 글자층
      const textDiv = document.createElement('div');
      textDiv.className = 'textLayer';
      textDiv.style.setProperty('--total-scale-factor', String(viewport.scale));
      textDiv.style.width = viewport.width + 'px';
      textDiv.style.height = viewport.height + 'px';
      const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport });
      tl.render().catch(() => {});

      clearPage(n);
      const el = pageEls[n];
      el.append(canvas, textDiv);
      st.canvas = canvas;
      st.textDiv = textDiv;
      st.scale = s;
      if (firstPaintMs == null) {
        firstPaintMs = performance.now() - t0;
        window.__perf = Object.assign(window.__perf || {}, { pdfFirstPaintMs: Math.round(firstPaintMs), pdfPages: N });
      }
    } catch (e) {
      if (!(e && e.name === 'RenderingCancelledException')) console.warn('page', n, e);
    } finally {
      st.busy = false;
      st.task = null;
    }
  }

  function clearPage(n) {
    const st = states[n];
    if (st.task) { try { st.task.cancel(); } catch { /* ignore */ } }
    const el = pageEls[n];
    if (st.canvas) { st.canvas.width = 0; st.canvas.height = 0; }
    el.replaceChildren();
    st.canvas = null;
    st.textDiv = null;
    st.scale = 0;
  }

  const visible = new Set();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const n = +e.target.dataset.n;
        if (e.isIntersecting) { visible.add(n); renderPage(n); }
        else { visible.delete(n); if (states[n].scale) clearPage(n); }
      }
    },
    { root: scroller, rootMargin: '100% 0px 100% 0px' }
  );
  const observeAll = () => { for (let n = 1; n <= N; n++) io.observe(pageEls[n]); };

  layoutAll();
  observeAll();

  // 쪽 번호 표시(스크롤 중 잠깐)
  let hideT = 0;
  const updateIndicator = () => {
    const mid = scroller.scrollTop + scroller.clientHeight / 3;
    let cur = 1;
    for (let n = 1; n <= N; n++) if (pageEls[n].offsetTop <= mid) cur = n; else break;
    indicator.textContent = `${cur} / ${N}`;
    indicator.style.opacity = '1';
    clearTimeout(hideT);
    hideT = setTimeout(() => (indicator.style.opacity = '0'), 1200);
  };
  scroller.addEventListener('scroll', updateIndicator, { passive: true });
  indicator.style.opacity = '0';

  // 나머지 쪽 크기를 백그라운드에서 알아낸다 (쪽 크기가 제각각인 PDF 대비)
  let alive = true;
  (async () => {
    for (let n = 2; n <= N && alive; n++) {
      try {
        const pg = await pdf.getPage(n);
        const v = pg.getViewport({ scale: 1 });
        if (!sizes[n] || Math.abs(sizes[n].w - v.width) > 0.5 || Math.abs(sizes[n].h - v.height) > 0.5) {
          const oldH = pageEls[n].offsetHeight;
          sizes[n] = { w: v.width, h: v.height };
          const s = scaleNow();
          pageEls[n].style.width = v.width * s + 'px';
          pageEls[n].style.height = v.height * s + 'px';
          // 보고 있는 위치보다 위쪽 쪽이 바뀌면 화면이 밀리지 않게 보정
          if (pageEls[n].offsetTop + oldH <= scroller.scrollTop) scroller.scrollTop += v.height * s - oldH;
        } else sizes[n] = sizes[n] || { w: v.width, h: v.height };
        pg.cleanup();
      } catch { /* 이 쪽은 건너뜀 */ }
      if (n % 10 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  })();

  // 확대/축소: 제스처 중엔 transform, 끝나면 선명하게 다시 그린다
  let rerenderT = 0;
  function setZoom(next, m) {
    const rect = scroller.getBoundingClientRect();
    const my = m ? m.y - rect.top : scroller.clientHeight / 2;
    const mx = m ? m.x - rect.left : scroller.clientWidth / 2;
    const oldS = scaleNow();
    const fy = (scroller.scrollTop + my) / oldS;
    const fx = (scroller.scrollLeft + mx) / oldS;
    zoom = next;
    layoutAll();
    const newS = scaleNow();
    scroller.scrollTop = fy * newS - my;
    scroller.scrollLeft = fx * newS - mx;
    clearTimeout(rerenderT);
    rerenderT = setTimeout(() => visible.forEach((n) => renderPage(n)), 120);
  }
  const detachPinch = attachPinch(scroller, {
    min: 0.5, max: 5,
    get: () => zoom,
    preview: (k, m) => {
      const r = scroller.getBoundingClientRect();
      pagesEl.style.transformOrigin = `${scroller.scrollLeft + m.x - r.left}px ${scroller.scrollTop + m.y - r.top}px`;
      pagesEl.style.transform = `scale(${k})`;
    },
    commit: (next, m) => {
      pagesEl.style.transform = '';
      pagesEl.style.transformOrigin = '';
      setZoom(next, m);
    },
  });

  let lastW = scroller.clientWidth;
  const onResize = () => {
    if (scroller.clientWidth === lastW) return;
    lastW = scroller.clientWidth;
    layoutAll();
    visible.forEach((n) => renderPage(n));
  };
  window.addEventListener('resize', onResize);

  return {
    kind: 'pdf',
    pages: N,
    destroy() {
      alive = false;
      io.disconnect();
      detachPinch();
      window.removeEventListener('resize', onResize);
      for (let n = 1; n <= N; n++) clearPage(n);
      task.destroy();
      container.replaceChildren();
    },
  };
}

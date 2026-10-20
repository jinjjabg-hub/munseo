// 파워포인트(.pptx): pptx-preview로 슬라이드 모양 그대로, 실패하면 글자만.
import JSZip from 'jszip';
import { init } from 'pptx-preview';
import { corrupt } from '../errors.js';
import { makeZoomable } from '../zoom.js';

async function slideSize(buffer) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('ppt/presentation.xml').async('string');
    const m = /<p:sldSz[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(xml);
    if (m) return { w: 960, h: Math.round((960 * +m[2]) / +m[1]) };
  } catch { /* 기본값 */ }
  return { w: 960, h: 540 };
}

// 슬라이드 모양을 못 그릴 때: 슬라이드별 글자만
async function textFallback(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files)
    .map((n) => ({ n, m: /^ppt\/slides\/slide(\d+)\.xml$/.exec(n) }))
    .filter((x) => x.m)
    .sort((a, b) => +a.m[1] - +b.m[1]);
  if (!slides.length) throw new Error('no slides');
  const out = [];
  for (const { n, m } of slides) {
    const xml = await zip.file(n).async('string');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const paras = [];
    for (const p of doc.getElementsByTagNameNS('*', 'p')) {
      const t = Array.from(p.getElementsByTagNameNS('*', 't')).map((x) => x.textContent).join('');
      if (t.trim()) paras.push(t);
    }
    out.push({ no: +m[1], paras });
  }
  return out;
}

export async function open(container, buffer, ctx = {}) {
  const scroller = document.createElement('div');
  scroller.className = 'scroller';
  scroller.tabIndex = 0;
  container.appendChild(scroller);
  let zoomer = null;
  let usedFallback = false;

  try {
    const size = await slideSize(buffer);
    const wrap = document.createElement('div');
    wrap.className = 'slides-wrap';
    const host = document.createElement('div');
    wrap.appendChild(host);
    scroller.appendChild(wrap);
    const previewer = init(host, { width: size.w, height: size.h, mode: 'list' });
    await previewer.preview(buffer);
    if (!host.querySelector('*')) throw new Error('empty');
    zoomer = makeZoomable(scroller, wrap, { fit: true, fixed: true });
  } catch (e) {
    scroller.replaceChildren();
    try {
      const slides = await textFallback(buffer);
      usedFallback = true;
      const doc = document.createElement('article');
      doc.className = 'hw-doc';
      doc.innerHTML = slides
        .map((s) => `<h3>슬라이드 ${s.no}</h3>` + s.paras.map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join(''))
        .join('');
      scroller.appendChild(doc);
      zoomer = makeZoomable(scroller, doc, { fit: false });
    } catch {
      throw corrupt('파워포인트 파일이 손상됐거나 읽을 수 없어요.');
    }
  }
  return {
    kind: 'pptx',
    fallback: usedFallback,
    destroy() {
      zoomer?.destroy();
      container.replaceChildren();
    },
  };
}

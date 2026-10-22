// 텍스트 파일(.txt .md .json .xml .html): 있는 그대로 글자로 보여준다 (html도 실행하지 않고 소스를 그대로)
import { decodeText } from '../format.js';
import { makeZoomable } from '../zoom.js';
import { createDomSearch } from '../search.js';

const CHUNK = 64 * 1024;

export async function open(container, buffer, ctx = {}) {
  const text = decodeText(buffer);
  const scroller = document.createElement('div');
  scroller.className = 'scroller';
  scroller.tabIndex = 0;
  const el = document.createElement('article');
  el.className = 'txt-doc';
  scroller.appendChild(el);
  container.appendChild(scroller);

  // 큰 파일도 멈추지 않게: 첫 조각만 먼저 보여주고 나머지는 틈틈이 이어 붙인다
  const chunks = [];
  for (let i = 0; i < text.length; ) {
    let end = Math.min(text.length, i + CHUNK);
    if (end < text.length) { const nl = text.indexOf('\n', end); end = nl < 0 ? text.length : nl + 1; }
    chunks.push(text.slice(i, end));
    i = end;
  }
  if (!chunks.length) chunks.push('');
  const add = (s) => { const pre = document.createElement('pre'); pre.textContent = s; el.appendChild(pre); };
  add(chunks[0]);
  let loaded = 1;
  let cancelled = false;
  const done = new Promise((resolve) => {
    const step = () => {
      if (cancelled) return resolve();
      const t0 = performance.now();
      while (loaded < chunks.length && performance.now() - t0 < 12) add(chunks[loaded++]);
      if (loaded < chunks.length) setTimeout(step, 0);
      else resolve();
    };
    if (chunks.length > 1) setTimeout(step, 0); else resolve();
  });

  const zoomer = makeZoomable(scroller, el, { fit: false });
  const dom = createDomSearch(el, scroller);
  return {
    kind: 'text',
    search: { ...dom, find: async (q) => { await done; return dom.find(q); } },
    printable: true,
    async print() {
      await done;
      const node = el.cloneNode(true);
      node.style.zoom = '';
      return { node, orientation: 'portrait' };
    },
    destroy() {
      cancelled = true;
      zoomer.destroy();
      container.replaceChildren();
    },
  };
}

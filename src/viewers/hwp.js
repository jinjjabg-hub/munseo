// 한글(.hwp / .hwpx): 글자 중심 보기
import { parseHwp } from '../parsers/hwp.js';
import { parseHwpx } from '../parsers/hwpx.js';
import { blocksToHtml, blocksToText } from '../parsers/docmodel.js';
import { makeZoomable } from '../zoom.js';

export async function open(container, buffer, ctx = {}) {
  const doc = ctx.kind === 'hwpx' ? await parseHwpx(buffer) : parseHwp(buffer);
  const scroller = document.createElement('div');
  scroller.className = 'scroller';
  scroller.tabIndex = 0;
  const el = document.createElement('article');
  el.className = 'hw-doc';
  const hasText = blocksToText(doc.blocks).replace(/\s|\[[^\]]*\]|<[^>]*>|\|/g, '') !== '';
  el.innerHTML = (hasText ? '' : '<p class="hw-obj">이 문서에는 읽을 수 있는 글자가 없어요. (그림이나 도형만 있어요)</p>') + blocksToHtml(doc.blocks);
  scroller.appendChild(el);
  container.appendChild(scroller);
  const zoomer = makeZoomable(scroller, el, { fit: false });
  return {
    kind: doc.format,
    destroy() {
      zoomer.destroy();
      container.replaceChildren();
    },
  };
}

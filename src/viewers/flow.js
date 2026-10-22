// 글자 중심 문서: 한글(hwp·hwpx), 옛 워드(doc), 옛 파워포인트(ppt), RTF, OpenDocument(odt·odp)
import { blocksToHtml, blocksToText } from '../parsers/docmodel.js';
import { makeZoomable } from '../zoom.js';
import { createDomSearch } from '../search.js';

async function parse(kind, buffer) {
  switch (kind) {
    case 'hwp': return (await import('../parsers/hwp.js')).parseHwp(buffer);
    case 'hwpx': return (await import('../parsers/hwpx.js')).parseHwpx(buffer);
    case 'doc': return (await import('../parsers/doc.js')).parseDoc(buffer);
    case 'ppt': return (await import('../parsers/ppt.js')).parsePpt(buffer);
    case 'rtf': return (await import('../parsers/rtf.js')).parseRtf(buffer);
    case 'odf': return (await import('../parsers/odf.js')).parseOdf(buffer);
    default: throw new Error('unknown kind ' + kind);
  }
}

export async function open(container, buffer, ctx = {}) {
  const doc = await parse(ctx.kind, buffer);
  const scroller = document.createElement('div');
  scroller.className = 'scroller';
  scroller.tabIndex = 0;
  const el = document.createElement('article');
  el.className = 'hw-doc';
  const hasText = blocksToText(doc.blocks).replace(/\s|\[[^\]]*\]|<[^>]*>|\||#/g, '') !== '';
  el.innerHTML =
    (hasText ? '' : '<p class="hw-obj">이 문서에는 읽을 수 있는 글자가 없어요. (그림이나 도형만 있어요)</p>') + blocksToHtml(doc.blocks);
  scroller.appendChild(el);
  container.appendChild(scroller);
  const zoomer = makeZoomable(scroller, el, { fit: false });
  const search = createDomSearch(el, scroller);
  return {
    kind: doc.format,
    search,
    printable: true,
    async print() {
      const node = el.cloneNode(true);
      node.style.zoom = '';
      return { node, orientation: 'portrait' };
    },
    destroy() {
      zoomer.destroy();
      container.replaceChildren();
    },
  };
}

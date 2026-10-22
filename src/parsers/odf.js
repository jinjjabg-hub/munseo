// OpenDocument 문서(.odt 글, .odp 슬라이드) 글자 추출
import JSZip from 'jszip';
import { corrupt, encrypted } from '../errors.js';

const kids = (el) => Array.from(el.children);
const ln = (el) => el.localName;

function inline(el) {
  let s = '';
  for (const n of el.childNodes) {
    if (n.nodeType === 3) s += n.nodeValue;
    else if (n.nodeType === 1) {
      const nm = ln(n);
      if (nm === 'line-break') s += '\n';
      else if (nm === 'tab') s += '\t';
      else if (nm === 's') s += ' '.repeat(+n.getAttribute('text:c') || 1);
      else if (nm === 'note') continue; // 각주 본문은 별도 블록으로
      else s += inline(n);
    }
  }
  return s;
}

function noteBlocks(el, out) {
  for (const n of el.getElementsByTagNameNS('*', 'note-body')) {
    const t = Array.from(n.getElementsByTagNameNS('*', 'p')).map(inline).join('\n');
    if (t.trim()) out.push({ t: 'box', label: '각주', blocks: [{ t: 'p', text: t }] });
  }
}

function blocksOf(parent) {
  const out = [];
  for (const c of kids(parent)) {
    const nm = ln(c);
    if (nm === 'p') {
      out.push({ t: 'p', text: inline(c) });
      noteBlocks(c, out);
    } else if (nm === 'h') out.push({ t: 'h', text: inline(c) });
    else if (nm === 'list' || nm === 'list-item' || nm === 'list-header' || nm === 'section' || nm === 'frame' || nm === 'text-box' || nm === 'custom-shape' || nm === 'g' || nm === 'a') {
      out.push(...blocksOf(c));
    } else if (nm === 'table') out.push(tableOf(c));
  }
  return out;
}

function tableOf(tbl) {
  const cells = [];
  let r = 0;
  let cols = 0;
  const rowsEls = [];
  const collect = (el) => {
    for (const c of kids(el)) {
      if (ln(c) === 'table-row') rowsEls.push(c);
      else if (/^table-(rows|header-rows|row-group)$/.test(ln(c))) collect(c);
    }
  };
  collect(tbl);
  for (const row of rowsEls) {
    let cIdx = 0;
    for (const cell of kids(row)) {
      const nm = ln(cell);
      if (nm !== 'table-cell' && nm !== 'covered-table-cell') continue;
      const rep = +cell.getAttribute('table:number-columns-repeated') || 1;
      if (nm === 'table-cell') {
        const cs = +cell.getAttribute('table:number-columns-spanned') || 1;
        const rs = +cell.getAttribute('table:number-rows-spanned') || 1;
        const blocks = blocksOf(cell);
        if (rep < 50 || blocks.some((b) => b.text)) cells.push({ r, c: cIdx, rs, cs, blocks });
        cols = Math.max(cols, cIdx + cs);
      }
      cIdx += nm === 'table-cell' ? (rep < 50 ? rep : 1) : rep;
    }
    r++;
  }
  return { t: 'table', rows: r, cols, cells };
}

export async function parseOdf(input) {
  let zip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch {
    throw corrupt();
  }
  const manifest = zip.file('META-INF/manifest.xml');
  if (manifest && /encryption-data/i.test(await manifest.async('string')))
    throw encrypted('암호가 걸린 문서예요. 암호를 푼 파일로 다시 열어주세요.');
  const f = zip.file('content.xml');
  if (!f) throw corrupt('OpenDocument 문서가 아니에요.');
  const doc = new DOMParser().parseFromString(await f.async('string'), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw corrupt();
  const body = doc.getElementsByTagNameNS('*', 'body')[0];
  const root = body && body.firstElementChild;
  if (!root) throw corrupt();
  const blocks = [];
  if (ln(root) === 'presentation') {
    let n = 0;
    for (const page of kids(root).filter((e) => ln(e) === 'page')) {
      n++;
      const inner = blocksOf(page);
      if (!inner.length) continue;
      blocks.push({ t: 'h', text: `슬라이드 ${n}` }, ...inner);
    }
  } else blocks.push(...blocksOf(root));
  return { format: ln(root) === 'presentation' ? 'odp' : 'odt', blocks };
}

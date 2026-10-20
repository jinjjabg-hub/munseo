// 한글 .hwpx(OWPML, zip+XML) 읽기 — 글자 중심, 표는 칸 구조까지
import JSZip from 'jszip';
import { corrupt, encrypted } from '../errors.js';
import { footersLast } from './hwp.js';

const kids = (el) => Array.from(el.children);
const lname = (el) => el.localName;

function textOf(t) {
  let s = '';
  for (const n of t.childNodes) {
    if (n.nodeType === 3) s += n.nodeValue;
    else if (n.nodeType === 1) {
      const nm = lname(n);
      if (nm === 'lineBreak') s += '\n';
      else if (nm === 'tab') s += '\t';
      else if (nm === 'nbSpace' || nm === 'fwSpace') s += ' ';
      else if (nm === 'hyphen') s += '-';
      else s += textOf(n);
    }
  }
  return s;
}

function collectParas(el) {
  const out = [];
  for (const c of kids(el)) {
    if (lname(c) === 'p') out.push(...paraBlocks(c));
    else out.push(...collectParas(c));
  }
  return out;
}

const blank = (t) => t.replace(/[\s ]/g, '') === '';

function tableBlock(tbl) {
  const cells = [];
  let rows = +tbl.getAttribute('rowCnt') || 0;
  let cols = +tbl.getAttribute('colCnt') || 0;
  let rIdx = 0;
  for (const tr of kids(tbl).filter((e) => lname(e) === 'tr')) {
    let cIdx = 0;
    for (const tc of kids(tr).filter((e) => lname(e) === 'tc')) {
      const addr = kids(tc).find((e) => lname(e) === 'cellAddr');
      const span = kids(tc).find((e) => lname(e) === 'cellSpan');
      const sub = kids(tc).find((e) => lname(e) === 'subList');
      cells.push({
        r: addr ? +addr.getAttribute('rowAddr') : rIdx,
        c: addr ? +addr.getAttribute('colAddr') : cIdx,
        rs: span ? +span.getAttribute('rowSpan') || 1 : 1,
        cs: span ? +span.getAttribute('colSpan') || 1 : 1,
        blocks: sub ? collectParas(sub) : [],
      });
      cIdx++;
    }
    rIdx++;
  }
  rows = rows || rIdx;
  return { t: 'table', rows, cols, cells };
}

function ctrlBlocks(ctrl) {
  const out = [];
  for (const c of kids(ctrl)) {
    const nm = lname(c);
    const label = nm === 'header' ? '머리말' : nm === 'footer' ? '꼬리말' : nm === 'footNote' ? '각주' : nm === 'endNote' ? '미주' : null;
    if (label) out.push({ t: 'box', label, blocks: collectParas(c) });
  }
  return out;
}

function paraBlocks(p) {
  const blocks = [];
  let text = '';
  const flush = (force) => {
    if (!blank(text) || force) blocks.push({ t: 'p', text });
    text = '';
  };
  for (const run of kids(p).filter((e) => lname(e) === 'run')) {
    for (const c of kids(run)) {
      switch (lname(c)) {
        case 't':
          text += textOf(c);
          break;
        case 'tbl':
          if (!blank(text)) flush(false);
          blocks.push(tableBlock(c));
          break;
        case 'pic':
          if (!blank(text)) flush(false);
          blocks.push({ t: 'obj', label: '그림' });
          break;
        case 'equation': {
          const sc = kids(c).find((e) => lname(e) === 'script');
          if (!blank(text)) flush(false);
          blocks.push({ t: 'obj', label: '수식', text: sc ? sc.textContent : '' });
          break;
        }
        case 'ctrl':
          blocks.push(...ctrlBlocks(c));
          break;
        case 'secPr':
        case 'linesegarray':
          break;
        default: {
          // 도형·글상자 등: 안에 문단이 있으면 보여준다
          const inner = collectParas(c);
          if (inner.some((b) => b.t !== 'p' || !blank(b.text))) {
            if (!blank(text)) flush(false);
            blocks.push({ t: 'box', label: '', blocks: inner });
          }
        }
      }
    }
  }
  flush(blocks.length === 0);
  return blocks;
}

export async function parseHwpx(input) {
  let zip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch {
    throw corrupt();
  }
  const manifest = zip.file('META-INF/manifest.xml');
  if (manifest) {
    const m = await manifest.async('string');
    if (/encryption-data|<[^>]*encrypt/i.test(m)) throw encrypted('암호가 걸린 한글 문서예요. 암호를 푼 파일로 다시 열어주세요.');
  }
  const names = Object.keys(zip.files)
    .map((n) => ({ n, m: /^Contents\/section(\d+)\.xml$/i.exec(n) }))
    .filter((x) => x.m)
    .sort((a, b) => +a.m[1] - +b.m[1]);
  if (!names.length) throw corrupt('한글(hwpx) 본문을 찾지 못했어요.');
  const blocks = [];
  for (const { n } of names) {
    const xml = await zip.file(n).async('string');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw corrupt('한글(hwpx) 본문을 읽지 못했어요.');
    for (const p of kids(doc.documentElement).filter((e) => lname(e) === 'p')) blocks.push(...paraBlocks(p));
  }
  return { format: 'hwpx', blocks: footersLast(blocks) };
}

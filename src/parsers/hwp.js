// 한글 5.x(.hwp) 바이너리 파서 — 글자 중심 (표는 칸 구조까지, 서식·그림은 제외)
//
// 문서 모델(blocks):
//   {t:'p', text}                       문단
//   {t:'table', rows, cols, cells:[{r,c,rs,cs,blocks}]}
//   {t:'box', label, blocks}            머리말/꼬리말/각주/글상자 등
//   {t:'obj', label, text?}             그림·수식
import CFB from 'cfb';
import { inflateRaw, inflate } from 'pako';
import { corrupt, encrypted, ViewerError } from '../errors.js';

const TAG = {
  PARA_HEADER: 0x42,
  PARA_TEXT: 0x43,
  CTRL_HEADER: 0x47,
  LIST_HEADER: 0x48,
  TABLE: 0x4d,
  PICTURE: 0x55,
  EQEDIT: 0x58,
};

const u8of = (x) => (x instanceof Uint8Array ? x : Uint8Array.from(x));

function readRecords(data) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const roots = [];
  const stack = [];
  let p = 0;
  while (p + 4 <= data.length) {
    const h = dv.getUint32(p, true);
    p += 4;
    const tag = h & 0x3ff;
    const level = (h >>> 10) & 0x3ff;
    let size = h >>> 20;
    if (size === 0xfff) {
      if (p + 4 > data.length) break;
      size = dv.getUint32(p, true);
      p += 4;
    }
    if (p + size > data.length) size = data.length - p; // 잘린 파일도 최대한 읽는다
    const node = { tag, level, data: data.subarray(p, p + size), kids: [] };
    p += size;
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    if (stack.length) stack[stack.length - 1].kids.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

// PARA_TEXT: UTF-16LE. 1~31번은 제어문자. 10·13·24~31은 1글자, 나머지는 8글자(16바이트) 차지.
// 확장 컨트롤(표·도형·각주 등, CTRL_HEADER와 짝)은 위치를 {ctrl:n}으로 남겨 순서를 지킨다.
const EXTENDED = new Set([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23]);

export function decodeParaSegments(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = u8.length >> 1;
  const segs = [];
  let out = '';
  let run = [];
  let ctrlNo = 0;
  const flush = () => {
    if (run.length) {
      for (let k = 0; k < run.length; k += 8192) out += String.fromCharCode.apply(null, run.slice(k, k + 8192));
      run = [];
    }
  };
  for (let i = 0; i < n; ) {
    const c = dv.getUint16(i * 2, true);
    if (c >= 32) {
      run.push(c);
      i++;
      continue;
    }
    flush();
    if (c === 10) { out += '\n'; i++; }
    else if (c === 24) { out += '-'; i++; }
    else if (c === 30 || c === 31) { out += ' '; i++; }
    else if (c === 0 || c === 13 || (c >= 25 && c <= 29)) i++;
    else if (c === 9) { out += '\t'; i += 8; }
    else {
      if (EXTENDED.has(c)) {
        segs.push(out);
        out = '';
        segs.push({ ctrl: ctrlNo++ });
      }
      i += 8; // 인라인·확장 컨트롤 자리표시(16바이트)
    }
  }
  flush();
  segs.push(out);
  return segs;
}

export function decodeParaText(u8) {
  return decodeParaSegments(u8).filter((x) => typeof x === 'string').join('');
}

function ctrlId(data) {
  if (data.length < 4) return '';
  return String.fromCharCode(data[3], data[2], data[1], data[0]);
}

function utf16(u8, start, chars) {
  let s = '';
  for (let i = 0; i < chars && start + i * 2 + 1 < u8.length; i++)
    s += String.fromCharCode(u8[start + i * 2] | (u8[start + i * 2 + 1] << 8));
  return s;
}

const blank = (t) => t.replace(/[\s\u00a0]/g, '') === '';

function paraBlocks(node) {
  const textRec = node.kids.find((k) => k.tag === TAG.PARA_TEXT);
  const segs = textRec ? decodeParaSegments(textRec.data) : [''];
  const ctrls = node.kids.filter((k) => k.tag === TAG.CTRL_HEADER);
  const blocks = [];
  let text = '';
  let used = 0;
  const pushText = (force) => {
    if (!blank(text) || force) blocks.push({ t: 'p', text });
    text = '';
  };
  for (const seg of segs) {
    if (typeof seg === 'string') {
      text += seg;
      continue;
    }
    const cb = ctrls[seg.ctrl] ? ctrlToBlocks(ctrls[seg.ctrl]) : [];
    used++;
    if (!cb.length) continue;
    // 표·글상자 앞의 글자는 먼저 내보낸다
    if (!blank(text)) pushText(false);
    blocks.push(...cb);
  }
  // 글자 쪽에 위치 표시가 없는 컨트롤(짝이 안 맞는 경우)도 버리지 않는다
  for (let i = used; i < ctrls.length; i++) blocks.push(...ctrlToBlocks(ctrls[i]));
  pushText(blocks.length === 0);
  return blocks;
}

// 노드 아래 어디든 있는 문단을 순서대로 모은다 (글상자·머리말·각주 등)
function collectParas(node) {
  const out = [];
  for (const k of node.kids) {
    if (k.tag === TAG.PARA_HEADER) out.push(...paraBlocks(k));
    else out.push(...collectParas(k));
  }
  return out;
}

function hasTag(node, tag) {
  return node.kids.some((k) => k.tag === tag || hasTag(k, tag));
}

function ctrlToBlocks(ctrl) {
  const id = ctrlId(ctrl.data);
  switch (id) {
    case 'tbl ':
      return tableBlocks(ctrl);
    case 'gso ': {
      const inner = collectParas(ctrl);
      if (inner.some((b) => b.t !== 'p' || b.text.trim() !== '')) return [{ t: 'box', label: '', blocks: inner }];
      return hasTag(ctrl, TAG.PICTURE) ? [{ t: 'obj', label: '그림' }] : [];
    }
    case 'eqed': {
      const eq = ctrl.kids.find((k) => k.tag === TAG.EQEDIT);
      if (!eq || eq.data.length < 6) return [{ t: 'obj', label: '수식' }];
      const len = eq.data[4] | (eq.data[5] << 8);
      return [{ t: 'obj', label: '수식', text: utf16(eq.data, 6, len) }];
    }
    case 'head':
      return [{ t: 'box', label: '머리말', blocks: collectParas(ctrl) }];
    case 'foot':
      return [{ t: 'box', label: '꼬리말', blocks: collectParas(ctrl) }];
    case 'fn  ':
      return [{ t: 'box', label: '각주', blocks: collectParas(ctrl) }];
    case 'en  ':
      return [{ t: 'box', label: '미주', blocks: collectParas(ctrl) }];
    default:
      return [];
  }
}

function tableBlocks(ctrl) {
  const out = [];
  let tableRec = null;
  let cur = null;
  const cells = [];
  const caption = [];
  for (const k of ctrl.kids) {
    if (k.tag === TAG.TABLE) {
      tableRec = k;
      cur = null;
    } else if (k.tag === TAG.LIST_HEADER) {
      cur = { head: k.data, paras: [] };
      (tableRec ? cells : caption).push(cur);
    } else if (k.tag === TAG.PARA_HEADER) {
      if (cur) cur.paras.push(k);
      else caption.push({ head: null, paras: [k] });
    }
  }
  for (const c of caption) for (const p of c.paras) out.push(...paraBlocks(p));
  if (!tableRec) return out;

  const dv = new DataView(tableRec.data.buffer, tableRec.data.byteOffset, tableRec.data.byteLength);
  const rows = tableRec.data.length >= 8 ? dv.getUint16(4, true) : 0;
  const cols = tableRec.data.length >= 8 ? dv.getUint16(6, true) : 0;

  const parsed = [];
  let ok = rows > 0 && cols > 0 && cells.length > 0;
  for (const c of cells) {
    const h = c.head;
    let cell = null;
    for (const off of [8, 6]) {
      if (h.length < off + 8) continue;
      const hv = new DataView(h.buffer, h.byteOffset, h.byteLength);
      const col = hv.getUint16(off, true);
      const row = hv.getUint16(off + 2, true);
      const cs = hv.getUint16(off + 4, true);
      const rs = hv.getUint16(off + 6, true);
      if (col < cols && row < rows && cs >= 1 && rs >= 1 && col + cs <= cols && row + rs <= rows) {
        cell = { r: row, c: col, rs, cs };
        break;
      }
    }
    if (!cell) { ok = false; break; }
    cell.blocks = c.paras.flatMap(paraBlocks);
    parsed.push(cell);
  }
  if (!ok) {
    // 칸 구조를 못 읽으면 글자 순서대로라도 전부 보여준다 (누락 방지)
    for (const c of cells) for (const p of c.paras) out.push(...paraBlocks(p));
    return out;
  }
  out.push({ t: 'table', rows, cols, cells: parsed });
  return out;
}

function decompress(bytes, compressed) {
  if (!compressed) return bytes;
  try {
    return inflateRaw(bytes);
  } catch {
    return inflate(bytes);
  }
}

// 꼬리말은 첫 문단에 걸려 있어 맨 위에 나오므로 문서 끝으로 보낸다
export function footersLast(blocks) {
  const foot = blocks.filter((b) => b.t === 'box' && b.label === '꼬리말');
  return foot.length ? [...blocks.filter((b) => !foot.includes(b)), ...foot] : blocks;
}

export function parseHwp(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  let cfb;
  try {
    cfb = CFB.read(u8, { type: 'array' });
  } catch {
    throw corrupt();
  }
  const fh = CFB.find(cfb, 'FileHeader');
  if (!fh) throw corrupt('한글 문서 형식이 아니에요.');
  const h = u8of(fh.content);
  const sig = String.fromCharCode(...h.subarray(0, 17));
  if (sig !== 'HWP Document File') throw corrupt('한글 문서 형식이 아니에요.');
  const flags = new DataView(h.buffer, h.byteOffset, h.byteLength).getUint32(36, true);
  if (flags & 0x2) throw encrypted('암호가 걸린 한글 문서예요. 암호를 푼 파일로 다시 열어주세요.');
  if (flags & 0x4) throw encrypted('배포용 한글 문서(복사·편집 제한)라서 아직 열 수 없어요.');
  if (flags & 0x10) throw encrypted('DRM 보안이 걸린 한글 문서예요. 열 수 없어요.');
  const compressed = !!(flags & 0x1);

  const sections = [];
  cfb.FullPaths.forEach((path, i) => {
    const m = /\/BodyText\/Section(\d+)$/.exec(path);
    if (m) sections.push({ n: +m[1], entry: cfb.FileIndex[i] });
  });
  if (!sections.length) throw corrupt('본문을 찾지 못했어요.');
  sections.sort((a, b) => a.n - b.n);

  const blocks = [];
  try {
    for (const s of sections) {
      const data = decompress(u8of(s.entry.content), compressed);
      for (const root of readRecords(data)) {
        if (root.tag === TAG.PARA_HEADER) blocks.push(...paraBlocks(root));
      }
    }
  } catch (e) {
    if (e instanceof ViewerError) throw e;
    throw corrupt('한글 본문을 읽는 중 문제가 생겼어요. 파일이 손상됐을 수 있어요.');
  }
  return { format: 'hwp', blocks: footersLast(blocks) };
}

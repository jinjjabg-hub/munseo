// 옛 파워포인트(.ppt) 글자 추출 — best effort (슬라이드별 글자만)
// PowerPoint Document 스트림의 레코드(8바이트 머리) 중 TextCharsAtom(4000)·TextBytesAtom(4008)을 모은다.
import CFB from 'cfb';
import { corrupt, encrypted } from '../errors.js';

const u8of = (x) => (x instanceof Uint8Array ? x : Uint8Array.from(x));
const RT = {
  DOCUMENT: 1000, SLIDE: 1006, SLIDE_LIST: 4080, SLIDE_PERSIST: 1011,
  TEXT_HEADER: 3999, TEXT_CHARS: 4000, TEXT_BYTES: 4008, CURRENT_USER: 4086,
};

function* walk(data, start, end, depth = 0) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let p = start;
  while (p + 8 <= end) {
    const verInst = dv.getUint16(p, true);
    const type = dv.getUint16(p + 2, true);
    const len = dv.getUint32(p + 4, true);
    const body = p + 8;
    const bodyEnd = Math.min(end, body + len);
    const ver = verInst & 0xf;
    const inst = verInst >> 4;
    yield { type, inst, ver, body, end: bodyEnd, depth };
    if (ver === 0xf) yield* walk(data, body, bodyEnd, depth + 1); // 컨테이너는 안쪽도
    p = bodyEnd;
    if (len === 0 && type === 0) break; // 빈 영역
  }
}

const latin1 = (b) => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };
const cleanText = (s) => s.replace(/\r\n?|\u000b/g, '\n').replace(/\u0000/g, '').replace(/[\u0001-\u0008\u000e-\u001f]/g, '');

export function parsePpt(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  let cfb;
  try {
    cfb = CFB.read(u8, { type: 'array' });
  } catch {
    throw corrupt();
  }
  const st = CFB.find(cfb, 'PowerPoint Document');
  if (!st) throw corrupt('파워포인트(.ppt) 문서가 아니에요.');
  // 암호 걸린 문서: Current User 스트림 머리말이 'Encrypted'(0xF3D1C4DF)
  const cu = CFB.find(cfb, 'Current User');
  if (cu) {
    const c = u8of(cu.content);
    if (c.length >= 16 && new DataView(c.buffer, c.byteOffset, c.byteLength).getUint32(12, true) === 0xf3d1c4df)
      throw encrypted('암호가 걸린 파워포인트 문서예요. 암호를 푼 파일로 다시 열어주세요.');
  }
  const d = u8of(st.content);

  // 슬라이드 목록(SlideListWithText, instance 0)의 SlidePersistAtom 순서대로 슬라이드를 나눈다.
  // 그 밖(도형 글상자 등)의 글자는 Slide 컨테이너(1006) 안에서 찾아 "슬라이드 본문 도형"으로 이어 붙인다.
  const slides = [];
  let cur = null;
  let inMainList = false;
  let listEnd = 0;
  const loose = []; // Slide 컨테이너 안 글자
  let slideOrdinal = -1;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);

  const textOf = (r) => {
    if (r.type === RT.TEXT_CHARS) return cleanText(new TextDecoder('utf-16le').decode(d.subarray(r.body, r.end)));
    return cleanText(latin1(d.subarray(r.body, r.end)));
  };

  let slideContainerEnd = 0;
  for (const r of walk(d, 0, d.length)) {
    if (r.type === RT.SLIDE_LIST) {
      inMainList = r.inst === 0;
      listEnd = r.end;
      continue;
    }
    if (inMainList && r.body > listEnd) inMainList = false;
    if (r.type === RT.SLIDE) {
      slideOrdinal++;
      slideContainerEnd = r.end;
      loose[slideOrdinal] = [];
      continue;
    }
    if (inMainList && r.type === RT.SLIDE_PERSIST) {
      cur = { texts: [] };
      slides.push(cur);
      continue;
    }
    if (r.type === RT.TEXT_CHARS || r.type === RT.TEXT_BYTES) {
      const t = textOf(r);
      if (!t.trim()) continue;
      if (inMainList && cur) cur.texts.push(t);
      else if (slideOrdinal >= 0 && r.body < slideContainerEnd) loose[slideOrdinal].push(t);
    }
  }

  const blocks = [];
  const n = Math.max(slides.length, loose.length);
  for (let i = 0; i < n; i++) {
    const own = slides[i] ? slides[i].texts : [];
    const extra = (loose[i] || []).filter((t) => !own.includes(t));
    if (!own.length && !extra.length) continue;
    blocks.push({ t: 'h', text: `슬라이드 ${i + 1}` });
    for (const t of [...own, ...extra]) for (const line of t.split('\n')) blocks.push({ t: 'p', text: line });
  }
  if (!blocks.length) blocks.push({ t: 'p', text: '' });
  return { format: 'ppt', blocks };
}

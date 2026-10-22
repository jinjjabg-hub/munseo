// 옛 워드(.doc, Word 97-2003) 글자 추출 — best effort (서식·그림 제외)
import CFB from 'cfb';
import { corrupt, encrypted } from '../errors.js';

const u8of = (x) => (x instanceof Uint8Array ? x : Uint8Array.from(x));

// CP1252 중 0x80~0x9F 구간 (나머지는 Latin-1과 같다)
const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
function cp1252(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    s += b >= 0x80 && b <= 0x9f ? CP1252[b - 0x80] : String.fromCharCode(b);
  }
  return s;
}

// 워드의 제어 글자를 정리한다: 필드 코드는 버리고 결과만, 칸 끝은 탭, 문단 끝은 줄바꿈
function clean(raw) {
  let out = '';
  let depth = 0; // 필드 코드 구간(0x13 ~ 0x14) 안이면 건너뜀
  const stack = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c === 0x13) { stack.push(true); continue; }
    if (c === 0x14) { if (stack.length) stack[stack.length - 1] = false; continue; }
    if (c === 0x15) { stack.pop(); continue; }
    if (stack.some((inCode) => inCode)) continue;
    if (c === 0x0d) out += '\n';
    else if (c === 0x07) out += '\t';
    else if (c === 0x0b) out += '\n';
    else if (c === 0x0c) out += '\n';
    else if (c === 0x1e) out += '-';
    else if (c === 0x1f) out += '';
    else if (c === 0xa0) out += ' ';
    else if (c < 0x20 && c !== 0x09 && c !== 0x0a) continue; // 그림 자리표시 등
    else out += raw[i];
  }
  return out;
}

export function parseDoc(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  let cfb;
  try {
    cfb = CFB.read(u8, { type: 'array' });
  } catch {
    throw corrupt();
  }
  const wd = CFB.find(cfb, 'WordDocument');
  if (!wd) throw corrupt('워드(.doc) 문서가 아니에요.');
  const w = u8of(wd.content);
  const dv = new DataView(w.buffer, w.byteOffset, w.byteLength);
  if (w.length < 0x1a8 || dv.getUint16(0, true) !== 0xa5ec) throw corrupt('워드(.doc) 문서가 아니에요.');
  const flags = dv.getUint16(0x0a, true);
  if (flags & 0x0100) throw encrypted('암호가 걸린 워드 문서예요. 암호를 푼 파일로 다시 열어주세요.');
  const tableName = flags & 0x0200 ? '1Table' : '0Table';
  const tbl = CFB.find(cfb, tableName);
  if (!tbl) throw corrupt('워드 문서의 본문 표를 찾지 못했어요.');
  const t = u8of(tbl.content);

  const ccpText = dv.getInt32(0x4c, true); // 본문 글자 수 (각주·머리말 등 제외)
  const fcClx = dv.getUint32(0x1a2, true);
  const lcbClx = dv.getUint32(0x1a6, true);
  if (!lcbClx || fcClx + lcbClx > t.length) throw corrupt('워드 문서의 글자 위치 정보를 읽지 못했어요.');

  // CLX: Prc(0x01) 들을 건너뛰고 Pcdt(0x02) 안의 PlcPcd를 읽는다
  const tv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  let p = fcClx;
  const end = fcClx + lcbClx;
  while (p < end && t[p] === 0x01) p += 3 + tv.getUint16(p + 1, true);
  if (t[p] !== 0x02) throw corrupt('워드 문서의 글자 위치 정보를 읽지 못했어요.');
  const lcb = tv.getUint32(p + 1, true);
  const plc = p + 5;
  const n = Math.floor((lcb - 4) / 12); // CP (n+1)개 × 4바이트 + PCD n개 × 8바이트
  const cps = [];
  for (let i = 0; i <= n; i++) cps.push(tv.getUint32(plc + i * 4, true));

  let raw = '';
  for (let i = 0; i < n; i++) {
    const cpStart = cps[i];
    if (cpStart >= ccpText) break;
    const cpEnd = Math.min(cps[i + 1], ccpText);
    const count = cpEnd - cpStart;
    if (count <= 0) continue;
    const fcRaw = tv.getUint32(plc + (n + 1) * 4 + i * 8 + 2, true);
    if (fcRaw & 0x40000000) {
      const off = (fcRaw & 0x3fffffff) >>> 1;
      raw += cp1252(w.subarray(off, off + count));
    } else {
      const off = fcRaw;
      const bytes = w.subarray(off, off + count * 2);
      raw += new TextDecoder('utf-16le').decode(bytes);
    }
  }
  // 표 행 끝(칸 끝 표시가 연달아 나옴)은 줄바꿈으로: 한 행이 한 줄로 읽히게
  const text = clean(raw).replace(/\t{2,}/g, '\n');
  const blocks = text.split('\n').map((line) => ({ t: 'p', text: line.replace(/\t+$/, '') }));
  return { format: 'doc', blocks };
}

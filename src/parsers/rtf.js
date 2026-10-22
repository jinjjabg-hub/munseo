// RTF 글자 추출: 태그를 걷어내고 글자만 (한글 \'hh 바이트 코드, \uN 유니코드 지원)
import { corrupt } from '../errors.js';

const CODEPAGES = {
  949: 'euc-kr', 51949: 'euc-kr', 932: 'shift_jis', 936: 'gbk', 950: 'big5', 65001: 'utf-8',
  1250: 'windows-1250', 1251: 'windows-1251', 1252: 'windows-1252', 1253: 'windows-1253',
  1254: 'windows-1254', 1255: 'windows-1255', 1256: 'windows-1256', 1257: 'windows-1257', 1258: 'windows-1258',
};
const SKIP_DEST = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'headerl', 'headerr', 'headerf',
  'footer', 'footerl', 'footerr', 'footerf', 'fldinst', 'generator', 'object', 'themedata',
  'colorschememapping', 'latentstyles', 'datastore', 'xmlnstbl', 'listtable', 'listoverridetable',
  'rsidtbl', 'private', 'bkmkstart', 'bkmkend', 'revtbl', 'filetbl', 'falt', 'panose', 'fname',
]);
const SYMBOLS = {
  par: '\n', line: '\n', page: '\n', sect: '\n', tab: '\t', cell: '\t', row: '\n', nestcell: '\t', nestrow: '\n',
  emdash: '—', endash: '–', bullet: '•', lquote: '‘', rquote: '’',
  ldblquote: '“', rdblquote: '”', emspace: ' ', enspace: ' ', qmspace: ' ', '~': ' ', _: '‑',
};

export function parseRtf(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  let s = '';
  for (let i = 0; i < u8.length; i += 65536) s += String.fromCharCode.apply(null, u8.subarray(i, i + 65536));
  if (!/^\s*\{\\rtf/.test(s.slice(0, 64))) throw corrupt('RTF 문서가 아니에요.');

  let cp = 'windows-1252';
  const m = /\\ansicpg(\d+)/.exec(s.slice(0, 4000));
  if (m && CODEPAGES[m[1]]) cp = CODEPAGES[m[1]];
  const dec = new TextDecoder(cp);

  const out = [];
  let bytes = [];
  const flushBytes = () => {
    if (bytes.length) { out.push(dec.decode(Uint8Array.from(bytes))); bytes = []; }
  };
  const stack = [];
  let skip = 0; // 건너뛰는 그룹 깊이
  let uc = 1;
  let skipChars = 0;

  for (let i = 0; i < s.length; ) {
    const ch = s[i];
    if (ch === '{') {
      flushBytes();
      stack.push({ skip, uc });
      i++;
      // {\*\dest ...} 와 SKIP_DEST 처리
      if (!skip) {
        let j = i;
        let star = false;
        if (s[j] === '\\' && s[j + 1] === '*') { star = true; j += 2; if (s[j] === '\\') {/* 다음 단어 */} }
        if (s[j] === '\\') {
          const mm = /^\\([a-zA-Z]+)/.exec(s.slice(j, j + 40));
          if (star || (mm && SKIP_DEST.has(mm[1]))) skip = 1;
        }
      }
      continue;
    }
    if (ch === '}') {
      flushBytes();
      const st = stack.pop();
      if (st) { skip = st.skip; uc = st.uc; }
      i++;
      continue;
    }
    if (ch === '\\') {
      const nx = s[i + 1];
      if (nx === "'") {
        const hex = s.slice(i + 2, i + 4);
        i += 4;
        if (skipChars > 0) { skipChars--; continue; }
        if (!skip) bytes.push(parseInt(hex, 16));
        continue;
      }
      if (nx === '\\' || nx === '{' || nx === '}') {
        if (!skip && skipChars === 0) { flushBytes(); out.push(nx); }
        else if (skipChars > 0) skipChars--;
        i += 2;
        continue;
      }
      if (nx === '~' || nx === '_') { if (!skip) { flushBytes(); out.push(SYMBOLS[nx]); } i += 2; continue; }
      if (nx === '\n' || nx === '\r') { if (!skip) { flushBytes(); out.push('\n'); } i += 2; continue; }
      const mm = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(s.slice(i, i + 64));
      if (!mm) { i += 2; continue; }
      i += mm[0].length;
      const word = mm[1];
      const num = mm[2] !== undefined ? parseInt(mm[2], 10) : undefined;
      if (skip) continue;
      if (word === 'u' && num !== undefined) {
        flushBytes();
        out.push(String.fromCharCode(num < 0 ? num + 65536 : num));
        skipChars = uc;
      } else if (word === 'uc' && num !== undefined) uc = num;
      else if (word === 'bin' && num > 0) i += num;
      else if (SYMBOLS[word] !== undefined) { flushBytes(); out.push(SYMBOLS[word]); }
      continue;
    }
    if (ch === '\r' || ch === '\n') { i++; continue; }
    if (skip) { i++; continue; }
    if (skipChars > 0) { skipChars--; i++; continue; }
    // 일반 글자(한글 등 0x80 이상 바이트는 위 \'hh 로만 나온다)
    flushBytes();
    out.push(ch);
    i++;
  }
  flushBytes();
  const text = out.join('');
  return { format: 'rtf', blocks: text.split('\n').map((line) => ({ t: 'p', text: line })) };
}

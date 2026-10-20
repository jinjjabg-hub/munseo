// 폰(에뮬레이터) 시험용 작은 문서 5종을 만든다. 각 문서에 SMOKE-형식 표시 글자가 들어 있다.
// .hwp 는 한글 없이 cfb 라이브러리로 직접 조립한 합성 파일이다.
import fs from 'node:fs';
import path from 'node:path';
import CFB from 'cfb';

const out = path.resolve('tests/smoke-files');
fs.mkdirSync(out, { recursive: true });

function rec(tag, level, data) {
  const h = Buffer.alloc(4);
  h.writeUInt32LE((tag & 0x3ff) | ((level & 0x3ff) << 10) | (data.length << 20) >>> 0, 0);
  return Buffer.concat([h, data]);
}
const utf16 = (s) => Buffer.from(s, 'utf16le');
const para = (text) =>
  Buffer.concat([rec(0x42, 0, Buffer.alloc(22)), rec(0x43, 1, Buffer.concat([utf16(text), Buffer.from([0x0d, 0x00])]))]);

const section = Buffer.concat([para('SMOKE-HWP 한글 문서 시험'), para('두 번째 문단입니다. 가나다라마바사')]);
const header = Buffer.alloc(256);
header.write('HWP Document File', 0, 'latin1');
header.writeUInt32LE(0x05010000, 32); // 5.1.0.0
header.writeUInt32LE(0, 36); // 압축·암호 없음

const cfb = CFB.utils.cfb_new();
CFB.utils.cfb_add(cfb, 'FileHeader', header);
CFB.utils.cfb_add(cfb, 'BodyText/Section0', section);
fs.writeFileSync(path.join(out, 'sample.hwp'), Buffer.from(CFB.write(cfb, { type: 'buffer' })));
console.log('hwp ok');

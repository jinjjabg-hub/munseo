// 폴더 안의 모든 .hwp를 열어 성공/실패, 시간, 글자 수를 표로 출력
import fs from 'node:fs';
import path from 'node:path';
import { parseHwp } from '../src/parsers/hwp.js';
const rows = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.hwp$/i.test(f)) {
      const t0 = performance.now();
      let r;
      try {
        const doc = parseHwp(fs.readFileSync(p));
        const chars = JSON.stringify(doc.blocks).length;
        const tables = doc.blocks.filter((b) => b.t === 'table').length;
        r = { file: path.relative(process.argv[2], p), 결과: 'OK', 블록: doc.blocks.length, 표: tables, ms: Math.round(performance.now() - t0) };
      } catch (e) {
        r = { file: path.relative(process.argv[2], p), 결과: 'ERR ' + e.message.slice(0, 40), 블록: 0, 표: 0, ms: Math.round(performance.now() - t0) };
      }
      rows.push(r);
    }
  }
})(process.argv[2]);
console.table(rows);

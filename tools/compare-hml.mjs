// .hwp 추출 결과를 한글이 직접 내보낸 .hml(정답)과 글자 단위로 대조한다.
// 사용: node tools/compare-hml.mjs 폴더...
import fs from 'node:fs';
import path from 'node:path';
import { parseHwp } from '../src/parsers/hwp.js';

// 정답(.hml)은 <CHAR> 글자만 모으므로, 내 결과도 문단 글자만 이어 붙여 비교한다
const flat = (blocks) =>
  blocks.map((b) => b.t === 'p' ? b.text
    : b.t === 'table' ? flat(b.cells.slice().sort((x, y) => x.r - y.r || x.c - y.c).flatMap((c) => c.blocks))
    : b.t === 'box' ? flat(b.blocks) : '').join('').replace(/\s/g, '');

function hmlText(xml) {
  const body = xml.slice(xml.indexOf('<BODY'));
  let s = '';
  for (const m of body.matchAll(/<CHAR>(.*?)<\/CHAR>/gs)) s += m[1].replace(/<(HYPEN|NBSPACE|FWSPACE|TAB|LINEBREAK)\/>/g, (_, t) => t === 'HYPEN' ? '-' : ' ').replace(/<[^>]*>/g, '');
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s/g, '');
}

let rows = [];
function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.hwp') && fs.existsSync(p.replace(/\.hwp$/, '.hml'))) {
      const mine = flat(parseHwp(fs.readFileSync(p)).blocks);
      const ref = hmlText(fs.readFileSync(p.replace(/\.hwp$/, '.hml'), 'utf8'));
      // 순서 점검: 정답 글자열이 내 결과에 같은 순서로 들어 있는지 + 글자 수 비교
      rows.push({ file: path.relative(process.argv[2] || '.', p), ref: ref.length, mine: mine.length, same: mine === ref });
      if (mine !== ref) {
        let i = 0; while (i < mine.length && mine[i] === ref[i]) i++;
        rows[rows.length - 1].diff = `@${i} 내것:"${mine.slice(i, i + 20)}" 정답:"${ref.slice(i, i + 20)}"`;
      }
    }
  }
}
for (const d of process.argv.slice(2)) walk(d);
console.table(rows);

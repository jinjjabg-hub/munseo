// 사용: node tools/dump-hwp.mjs 파일.hwp  → 추출된 글자를 터미널에 출력 (파서 점검용)
import fs from 'node:fs';
import { parseHwp } from '../src/parsers/hwp.js';
import { blocksToText } from '../src/parsers/docmodel.js';
const f = process.argv[2];
const t0 = performance.now();
const doc = parseHwp(fs.readFileSync(f));
console.log(blocksToText(doc.blocks));
console.error(`-- ${f}: ${(performance.now() - t0).toFixed(0)}ms, blocks=${doc.blocks.length}`);

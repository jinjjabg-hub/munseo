// 사용: node tools/dump-old.mjs 파일.(doc|ppt|rtf|odt|odp) — 뽑힌 글자를 터미널에 출력 (파서 점검용)
import fs from 'node:fs';
import path from 'node:path';
import { blocksToText } from '../src/parsers/docmodel.js';
const f = process.argv[2];
const ext = path.extname(f).slice(1).toLowerCase();
const t0 = performance.now();
const buf = fs.readFileSync(f);
let doc;
if (ext === 'doc') doc = (await import('../src/parsers/doc.js')).parseDoc(buf);
else if (ext === 'ppt') doc = (await import('../src/parsers/ppt.js')).parsePpt(buf);
else if (ext === 'rtf') doc = (await import('../src/parsers/rtf.js')).parseRtf(buf);
else throw new Error('지원: doc ppt rtf');
console.log(blocksToText(doc.blocks));
console.error(`-- ${f}: ${(performance.now() - t0).toFixed(0)}ms, blocks=${doc.blocks.length}`);

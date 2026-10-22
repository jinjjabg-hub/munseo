// 브라우저(Chromium)로 앱을 실제로 열어 보는 시험. 사용: npm run build && node tests/run.mjs [필터]
// 폰 화면 크기 + 터치로 에뮬레이트하고, 결과를 test-results/report.md 에 표로 저장한다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const WWW = path.join(ROOT, 'www');
const FIX = path.join(ROOT, 'tests/.cache/fixtures');
const OUT = path.join(ROOT, 'test-results');
fs.mkdirSync(OUT, { recursive: true });
const filter = process.argv[2];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.json': 'application/json', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.icc': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(WWW, u === '/' ? 'index.html' : u);
  if (!f.startsWith(WWW) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const exe = fs.readdirSync('/opt/pw-browsers').filter((d) => /^chromium-\d+$/.test(d)).map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`).find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-gpu'] });

const rows = [];
const outside = new Set();
const cspViolations = [];

async function newPage({ throttle = 1, scheme = 'light', viewport = { width: 412, height: 860 } } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme, locale: 'ko-KR' });
  const page = await ctx.newPage();
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(ORIGIN) && !u.startsWith('data:') && !u.startsWith('blob:')) outside.add(u);
  });
  page.on('console', (m) => { if (/Content Security Policy|violates/i.test(m.text())) cspViolations.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)));
  if (throttle > 1) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  await page.goto(ORIGIN + '/');
  return { page, ctx };
}

// 파일을 열고 "뷰어가 보이거나 오류가 보일 때"까지 기다린 뒤 상태를 돌려준다
async function openFile(page, file, timeout = 60000) {
  const t0 = Date.now();
  await page.setInputFiles('#picker', file);
  await page.waitForFunction(() => {
    const v = document.getElementById('viewer'), e = document.getElementById('error');
    return (!v.hidden && v.children.length) || !e.hidden;
  }, null, { timeout });
  await page.waitForTimeout(400);
  const state = await page.evaluate(() => ({
    error: document.getElementById('error').hidden ? null : document.getElementById('error-text').textContent,
    fname: document.getElementById('fname').textContent,
    meta: document.getElementById('fmeta').textContent,
    text: (document.getElementById('viewer').innerText || '').slice(0, 100000),
    perf: window.__perf || {},
  }));
  state.wallMs = Date.now() - t0;
  return state;
}

async function pdfText(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, isEvalSupported: false }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    text += tc.items.map((x) => x.str).join(' ') + '\n';
  }
  const squash = (t) => t.replace(/[^\p{L}\p{N}]+/gu, ''); // 글자·숫자만 비교 (PDF는 공백·하이픈 모양이 달라질 수 있음)
  return { pages: doc.numPages, text: squash(text), has: (needle) => squash(text).includes(squash(needle)) };
}

const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });
const rec = (area, item, pass, detail) => { rows.push({ area, item, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${area} | ${item} | ${detail}`); };
const want = (area) => !filter || area.includes(filter);

// ---------------- 시험들 ----------------
const tests = {
  async 'PDF'() {
    const { page } = await newPage({ throttle: 4 });
    const f = path.join(FIX, 'hundred-pages.pdf');
    const size = fs.statSync(f).size;
    const s = await openFile(page, f);
    await page.waitForFunction(() => window.__perf?.pdfFirstPaintMs != null, null, { timeout: 20000 });
    s.perf = await page.evaluate(() => window.__perf);
    rec('PDF', '100쪽 열림', !s.error && s.perf.pdfPages === 100, `쪽수=${s.perf.pdfPages} ${s.error || ''}`);
    rec('PDF', '첫 화면 2초 이내 (CPU 4배 느리게)', s.perf.pdfFirstPaintMs < 2000, `${s.perf.pdfFirstPaintMs}ms (파일 ${Math.round(size / 1024)}KB, 열기 전체 ${s.perf.openMs}ms)`);
    const txt = await page.evaluate(() => document.querySelector('.textLayer')?.textContent || '');
    rec('PDF', '글자 선택층(검색용)', /Page 1 of 100/.test(txt), txt.slice(0, 30));
    await shot(page, 'pdf-first');
    // 스크롤 부드러움: 프레임 간격 측정
    const frames = await page.evaluate(async () => {
      const sc = document.querySelector('.scroller');
      const dts = [];
      let last = performance.now();
      await new Promise((resolve) => {
        let i = 0;
        const step = () => {
          const now = performance.now(); dts.push(now - last); last = now;
          sc.scrollTop += 80; i++;
          if (i < 180) requestAnimationFrame(step); else resolve();
        };
        requestAnimationFrame(step);
      });
      dts.sort((a, b) => a - b);
      return { p50: dts[Math.floor(dts.length * .5)], p95: dts[Math.floor(dts.length * .95)], max: dts[dts.length - 1], scrolled: sc.scrollTop };
    });
    rec('PDF', '스크롤 프레임 간격 (CPU 4배 느리게)', frames.p95 < 100, `중앙값 ${frames.p50.toFixed(1)}ms, 95% ${frames.p95.toFixed(1)}ms, 최대 ${frames.max.toFixed(1)}ms`);
    // 끝까지 점프 → 마지막 쪽이 그려지는지
    await page.evaluate(() => { const sc = document.querySelector('.scroller'); sc.scrollTop = sc.scrollHeight; });
    await page.waitForFunction(() => /END-PAGE-100/.test(document.querySelector('.pdf-page[data-n="100"] .textLayer')?.textContent || ''), null, { timeout: 15000 }).then(
      () => rec('PDF', '맨 끝(100쪽) 불러오기', true, 'END-PAGE-100 확인'),
      () => rec('PDF', '맨 끝(100쪽) 불러오기', false, '시간 초과'));
    const stats = await page.evaluate(() => ({ canvases: document.querySelectorAll('.pdf-page canvas').length, mem: performance.memory?.usedJSHeapSize }));
    rec('PDF', '동시에 그려진 쪽 수 (메모리 보호)', stats.canvases <= 14, `${stats.canvases}쪽만 그림 / 전체 100쪽`);
    await shot(page, 'pdf-end');
    await page.context().close();
  },

  async 'PDF-한글'() {
    const { page } = await newPage();
    const s = await openFile(page, path.join(FIX, 'korean.pdf'));
    await page.waitForFunction(() => document.querySelector('.textLayer')?.textContent.includes('END-OF-KPDF'), null, { timeout: 10000 }).then(
      () => rec('PDF-한글', '한글 글꼴 PDF 글자층', true, '한글 글자 추출 OK'), () => rec('PDF-한글', '한글 글꼴 PDF 글자층', false, '글자 못 찾음'));
    await shot(page, 'pdf-korean');
    await page.context().close();
  },

  async 'PDF-암호'() {
    const { page } = await newPage();
    const s = await openFile(page, path.join(FIX, 'encrypted.pdf'));
    rec('암호', '암호 PDF → 안내 문구', !!s.error && /암호/.test(s.error), s.error || '오류 없음(문서가 열림)');
    await shot(page, 'err-pdf-encrypted');
    await page.context().close();
  },

  async 'DOCX'() {
    const { page } = await newPage();
    const s = await openFile(page, path.join(FIX, 'complex.docx'));
    rec('DOCX', '열림', !s.error, s.error || `${s.perf.openMs}ms`);
    rec('DOCX', '본문·끝 문단·머리말', /END-OF-DOCX/.test(s.text) && /월간 업무 보고서/.test(s.text) && /머리말/.test(s.text), '키워드 확인');
    const dom = await page.evaluate(() => ({
      pages: document.querySelectorAll('section.docx').length,
      tables: document.querySelectorAll('table').length,
      imgs: [...document.querySelectorAll('img')].filter((i) => i.naturalWidth > 0).length,
      boldRun: !!document.querySelector('b, strong, span[style*="bold"]'),
      scroller: document.querySelector('.scroller')?.scrollWidth,
    }));
    rec('DOCX', '쪽/표/그림', dom.pages >= 1 && dom.tables >= 1 && dom.imgs >= 1, `쪽 ${dom.pages}, 표 ${dom.tables}, 그림 ${dom.imgs}`);
    await shot(page, 'docx-page');
    // 읽기 모드(mammoth)
    await page.getByRole('button', { name: '읽기 모드' }).click();
    await page.waitForSelector('.reflow', { timeout: 10000 });
    const r = await page.evaluate(() => ({ t: document.querySelector('.reflow').innerText, tables: document.querySelectorAll('.reflow table').length, imgs: document.querySelectorAll('.reflow img').length }));
    rec('DOCX', '읽기 모드(mammoth)', /END-OF-DOCX/.test(r.t) && r.tables >= 1 && r.imgs >= 1, `표 ${r.tables}, 그림 ${r.imgs}`);
    await shot(page, 'docx-reflow');
    await page.context().close();
  },

  async 'PPTX'() {
    const { page } = await newPage();
    const s = await openFile(page, path.join(FIX, 'table-picture.pptx'));
    rec('PPTX', '열림', !s.error, s.error || `${s.perf.openMs}ms`);
    const dom = await page.evaluate(() => ({
      text: document.getElementById('viewer').innerText,
      imgs: [...document.querySelectorAll('#viewer img, #viewer canvas, #viewer svg')].length,
      tables: document.querySelectorAll('#viewer table').length,
      slides: document.querySelectorAll('.pptx-preview-slide-wrapper, .pptx-preview-wrapper > div').length,
    }));
    rec('PPTX', '슬라이드 글자', /2025 상반기 사업 보고/.test(dom.text) && /핵심 요약/.test(dom.text) && /END-OF-PPTX/.test(dom.text), '제목·요약·끝 문구 확인');
    rec('PPTX', '표/그림', dom.imgs > 0 || dom.tables > 0, `표 ${dom.tables}, 그림류 ${dom.imgs}`);
    await shot(page, 'pptx');
    await page.context().close();
  },

  async 'XLSX'() {
    const { page } = await newPage({ throttle: 4 });
    const f = path.join(FIX, 'multi-sheet.xlsx');
    const t0 = Date.now();
    const s = await openFile(page, f, 120000);
    rec('XLSX', '열림 (시트 3개, 6만 행 포함, CPU 4배 느리게)', !s.error, s.error || `전체 ${Date.now() - t0}ms`);
    const tabs = await page.$$eval('.xl-tab', (b) => b.map((x) => x.textContent));
    rec('XLSX', '시트 탭', tabs.length === 3, tabs.join(' | '));
    const first = await page.$$eval('.xl-cells .c', (c) => c.slice(0, 6).map((x) => x.textContent));
    rec('XLSX', '첫 시트 내용', first[0] === '항목', first.join(' / '));
    await shot(page, 'xlsx-sheet1');
    const t1 = Date.now();
    await page.locator('.xl-tab').nth(1).click();
    await page.waitForFunction(() => document.querySelector('.xl-cells .c')?.textContent === '번호', null, { timeout: 30000 });
    rec('XLSX', '6만 행 시트 전환 시간', Date.now() - t1 < 1500, `${Date.now() - t1}ms (행 ${await page.evaluate(() => window.__perf.xlsxRows)})`);
    const dts = await page.evaluate(async () => {
      const sc = document.querySelector('.xl-scroll'); const d = []; let last = performance.now();
      await new Promise((res) => { let i = 0; const step = () => { const n = performance.now(); d.push(n - last); last = n; sc.scrollTop += 100; if (++i < 180) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
      d.sort((a, b) => a - b); return { p50: d[45], p95: d[Math.floor(d.length * .95)], max: d[d.length - 1] };
    });
    rec('XLSX', '6만 행 스크롤 프레임 (CPU 4배 느리게)', dts.p95 < 100, `중앙값 ${dts.p50.toFixed(1)}ms, 95% ${dts.p95.toFixed(1)}ms, 최대 ${dts.max.toFixed(1)}ms`);
    await page.evaluate(() => { const sc = document.querySelector('.xl-scroll'); sc.scrollTop = sc.scrollHeight; });
    await page.waitForTimeout(500);
    const last = await page.$$eval('.xl-cells .c', (c) => c.map((x) => x.textContent).filter((t) => /^row-60000-/.test(t) || t === '이름60000'));
    rec('XLSX', '맨 끝(60000행) 도달', last.length > 0, last.join(','));
    await shot(page, 'xlsx-end');
    await page.locator('.xl-tab').nth(2).click();
    await page.waitForTimeout(300);
    const c3 = await page.$$eval('.xl-cells .c', (c) => c.slice(0, 2).map((x) => x.textContent));
    rec('XLSX', '세 번째 시트', c3[0] === 'R1C1', c3.join(','));
    await page.context().close();
  },

  async 'XLSX-형식'() {
    const { page } = await newPage();
    for (const [f, exp] of [['legacy.xls', '이름'], ['sheet.ods', '이름'], ['korean-cp949.csv', '이름']]) {
      const s = await openFile(page, path.join(FIX, f));
      const cells = await page.$$eval('.xl-cells .c', (c) => c.slice(0, 7).map((x) => x.textContent));
      rec('XLSX-형식', f, !s.error && cells[0] === exp, s.error || cells.join(' / '));
    }
    await page.context().close();
  },

  async 'HWPX'() {
    const { page } = await newPage();
    const s = await openFile(page, path.join(FIX, 'sample.hwpx'));
    rec('HWPX', '열림·글자·표', !s.error && /END-OF-HWPX/.test(s.text) && /칸3-3/.test(s.text), s.error || `${s.perf.openMs}ms`);
    const t = await page.evaluate(() => ({ tables: document.querySelectorAll('.hw-table').length, span: !!document.querySelector('td[colspan="2"]') }));
    rec('HWPX', '표 칸 병합', t.tables === 1 && t.span, JSON.stringify(t));
    await shot(page, 'hwpx');
    await page.context().close();
  },

  async 'HWP'() {
    const { page } = await newPage();
    const dir = path.join(FIX, 'hwp');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.hwp')).sort();
    let ok = 0, fail = [];
    for (const f of files) {
      if (f.includes('catalogue')) continue;
      const s = await openFile(page, path.join(dir, f));
      if (!s.error && s.text.trim().length > 0) ok++; else fail.push(f + ':' + (s.error || '빈 화면'));
    }
    rec('HWP', `실제 .hwp ${files.length - 1}개 화면 표시`, fail.length === 0, `${ok}개 성공` + (fail.length ? ` / 실패: ${fail.slice(0, 5).join(', ')}` : ''));
    const big = path.join(dir, files.find((f) => f.includes('catalogue')));
    const s = await openFile(page, big, 60000);
    rec('HWP', '13.7MB 한글 문서(catalogue)', !s.error, s.error || `열기 ${s.perf.openMs}ms, 글자 ${s.text.length}`);
    await openFile(page, path.join(dir, files.find((f) => f.endsWith('naver_details_career_resume.hwp'))));
    await shot(page, 'hwp-resume');
    await openFile(page, path.join(dir, files.find((f) => f.endsWith('kaist_kaist-585.hwp'))));
    await shot(page, 'hwp-kaist585');
    await page.context().close();
  },

  async '오류'() {
    const { page } = await newPage();
    const cases = [
      ['encrypted.hwp', /암호/, '암호 한글(.hwp)'],
      ['distribution.hwp', /배포용/, '배포용 한글(.hwp)'],
      ['encrypted.docx', /암호/, '암호 워드(.docx)'],
      ['garbage.hwp', /손상|형식/, '깨진 .hwp'],
      ['garbage.pdf', /손상|읽을 수/, '깨진 .pdf'],
      ['garbage.xlsx', /손상|읽을 수/, '깨진 .xlsx'],
      ['truncated.docx', /손상|읽을 수/, '잘린 .docx'],
      ['archive.zip', /지원하지 않아요: \.zip/, '지원 안 하는 형식(.zip)'],
      ['unknown.xyz', /지원하지 않아요: \.xyz/, '지원 안 하는 형식(.xyz)'],
    ];
    for (const [f, re, label] of cases) {
      const s = await openFile(page, path.join(FIX, f));
      rec('오류', label, !!s.error && re.test(s.error), s.error || '오류 없음');
      if (f === 'encrypted.hwp') await shot(page, 'err-hwp-encrypted');
    }
    await page.context().close();
  },


  async '옛형식'() {
    const { page } = await newPage();
    const cases = [
      ['legacy-korean.doc', /월간 업무 보고서/, /END|마지막/, '옛 워드(.doc) 한글'],
      ['legacy-korean.ppt', /2025 상반기 사업 보고/, /핵심 요약/, '옛 파워포인트(.ppt) 한글'],
      ['sample.rtf', /월간 업무 보고서/, /실적 표/, 'RTF 한글'],
      ['sample.odt', /월간 업무 보고서/, /실적 표/, 'OpenDocument 글(.odt)'],
      ['sample.odp', /2025 상반기 사업 보고/, /핵심 요약/, 'OpenDocument 슬라이드(.odp)'],
      ['real-harmless-clean.doc', /harmless test document/, /ünicöde/, '실제 MS워드 .doc'],
      ['real-embedded-simple-2007.ppt', /Embedded Objects/, /simple harmless ASCII/, '실제 MS파워포인트 .ppt'],
      ['real-sample_with_vba.ppt', /PPT VBA TEST/, /./, '실제 .ppt (매크로 포함)'],
    ];
    for (const [f, a, b, label] of cases) {
      const s = await openFile(page, path.join(FIX, f));
      rec('옛형식', label, !s.error && a.test(s.text) && b.test(s.text), s.error || `${f} · ${s.text.replace(/\s+/g, ' ').slice(0, 60)}`);
    }
    for (const [f, label] of [['real-encrypted.doc', '암호 .doc'], ['real-encrypted.ppt', '암호 .ppt']]) {
      const s = await openFile(page, path.join(FIX, f));
      rec('암호', `${label} → 안내 문구`, !!s.error && /암호/.test(s.error), s.error || '오류 없음');
    }
    await openFile(page, path.join(FIX, 'legacy-korean.doc'));
    await shot(page, 'doc-legacy');
    await page.context().close();
  },

  async '텍스트'() {
    const { page } = await newPage();
    for (const [f, re, label] of [
      ['utf8.txt', /END-OF-TXT/, 'UTF-8 텍스트'], ['cp949.txt', /END-OF-CP949/, 'CP949(윈도) 텍스트'],
      ['readme.md', /END-OF-MD/, '마크다운(.md)'], ['data.json', /END-OF-JSON/, 'JSON'], ['feed.xml', /END-OF-XML/, 'XML'],
    ]) {
      const s = await openFile(page, path.join(FIX, f));
      rec('텍스트', label, !s.error && re.test(s.text) && (f !== 'cp949.txt' || /윈도 메모장/.test(s.text)), s.error || s.text.slice(0, 40).replace(/\n/g, ' '));
    }
    const s = await openFile(page, path.join(FIX, 'page.html'));
    const titleChanged = await page.evaluate(() => document.title !== '내 문서 뷰어');
    rec('텍스트', 'HTML은 실행하지 않고 소스로 보임', /<script>/.test(s.text) && /END-OF-HTML/.test(s.text) && !titleChanged, '소스 글자 표시, 스크립트 미실행');
    // 큰 텍스트
    const big = path.join(OUT, '_big.txt');
    fs.writeFileSync(big, Array.from({ length: 200000 }, (_, i) => `줄 ${i + 1}: 큰 텍스트 파일 시험입니다 가나다라마바사`).join('\n') + '\nEND-OF-BIG');
    const t0 = Date.now();
    const b = await openFile(page, big);
    rec('텍스트', `큰 텍스트(${(fs.statSync(big).size / 1e6).toFixed(1)}MB) 첫 화면 (CPU 보통)`, !b.error && b.perf.openMs < 1500, `앱이 연 시간 ${b.perf.openMs}ms (시험 도구 대기 포함 ${Date.now() - t0}ms)`);
    await page.context().close();
  },

  async '이미지'() {
    const { page } = await newPage();
    for (const f of ['photo.png', 'photo.jpg', 'photo.webp', 'anim.gif']) {
      const s = await openFile(page, path.join(FIX, f));
      const nat = await page.evaluate(() => { const i = document.querySelector('.img-wrap img'); return i ? [i.naturalWidth, i.naturalHeight] : null; });
      rec('이미지', f, !s.error && nat && nat[0] > 0, s.error || `원본 ${nat && nat.join('×')}`);
    }
    await openFile(page, path.join(FIX, 'photo.png'));
    const z0 = await page.evaluate(() => parseFloat(document.querySelector('.img-wrap').style.zoom));
    await page.mouse.move(200, 300);
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -400); await page.keyboard.up('Control');
    await page.waitForTimeout(200);
    const z1 = await page.evaluate(() => parseFloat(document.querySelector('.img-wrap').style.zoom));
    rec('이미지', '확대 동작', z1 > z0, `배율 ${z0.toFixed(2)} → ${z1.toFixed(2)}`);
    await shot(page, 'image');
    const tools = await page.evaluate(() => document.getElementById('tools').hidden);
    rec('이미지', '이미지에는 도구 줄 없음', tools, '검색·PDF저장 버튼 숨김');
    await page.context().close();
  },

  async '검색'() {
    const { page } = await newPage();
    const find = (q) => page.evaluate((x) => window.__app.search(x), q);
    // 워드
    await openFile(page, path.join(FIX, 'complex.docx'));
    let r = await find('본문 문단 5');
    let marks = await page.evaluate(() => document.querySelectorAll('mark.find-hit').length);
    rec('검색', '워드: 글자 찾기 + 강조', r.count >= 1 && marks >= 1, `${r.count}건, 강조 ${marks}개`);
    r = await find('실적');
    rec('검색', '워드: 표 근처 글자', r.count >= 1, `${r.count}건`);
    r = await find('없는글자zzzq');
    rec('검색', '워드: 없는 글자 → 0건', r.count === 0, `${r.count}건`);
    await shot(page, 'search-docx');
    // 한글(hwp) — 표 안 글자도
    const hdir = path.join(FIX, 'hwp');
    await openFile(page, path.join(hdir, fs.readdirSync(hdir).find((f) => f.endsWith('kaist_kaist-585.hwp'))));
    const hwpText = await page.evaluate(() => document.querySelector('.hw-doc td')?.innerText || '');
    r = await find(hwpText.trim().slice(0, 3));
    rec('검색', '한글: 표 안 글자 찾기', r.count >= 1, `"${hwpText.trim().slice(0, 3)}" ${r.count}건`);
    const n1 = await page.evaluate(() => window.__app.next());
    rec('검색', '한글: 다음 결과로 이동', r.count < 2 || n1.index === 1, `${n1.index + 1}/${n1.count}`);
    // 엑셀
    await openFile(page, path.join(FIX, 'multi-sheet.xlsx'), 120000);
    r = await find('row-59999-');
    await page.waitForTimeout(400);
    const cur = await page.evaluate(() => document.querySelector('.xl .c.cur')?.textContent || '');
    rec('검색', '엑셀: 6만 행 시트에서 찾아 이동', r.count === 1 && /row-59999-/.test(cur), `${r.count}건, 현재 칸 "${cur}"`);
    r = await find('R7C9');
    rec('검색', '엑셀: 다른 시트(3번째)에서 찾기', r.count >= 1, `${r.count}건`);
    // 텍스트
    await openFile(page, path.join(FIX, 'utf8.txt'));
    r = await find('두 번째');
    rec('검색', '텍스트 파일', r.count === 1, `${r.count}건`);
    // PDF
    await openFile(page, path.join(FIX, 'hundred-pages.pdf'));
    r = await find('Page 77 of 100');
    await page.waitForTimeout(600);
    const pdfMark = await page.evaluate(() => { const m = document.querySelector('.textLayer mark.find-hit.cur'); return m ? m.closest('.pdf-page').dataset.n : null; });
    rec('검색', 'PDF(100쪽): 찾아서 77쪽으로 이동·강조', r.count === 1 && pdfMark === '77', `${r.count}건, 강조된 쪽 ${pdfMark}`);
    r = await find('END-PAGE-1');
    rec('검색', 'PDF: 여러 결과 (END-PAGE-1…)', r.count >= 11, `${r.count}건`);
    await openFile(page, path.join(FIX, 'korean-100.pdf'));
    const t0 = Date.now();
    r = await find('검색어-077');
    await page.waitForTimeout(600);
    const km = await page.evaluate(() => { const m = document.querySelector('.textLayer mark.find-hit'); return m ? m.closest('.pdf-page').dataset.n : null; });
    rec('검색', '한글 PDF(120쪽): 한글 검색어 (77쪽에 6번 나옴)', r.count === 6 && km === '77', `${r.count}건, 쪽 ${km}, ${Date.now() - t0}ms`);
    await shot(page, 'search-pdf');
    await page.context().close();
  },

  async 'PDF저장'() {
    const { page } = await newPage({ viewport: { width: 1000, height: 900 } });
    const grab = async (file, name, checks) => {
      await openFile(page, path.join(FIX, file), 120000);
      const orient = await page.evaluate(() => window.__app.preparePrint());
      const out = path.join(OUT, name + '.pdf');
      await page.pdf({ path: out, format: 'A4', landscape: orient === 'landscape', printBackground: true, margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' } });
      const txt = await pdfText(out);
      await page.evaluate(() => document.getElementById('print-root').replaceChildren());
      return { ...txt, size: fs.statSync(out).size, orient };
    };
    let g = await grab('sample.hwpx', 'save-hwpx');
    rec('PDF저장', '한글(.hwpx) → PDF', g.pages >= 1 && g.has('END-OF-HWPX') && g.has('칸3-3'), `${g.pages}쪽, ${Math.round(g.size / 1024)}KB`);
    const hdir = path.join(FIX, 'hwp');
    g = await grab('hwp/' + fs.readdirSync(hdir).find((f) => f.endsWith('kaist_kaist-585.hwp')), 'save-hwp');
    rec('PDF저장', '한글(.hwp) → PDF, 표 포함', g.pages >= 1 && g.has('학적팀'), `${g.pages}쪽, ${Math.round(g.size / 1024)}KB`);
    g = await grab('complex.docx', 'save-docx');
    rec('PDF저장', '워드 → PDF, 쪽 나뉨', g.pages >= 2 && g.has('END-OF-DOCX') && g.has('병합된 셀'), `${g.pages}쪽, ${Math.round(g.size / 1024)}KB`);
    g = await grab('table-picture.pptx', 'save-pptx');
    rec('PDF저장', '파워포인트 → PDF (슬라이드당 1쪽, 가로)', g.pages === 4 && g.orient === 'landscape' && g.has('END-OF-PPTX'), `${g.pages}쪽(슬라이드 4장), ${g.orient}`);
    g = await grab('multi-sheet.xlsx', 'save-xlsx');
    rec('PDF저장', '엑셀 → PDF (시트 3개, 행 많으면 앞부분)', g.pages >= 3 && g.has('항목') && g.has('앞 3,000행'), `${g.pages}쪽, ${Math.round(g.size / 1024)}KB`);
    g = await grab('legacy-korean.doc', 'save-doc');
    rec('PDF저장', '옛 워드(.doc) → PDF', g.pages >= 1 && g.has('월간 업무 보고서'), `${g.pages}쪽`);
    // 버튼 노출
    const vis = async (file) => { await openFile(page, path.join(FIX, file)); return page.evaluate(() => ({ s: !document.getElementById('btn-search').hidden, v: !document.getElementById('btn-save').hidden, h: !document.getElementById('btn-share').hidden })); };
    let v = await vis('complex.docx');
    rec('PDF저장', '워드: 검색·PDF저장 버튼 보임', v.s && v.v, JSON.stringify(v));
    v = await vis('hundred-pages.pdf');
    rec('PDF저장', 'PDF: 검색 보임, "PDF로 저장" 없음', v.s && !v.v, JSON.stringify(v));
    await page.context().close();
  },

  async '다크모드'() {
    const { page } = await newPage({ scheme: 'dark' });
    await openFile(page, path.join(FIX, 'hwp', fs.readdirSync(path.join(FIX, 'hwp')).find((f) => f.endsWith('kaist_kaist-585.hwp'))));
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    rec('다크모드', '시스템 설정 따라 어두운 배경', bg !== 'rgb(244, 245, 247)', bg);
    await shot(page, 'dark-hwp');
    await page.context().close();
  },

  async '가로/확대'() {
    const { page } = await newPage({ viewport: { width: 860, height: 412 } });
    await openFile(page, path.join(FIX, 'complex.docx'));
    await shot(page, 'docx-landscape');
    // 확대: Ctrl+휠(두 손가락 확대와 같은 경로)로 배율이 바뀌는지
    const z0 = await page.evaluate(() => parseFloat(document.querySelector('.pages-wrap').style.zoom));
    await page.mouse.move(400, 200);
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -300); await page.keyboard.up('Control');
    await page.waitForTimeout(200);
    const z1 = await page.evaluate(() => parseFloat(document.querySelector('.pages-wrap').style.zoom));
    rec('가로/확대', '가로 화면 + 확대 동작', z1 > z0, `배율 ${z0.toFixed(2)} → ${z1.toFixed(2)}`);
    await page.context().close();
  },
};

for (const [name, fn] of Object.entries(tests)) {
  if (!want(name)) continue;
  try { await fn(); } catch (e) { rec(name, '시험 실행', false, 'EXCEPTION ' + String(e.message).slice(0, 300)); }
}

rec('보안', '앱 밖 주소로 나가는 요청', outside.size === 0, outside.size ? [...outside].slice(0, 5).join(', ') : '0건 (모든 요청이 앱 내부)');
rec('보안', 'CSP 위반 경고', cspViolations.length === 0, cspViolations.length ? cspViolations.slice(0, 3).join(' | ') : '0건');

const md = ['| 영역 | 항목 | 결과 | 상세 |', '|---|---|---|---|', ...rows.map((r) => `| ${r.area} | ${r.item} | ${r.pass ? '✅' : '❌'} | ${String(r.detail).replace(/\|/g, '/')} |`)].join('\n');
fs.writeFileSync(path.join(OUT, 'report.md'), md + '\n');
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(rows, null, 1));
console.log(`\n${rows.filter((r) => r.pass).length}/${rows.length} 통과`);
await browser.close();
server.close();
process.exit(rows.every((r) => r.pass) ? 0 : 1);

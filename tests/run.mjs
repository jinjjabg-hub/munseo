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

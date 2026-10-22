// 엑셀(.xlsx .xls .csv .ods): SheetJS로 읽고, 화면에 보이는 행·열만 그린다(수만 행도 가볍게).
import * as XLSX from 'xlsx';
import { corrupt, encrypted } from '../errors.js';
import { decodeText, extOf } from '../format.js';
import { attachPinch } from '../zoom.js';

const BASE = { rowH: 28, colHeadH: 24, rowHeadW: 46, font: 13 };
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const colName = (c) => {
  let s = '';
  for (c++; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return s;
};

// 한글·한자는 폭 2칸으로 센다
const textUnits = (t) => {
  let n = 0;
  for (const ch of t) n += ch.charCodeAt(0) > 0x2e80 ? 2 : 1;
  return n;
};

function readBook(buffer, name) {
  try {
    if (extOf(name) === 'csv') {
      return XLSX.read(decodeText(buffer), { type: 'string', dense: true, raw: false });
    }
    return XLSX.read(new Uint8Array(buffer), { type: 'array', dense: true, cellStyles: false, cellNF: false });
  } catch (e) {
    if (/password/i.test(String(e && e.message))) throw encrypted('암호가 걸린 엑셀 파일이에요. 암호를 푼 파일로 다시 열어주세요.');
    throw corrupt('엑셀 파일이 손상됐거나 읽을 수 없어요.');
  }
}

const cellText = (cell) => (!cell ? '' : cell.w != null ? String(cell.w) : cell.v == null ? '' : String(cell.v));
const sheetRange = (ws) => (ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } });

// 시트 하나를 화면에 그리는 일꾼
function makeSheetView(ws, host) {
  const ref = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  const R0 = ref.s.r, C0 = ref.s.c;
  const nRows = ref.e.r - R0 + 1;
  const nCols = ref.e.c - C0 + 1;
  const cellAt = (r, c) => {
    const row = ws[R0 + r];
    return row ? row[C0 + c] : undefined;
  };
  const textAt = (r, c) => {
    const cell = cellAt(r, c);
    if (!cell) return '';
    if (cell.w != null) return String(cell.w);
    return cell.v == null ? '' : String(cell.v);
  };

  // 열 너비: 파일에 있으면 그것, 없으면 앞쪽 행의 글자 길이로 추정
  const colW = new Array(nCols);
  const sample = Math.min(nRows, 200);
  const defs = ws['!cols'] || [];
  for (let c = 0; c < nCols; c++) {
    const d = defs[C0 + c];
    if (d && (d.wpx || d.wch)) colW[c] = d.wpx || Math.round(d.wch * 7 + 5);
    else {
      let m = 3;
      for (let r = 0; r < sample; r++) m = Math.max(m, Math.min(textUnits(textAt(r, c)), 48));
      colW[c] = m * 7.5 + 16;
    }
    colW[c] = Math.min(Math.max(colW[c], 36), 420);
  }

  // 병합 칸: 시작 칸에만 글자를 그리고 나머지는 건너뛴다
  const merges = (ws['!merges'] || []).map((m) => ({ r: m.s.r - R0, c: m.s.c - C0, rs: m.e.r - m.s.r + 1, cs: m.e.c - m.s.c + 1 }));
  const covered = new Map(); // "r,c" → true (시작 칸 제외)
  const origin = new Map(); // "r,c" → merge
  for (const m of merges) {
    if (m.rs * m.cs > 5000) continue;
    origin.set(m.r + ',' + m.c, m);
    for (let r = 0; r < m.rs; r++) for (let c = 0; c < m.cs; c++) if (r || c) covered.set(m.r + r + ',' + (m.c + c), true);
  }

  let hitSet = new Set(); // r * nCols + c
  let hitCur = -1;
  let z = 1;
  let colX = [];
  let totalW = 0;
  const rowH = () => BASE.rowH * z;
  const layoutCols = () => {
    colX = new Array(nCols + 1);
    let x = 0;
    for (let c = 0; c < nCols; c++) { colX[c] = x; x += colW[c] * z; }
    colX[nCols] = x;
    totalW = x;
  };

  const scroll = host;
  scroll.replaceChildren();
  const colHead = document.createElement('div');
  colHead.className = 'xl-colhead';
  const colHeadInner = document.createElement('div');
  colHeadInner.style.position = 'relative';
  const corner = document.createElement('div');
  corner.className = 'xl-corner';
  const colLabels = document.createElement('div');
  colLabels.style.cssText = 'position:absolute;left:0;top:0';
  colHeadInner.append(corner, colLabels);
  colHead.appendChild(colHeadInner);
  const body = document.createElement('div');
  body.className = 'xl-body';
  const rowHead = document.createElement('div');
  rowHead.className = 'xl-rowhead';
  rowHead.style.position = 'sticky';
  const rowHeadInner = document.createElement('div');
  rowHeadInner.style.position = 'relative';
  rowHead.appendChild(rowHeadInner);
  const cells = document.createElement('div');
  cells.className = 'xl-cells';
  body.append(rowHead, cells);
  scroll.append(colHead, body);

  const find = (arr, v) => {
    let lo = 0, hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid] <= v) lo = mid; else hi = mid - 1;
    }
    return lo;
  };

  let pending = false;
  let painted = null; // 지금 그려 둔 범위 {r0,r1,c0,c1,z}
  function paint(force = true) {
    pending = false;
    const rh = rowH();
    const hh = BASE.colHeadH * z, hw = BASE.rowHeadW * z;
    const viewW = scroll.clientWidth, viewH = scroll.clientHeight;
    const sl = Math.max(0, scroll.scrollLeft - hw), st = scroll.scrollTop;
    // 화면에 보이는 범위가 이미 그려 둔 범위 안이면 다시 그리지 않는다 (스크롤이 부드럽도록)
    const vr0 = Math.max(0, Math.floor(st / rh)), vr1 = Math.min(nRows - 1, Math.ceil((st + viewH) / rh));
    const vc0 = Math.max(0, find(colX, sl)), vc1 = Math.min(nCols - 1, find(colX, sl + viewW));
    if (!force && painted && painted.z === z && vr0 >= painted.r0 && vr1 <= painted.r1 && vc0 >= painted.c0 && vc1 <= painted.c1) return;
    const r0 = Math.max(0, vr0 - 40);
    const r1 = Math.min(nRows - 1, vr1 + 40);
    const c0 = Math.max(0, vc0 - 4);
    const c1 = Math.min(nCols - 1, vc1 + 4);
    painted = { r0, r1, c0, c1, z };
    const fs = BASE.font * z;
    const lh = rh;

    let h = '';
    const drawCell = (r, c, rs, cs) => {
      const x = colX[c], y = r * rh;
      const w = colX[Math.min(nCols, c + cs)] - x, hgt = rh * rs;
      const cell = cellAt(r, c);
      const t = textAt(r, c);
      const num = cell && cell.t === 'n' ? ' n' : '';
      const hk = r * nCols + c;
      const hit = hitSet.has(hk) ? (hk === hitCur ? ' hit cur' : ' hit') : '';
      h += `<div class="c${num}${hit}" style="left:${x}px;top:${y}px;width:${w}px;height:${hgt}px;line-height:${lh}px">${t ? esc(t) : ''}</div>`;
    };
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const key = r + ',' + c;
        if (covered.has(key)) continue;
        const m = origin.get(key);
        // 비어 있고 병합도 아니면 칸 선만 필요 — 그대로 그린다
        drawCell(r, c, m ? m.rs : 1, m ? m.cs : 1);
      }
    }
    // 병합 시작 칸이 화면 밖(위/왼쪽)에 있어도 보이는 부분은 그려 준다
    for (const m of merges) {
      if (m.rs * m.cs > 5000) continue;
      const inWin = m.r >= r0 && m.r <= r1 && m.c >= c0 && m.c <= c1;
      if (inWin) continue;
      if (m.r + m.rs - 1 < r0 || m.r > r1 || m.c + m.cs - 1 < c0 || m.c > c1) continue;
      drawCell(m.r, m.c, m.rs, m.cs);
    }
    cells.innerHTML = h;
    cells.style.font = `${fs}px/${lh}px system-ui, 'Noto Sans KR', sans-serif`;

    let ch = '';
    for (let c = c0; c <= c1; c++)
      ch += `<div class="h" style="left:${colX[c] + hw}px;top:0;width:${colX[c + 1] - colX[c]}px;height:${hh}px;line-height:${hh}px">${colName(C0 + c)}</div>`;
    colLabels.innerHTML = ch;
    colLabels.style.font = `${fs * 0.9}px system-ui, sans-serif`;
    let rhs = '';
    for (let r = r0; r <= r1; r++)
      rhs += `<div class="h" style="left:0;top:${r * rh}px;width:${hw}px;height:${rh}px;line-height:${rh}px">${R0 + r + 1}</div>`;
    rowHeadInner.innerHTML = rhs;
    rowHeadInner.style.font = `${fs * 0.9}px system-ui, sans-serif`;
  }
  const schedule = () => {
    if (!pending) { pending = true; requestAnimationFrame(() => paint(false)); }
  };

  function layout() {
    layoutCols();
    const hh = BASE.colHeadH * z, hw = BASE.rowHeadW * z;
    colHead.style.height = hh + 'px';
    colHeadInner.style.width = totalW + hw + 'px';
    colHeadInner.style.height = hh + 'px';
    corner.style.width = hw + 'px';
    corner.style.height = hh + 'px';
    body.style.width = totalW + hw + 'px';
    body.style.height = nRows * rowH() + 'px';
    rowHead.style.width = hw + 'px';
    rowHead.style.height = nRows * rowH() + 'px';
    rowHeadInner.style.height = nRows * rowH() + 'px';
    cells.style.left = hw + 'px';
    cells.style.width = totalW + 'px';
    cells.style.height = nRows * rowH() + 'px';
    paint();
  }
  scroll.addEventListener('scroll', schedule, { passive: true });
  layout();

  return {
    rows: nRows,
    getZoom: () => z,
    setZoom(next, mx = 0, my = 0) {
      const old = z;
      const fx = (scroll.scrollLeft + mx) / old, fy = (scroll.scrollTop + my) / old;
      z = next;
      layout();
      scroll.scrollLeft = fx * z - mx;
      scroll.scrollTop = fy * z - my;
      paint();
    },
    onResize: schedule,
    setHits(set, cur) { hitSet = set; hitCur = cur; paint(); },
    scrollToCell(r, c) {
      const hh = BASE.colHeadH * z, hw = BASE.rowHeadW * z;
      const x = hw + colX[c], y = hh + r * rowH();
      const w = colX[c + 1] - colX[c];
      const vw = scroll.clientWidth, vh = scroll.clientHeight;
      scroll.scrollTop = Math.max(0, y - vh / 2);
      if (x < scroll.scrollLeft + hw || x + w > scroll.scrollLeft + vw) scroll.scrollLeft = Math.max(0, x - vw / 2 + w / 2);
      paint();
    },
    cols: nCols,
    destroy() { scroll.removeEventListener('scroll', schedule); },
  };
}

export async function open(container, buffer, ctx = {}) {
  const wb = readBook(buffer, ctx.name || '');
  const names = wb.SheetNames.filter((n) => wb.Sheets[n]);
  if (!names.length) throw corrupt('엑셀 파일에서 시트를 찾지 못했어요.');

  const root = document.createElement('div');
  root.className = 'xl';
  const scroll = document.createElement('div');
  scroll.className = 'xl-scroll';
  scroll.tabIndex = 0;
  const tabs = document.createElement('div');
  tabs.className = 'xl-tabs';
  tabs.setAttribute('role', 'tablist');
  root.append(scroll, tabs);
  container.appendChild(root);

  let view = null;
  let zoom = 1;
  let curSheet = 0;
  const hitSets = names.map(() => new Set());
  let hits = [];
  let hitIdx = -1;
  const keyOf = (h) => h.r * view.cols + h.c;
  const show = (i) => {
    view?.destroy();
    curSheet = i;
    scroll.scrollTop = 0;
    scroll.scrollLeft = 0;
    view = makeSheetView(wb.Sheets[names[i]], scroll);
    if (zoom !== 1) view.setZoom(zoom);
    if (hits.length) view.setHits(hitSets[i], hitIdx >= 0 && hits[hitIdx].s === i ? keyOf(hits[hitIdx]) : -1);
    [...tabs.children].forEach((b, j) => b.setAttribute('aria-selected', String(i === j)));
    window.__perf = Object.assign(window.__perf || {}, { xlsxRows: view.rows, xlsxCols: view.cols });
  };
  names.forEach((n, i) => {
    const b = document.createElement('button');
    b.className = 'xl-tab';
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.textContent = n;
    b.addEventListener('click', () => show(i));
    tabs.appendChild(b);
  });
  if (names.length === 1) tabs.style.display = 'none';
  show(0);

  // ---- 검색: 모든 시트의 칸 글자를 훑는다 ----
  const norm = (t) => t.normalize('NFC').toLowerCase();
  async function find(query) {
    const q = norm(query.trim());
    hits = [];
    hitIdx = -1;
    hitSets.forEach((st) => st.clear());
    if (!q) { view.setHits(hitSets[curSheet], -1); return { count: 0, index: -1 }; }
    let budget = 0;
    outer: for (let si = 0; si < names.length; si++) {
      const ws = wb.Sheets[names[si]];
      const ref = sheetRange(ws);
      const nCols = ref.e.c - ref.s.c + 1;
      for (let r = 0; r <= ref.e.r - ref.s.r; r++) {
        const row = ws[ref.s.r + r];
        if (!row) continue;
        for (let c = 0; c < nCols; c++) {
          const t = cellText(row[ref.s.c + c]);
          if (t && norm(t).includes(q)) {
            hits.push({ s: si, r, c });
            hitSets[si].add(r * nCols + c);
            if (hits.length >= 5000) break outer;
          }
        }
        if (++budget % 4000 === 0) await new Promise((res) => setTimeout(res, 0));
      }
    }
    if (hits.length) return go(0);
    view.setHits(hitSets[curSheet], -1);
    return { count: 0, index: -1 };
  }
  function go(i) {
    if (!hits.length) return { count: 0, index: -1 };
    hitIdx = (i + hits.length) % hits.length;
    const h = hits[hitIdx];
    if (h.s !== curSheet) show(h.s);
    view.setHits(hitSets[h.s], keyOf(h));
    view.scrollToCell(h.r, h.c);
    return { count: hits.length, index: hitIdx };
  }
  const search = {
    find,
    next: async () => go(hitIdx + 1),
    prev: async () => go(hitIdx - 1),
    clear: async () => { hits = []; hitIdx = -1; hitSets.forEach((st) => st.clear()); view.setHits(hitSets[curSheet], -1); },
  };

  const detachPinch = attachPinch(scroll, {
    min: 0.5, max: 4,
    get: () => view.getZoom(),
    preview: () => {},
    commit: (next, m) => {
      const r = scroll.getBoundingClientRect();
      zoom = next;
      view.setZoom(next, m.x - r.left, m.y - r.top);
    },
  });
  const onResize = () => view?.onResize();
  window.addEventListener('resize', onResize);

  // PDF 저장용: 전체 시트를 정적 표로 (행이 너무 많으면 앞부분만)
  const PRINT_ROW_LIMIT = 3000;
  async function print() {
    const root = document.createElement('div');
    root.className = 'xl-print';
    let truncated = false;
    for (let si = 0; si < names.length; si++) {
      const ws = wb.Sheets[names[si]];
      const ref = sheetRange(ws);
      const nRows = ref.e.r - ref.s.r + 1, nCols = ref.e.c - ref.s.c + 1;
      const rows = Math.min(nRows, PRINT_ROW_LIMIT);
      if (nRows > rows) truncated = true;
      const h = document.createElement('h3');
      h.textContent = names[si];
      let html = '<table>';
      for (let r = 0; r < rows; r++) {
        const row = ws[ref.s.r + r];
        html += '<tr>';
        for (let c = 0; c < nCols; c++) html += `<td>${esc(cellText(row && row[ref.s.c + c]))}</td>`;
        html += '</tr>';
      }
      const wrap = document.createElement('div');
      wrap.className = 'xl-print-sheet';
      wrap.append(h);
      wrap.insertAdjacentHTML('beforeend', html + '</table>');
      if (nRows > rows) wrap.insertAdjacentHTML('beforeend', `<p class="xl-print-note">행이 많아서 앞 ${rows.toLocaleString()}행만 저장했어요. (전체 ${nRows.toLocaleString()}행)</p>`);
      root.append(wrap);
      if (si % 2) await new Promise((res) => setTimeout(res, 0));
    }
    return { node: root, orientation: 'landscape', note: truncated ? `행이 많은 시트는 앞 ${PRINT_ROW_LIMIT.toLocaleString()}행만 저장했어요.` : '' };
  }

  return {
    kind: 'xlsx',
    search,
    printable: true,
    print,
    sheets: names.length,
    destroy() {
      detachPinch();
      window.removeEventListener('resize', onResize);
      view?.destroy();
      container.replaceChildren();
    },
  };
}

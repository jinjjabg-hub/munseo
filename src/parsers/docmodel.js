// 한글 문서 모델 → HTML / 평문 (hwp, hwpx 공용)
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function blocksToHtml(blocks) {
  let html = '';
  let emptyRun = 0;
  for (const b of blocks) {
    if (b.t === 'p') {
      if (b.text.trim() === '') {
        if (++emptyRun <= 1) html += '<p class="hw-empty"></p>';
        continue;
      }
      emptyRun = 0;
      html += `<p>${esc(b.text).replace(/\n/g, '<br>').replace(/\t/g, '&emsp;')}</p>`;
    } else if (b.t === 'table') {
      emptyRun = 0;
      html += tableHtml(b);
    } else if (b.t === 'box') {
      emptyRun = 0;
      const inner = blocksToHtml(b.blocks);
      if (inner.replace(/<p class="hw-empty"><\/p>/g, '') === '') continue;
      const cls = b.label ? 'hw-note' : 'hw-box';
      html += `<div class="${cls}">${b.label ? `<span class="hw-label">${b.label}</span>` : ''}${inner}</div>`;
    } else if (b.t === 'obj') {
      emptyRun = 0;
      html += b.text
        ? `<p class="hw-obj"><span class="hw-label">${b.label}</span> <code>${esc(b.text)}</code></p>`
        : `<p class="hw-obj"><span class="hw-label">[${b.label}]</span></p>`;
    }
  }
  return html;
}

function tableHtml(t) {
  const byRow = new Map();
  for (const c of t.cells) {
    if (!byRow.has(c.r)) byRow.set(c.r, []);
    byRow.get(c.r).push(c);
  }
  let html = '<div class="hw-table-wrap"><table class="hw-table">';
  for (const r of [...byRow.keys()].sort((a, b) => a - b)) {
    html += '<tr>';
    for (const c of byRow.get(r).sort((a, b) => a.c - b.c)) {
      const span = (c.cs > 1 ? ` colspan="${c.cs}"` : '') + (c.rs > 1 ? ` rowspan="${c.rs}"` : '');
      html += `<td${span}>${blocksToHtml(c.blocks).replace(/<p class="hw-empty"><\/p>/g, '')}</td>`;
    }
    html += '</tr>';
  }
  return html + '</table></div>';
}

export function blocksToText(blocks, indent = '') {
  const lines = [];
  for (const b of blocks) {
    if (b.t === 'p') lines.push(indent + b.text.replace(/\n/g, '\n' + indent));
    else if (b.t === 'table') {
      const byRow = new Map();
      for (const c of b.cells) {
        if (!byRow.has(c.r)) byRow.set(c.r, []);
        byRow.get(c.r).push(c);
      }
      for (const r of [...byRow.keys()].sort((a, c) => a - c))
        lines.push(
          indent + '| ' + byRow.get(r).sort((a, c) => a.c - c.c)
            .map((c) => blocksToText(c.blocks).replace(/\n+/g, ' / ')).join(' | ') + ' |'
        );
    } else if (b.t === 'box') {
      lines.push(indent + `<${b.label || '글상자'}>`);
      lines.push(blocksToText(b.blocks, indent + '  '));
    } else if (b.t === 'obj') lines.push(indent + `[${b.label}]${b.text ? ' ' + b.text : ''}`);
  }
  return lines.join('\n');
}

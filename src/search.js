// 문서 안 글자 검색 (화면에 글자가 DOM으로 있는 뷰어 공용: 한글·워드·파워포인트·텍스트 …)
// 줄바꿈·서식 때문에 글자가 여러 조각으로 나뉘어 있어도, 같은 문단 안이면 찾는다.
const BLOCK = 'p,li,td,th,h1,h2,h3,h4,h5,h6,pre,div,section,article,dt,dd,caption,blockquote,tr';
const MAX_HITS = 3000;

const norm = (s) => s.normalize('NFC').toLowerCase();

export function createDomSearch(root, scroller) {
  let groups = []; // 각 결과 = 감싼 <mark> 목록
  let index = -1;

  function clear() {
    for (const g of groups) {
      for (const m of g) {
        const parent = m.parentNode;
        if (!parent) continue;
        while (m.firstChild) parent.insertBefore(m.firstChild, m);
        parent.removeChild(m);
        parent.normalize();
      }
    }
    groups = [];
    index = -1;
  }

  function textNodesByBlock() {
    const map = new Map();
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue && !/^(SCRIPT|STYLE)$/.test(n.parentNode.nodeName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const block = n.parentElement.closest(BLOCK) || root;
      if (!map.has(block)) map.set(block, []);
      map.get(block).push(n);
    }
    return map;
  }

  function wrapRange(node, a, b, id) {
    const r = document.createRange();
    r.setStart(node, a);
    r.setEnd(node, b);
    const mark = document.createElement('mark');
    mark.className = 'find-hit';
    mark.dataset.m = String(id);
    r.surroundContents(mark);
    return mark;
  }

  function find(query) {
    clear();
    const q = norm(query.trim());
    if (!q) return { count: 0, index: -1 };
    for (const [, nodes] of textNodesByBlock()) {
      if (groups.length >= MAX_HITS) break;
      // 문단 안 글자를 이어 붙이고, 각 글자가 어느 노드 몇 번째인지 기억한다
      const parts = nodes.map((n) => n.nodeValue);
      const joined = parts.join('');
      const lower = norm(joined);
      if (lower.length !== joined.length) continue; // 정규화로 길이가 바뀌면 건너뜀(드문 경우)
      const starts = [];
      let acc = 0;
      for (const p of parts) { starts.push(acc); acc += p.length; }
      const matches = [];
      for (let from = 0; ; ) {
        const at = lower.indexOf(q, from);
        if (at < 0) break;
        matches.push(at);
        from = at + q.length;
      }
      // 뒤에서부터 감싸야 앞쪽 위치가 어긋나지 않는다
      const made = [];
      for (let mi = matches.length - 1; mi >= 0; mi--) {
        const s = matches[mi];
        const e = s + q.length;
        const g = [];
        for (let ni = nodes.length - 1; ni >= 0; ni--) {
          const ns = starts[ni];
          const ne = ns + parts[ni].length;
          if (ne <= s || ns >= e) continue;
          g.unshift(wrapRange(nodes[ni], Math.max(s, ns) - ns, Math.min(e, ne) - ns, 0));
        }
        if (g.length) made.unshift(g);
      }
      groups.push(...made);
    }
    // 문서 순서대로 정렬
    groups.sort((a, b) => (a[0].compareDocumentPosition(b[0]) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    groups = groups.slice(0, MAX_HITS);
    if (groups.length) go(0);
    return { count: groups.length, index };
  }

  function go(i) {
    if (!groups.length) return { count: 0, index: -1 };
    if (index >= 0 && groups[index]) groups[index].forEach((m) => m.classList.remove('cur'));
    index = (i + groups.length) % groups.length;
    groups[index].forEach((m) => m.classList.add('cur'));
    groups[index][0].scrollIntoView({ block: 'center', inline: 'center' });
    return { count: groups.length, index };
  }

  return {
    find: async (q) => find(q),
    next: async () => go(index + 1),
    prev: async () => go(index - 1),
    clear: async () => clear(),
  };
}

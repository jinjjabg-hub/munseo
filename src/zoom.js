// 두 손가락 확대/축소. 제스처 중에는 transform으로 부드럽게, 손을 떼면 한 번에 반영한다.
const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// el: 스크롤 영역. opts: { get(): 현재배율, min, max, preview(k, mid), commit(newScale, mid), cancel() }
export function attachPinch(el, opts) {
  const { min = 0.25, max = 6 } = opts;
  let st = null;

  const onStart = (e) => {
    if (e.touches.length === 2) st = { d: dist(e.touches), s: opts.get(), mid: mid(e.touches), k: 1 };
  };
  const onMove = (e) => {
    if (!st || e.touches.length !== 2) return;
    e.preventDefault();
    const target = clamp((st.s * dist(e.touches)) / st.d, min, max);
    st.k = target / st.s;
    st.mid = mid(e.touches);
    opts.preview(st.k, st.mid);
  };
  const onEnd = (e) => {
    if (st && e.touches.length < 2) {
      const s = st;
      st = null;
      opts.commit(clamp(s.s * s.k, min, max), s.mid);
    }
  };
  const onWheel = (e) => {
    // 컴퓨터에서 Ctrl+휠로 시험할 때
    if (!e.ctrlKey) return;
    e.preventDefault();
    opts.commit(clamp(opts.get() * (e.deltaY < 0 ? 1.1 : 1 / 1.1), min, max), { x: e.clientX, y: e.clientY });
  };
  el.addEventListener('touchstart', onStart, { passive: true });
  el.addEventListener('touchmove', onMove, { passive: false });
  el.addEventListener('touchend', onEnd, { passive: true });
  el.addEventListener('touchcancel', onEnd, { passive: true });
  el.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    el.removeEventListener('touchstart', onStart);
    el.removeEventListener('touchmove', onMove);
    el.removeEventListener('touchend', onEnd);
    el.removeEventListener('touchcancel', onEnd);
    el.removeEventListener('wheel', onWheel);
  };
}

// CSS zoom으로 확대하는 일반 문서용(한글·워드·파워포인트).
// content: 스크롤 영역 안의 내용 덩어리. fixed=쪽·슬라이드처럼 폭이 고정인 내용(가로 스크롤), fit=처음에 폭에 맞춘다.
export function makeZoomable(scroller, content, { fit = false, fixed = false, min = 0.25, max = 6 } = {}) {
  let zoom = 1;
  let touched = false;
  // 제스처 중 transform은 확대 안 된 바깥 상자에 건다 (CSS zoom과 좌표가 섞이지 않게)
  const outer = document.createElement('div');
  outer.style.width = fixed ? 'max-content' : '100%';
  outer.style.minWidth = '100%';
  content.replaceWith(outer);
  outer.appendChild(content);
  const apply = (z) => {
    zoom = z;
    content.style.zoom = String(z);
  };
  const fitWidth = () => {
    content.style.zoom = '1';
    const w = content.scrollWidth;
    const avail = scroller.clientWidth;
    apply(w > 0 ? clamp(avail / w, min, 1) : 1);
  };
  if (fit) fitWidth();

  const detach = attachPinch(scroller, {
    min, max,
    get: () => zoom,
    preview: (k, m) => {
      const r = scroller.getBoundingClientRect();
      outer.style.transformOrigin = `${scroller.scrollLeft + m.x - r.left}px ${scroller.scrollTop + m.y - r.top}px`;
      outer.style.transform = `scale(${k})`;
    },
    commit: (next, m) => {
      touched = true;
      outer.style.transform = '';
      outer.style.transformOrigin = '';
      const r = scroller.getBoundingClientRect();
      const fx = (scroller.scrollLeft + m.x - r.left) / zoom;
      const fy = (scroller.scrollTop + m.y - r.top) / zoom;
      apply(next);
      scroller.scrollLeft = fx * next - (m.x - r.left);
      scroller.scrollTop = fy * next - (m.y - r.top);
    },
  });
  const onResize = () => { if (fit && !touched) fitWidth(); };
  window.addEventListener('resize', onResize);
  return {
    get: () => zoom,
    fitWidth,
    destroy() { detach(); window.removeEventListener('resize', onResize); },
  };
}

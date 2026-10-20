// 오래된 안드로이드 웹뷰(크롬 100번대)에 없는 기능을 채운다. (pdf.js 등 최신 라이브러리가 쓴다)
if (!Promise.withResolvers) {
  Promise.withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}
if (!Object.groupBy) {
  Object.groupBy = (items, fn) => {
    const out = Object.create(null);
    let i = 0;
    for (const it of items) (out[fn(it, i++)] ||= []).push(it);
    return out;
  };
}
if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, 'at', { value(n) { n = Math.trunc(n) || 0; if (n < 0) n += this.length; return this[n]; }, configurable: true, writable: true });
}
if (!Array.prototype.toSorted) {
  Object.defineProperty(Array.prototype, 'toSorted', { value(f) { return [...this].sort(f); }, configurable: true, writable: true });
}
if (!Array.fromAsync) {
  Array.fromAsync = async (it) => { const o = []; for await (const x of it) o.push(x); return o; };
}
if (typeof URL !== 'undefined' && !URL.parse) {
  URL.parse = (u, b) => { try { return new URL(u, b); } catch { return null; } };
}
if (typeof structuredClone === 'undefined') {
  globalThis.structuredClone = (v) => JSON.parse(JSON.stringify(v));
}

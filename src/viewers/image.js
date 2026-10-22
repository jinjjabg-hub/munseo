// 이미지(.png .jpg .jpeg .webp .gif): 화면 폭에 맞춰 보여주고 두 손가락으로 확대
import { corrupt } from '../errors.js';
import { makeZoomable } from '../zoom.js';

const MIME = (b) => {
  if (b[0] === 0x89) return 'image/png';
  if (b[0] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47) return 'image/gif';
  return 'image/webp';
};

export async function open(container, buffer) {
  const url = URL.createObjectURL(new Blob([buffer], { type: MIME(new Uint8Array(buffer, 0, 4)) }));
  const scroller = document.createElement('div');
  scroller.className = 'scroller img-scroller';
  scroller.tabIndex = 0;
  const wrap = document.createElement('div');
  wrap.className = 'img-wrap';
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  wrap.appendChild(img);
  scroller.appendChild(wrap);
  container.appendChild(scroller);
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(corrupt('이미지를 읽을 수 없어요. 파일이 손상됐을 수 있어요.'));
    img.src = url;
  });
  const zoomer = makeZoomable(scroller, wrap, { fit: true, fixed: true, min: 0.05, max: 10 });
  return {
    kind: 'image',
    destroy() {
      zoomer.destroy();
      URL.revokeObjectURL(url);
      container.replaceChildren();
    },
  };
}

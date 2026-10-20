// 워드(.docx): docx-preview로 쪽 모양 그대로, 실패하면 mammoth 읽기 모드로.
import { renderAsync } from 'docx-preview';
import { corrupt } from '../errors.js';
import { makeZoomable } from '../zoom.js';

async function renderReflow(scroller, buffer) {
  const mammoth = (await import('mammoth/mammoth.browser.js')).default;
  const { value, messages } = await mammoth.convertToHtml({ arrayBuffer: buffer });
  if (!value.trim()) throw new Error('empty');
  const doc = document.createElement('div');
  doc.className = 'reflow';
  doc.innerHTML = value;
  scroller.replaceChildren(doc);
  return { messages };
}

export async function open(container, buffer, ctx = {}) {
  const scroller = document.createElement('div');
  scroller.className = 'scroller';
  scroller.tabIndex = 0;
  container.appendChild(scroller);

  let zoomer = null;
  let mode = 'page';

  async function showPage() {
    const content = document.createElement('div');
    content.className = 'pages-wrap';
    // docx-preview는 렌더 직전에 스타일 컨테이너를 비우므로, 본문 밖에 따로 둔다
    const styles = document.createElement('div');
    scroller.replaceChildren(styles, content);
    await renderAsync(buffer, content, styles, {
      className: 'docx',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      ignoreFonts: false,
      breakPages: true,
      ignoreLastRenderedPageBreak: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      useBase64URL: true,
    });
    if (!content.querySelector('section.docx, .docx')) throw new Error('no pages');
    zoomer = makeZoomable(scroller, content, { fit: true, fixed: true });
    mode = 'page';
  }

  async function showReflow() {
    zoomer?.destroy();
    zoomer = null;
    await renderReflow(scroller, buffer);
    const doc = scroller.firstChild;
    zoomer = makeZoomable(scroller, doc, { fit: false });
    mode = 'reflow';
  }

  try {
    await showPage();
  } catch (e) {
    try {
      await showReflow();
    } catch {
      throw corrupt('워드 파일이 손상됐거나 읽을 수 없어요.');
    }
  }

  const toggle = async () => {
    scroller.replaceChildren();
    zoomer?.destroy();
    try {
      if (mode === 'page') await showReflow();
      else await showPage();
    } catch {
      /* 실패하면 이전 모드 유지 */
      try { mode === 'page' ? await showPage() : await showReflow(); } catch { /* ignore */ }
    }
    ctx.setActions?.([{ label: mode === 'page' ? '읽기 모드' : '원본 모양', onClick: toggle }]);
  };
  ctx.setActions?.([{ label: mode === 'page' ? '읽기 모드' : '원본 모양', onClick: toggle }]);

  return {
    kind: 'docx',
    destroy() {
      zoomer?.destroy();
      container.replaceChildren();
    },
  };
}

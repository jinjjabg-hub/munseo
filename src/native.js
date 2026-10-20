// 안드로이드(Capacitor) 연결부: 다른 앱에서 탭해서 열린 파일을 받는다.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { ViewerError } from './errors.js';

const FileOpen = registerPlugin('FileOpen');
export const isNative = Capacitor.isNativePlatform();

const seen = new Set();

// handler({ name, size, getBuffer })
export async function listenNativeOpen(handler) {
  if (!isNative) return;
  const emit = (info) => {
    if (!info || !info.id || seen.has(info.id)) return;
    if (!info.path && !info.error) return;
    seen.add(info.id);
    handler({
      name: info.name || '문서',
      size: info.size,
      mime: info.mime,
      getBuffer: async () => {
        if (info.error) throw new ViewerError('corrupt', info.error);
        const res = await fetch(Capacitor.convertFileSrc('file://' + info.path));
        if (!res.ok) throw new Error('파일을 읽지 못했어요.');
        return res.arrayBuffer();
      },
    });
  };
  await FileOpen.addListener('fileOpened', emit);
  try {
    emit(await FileOpen.getPending());
  } catch {
    /* 대기 중인 파일 없음 */
  }
}

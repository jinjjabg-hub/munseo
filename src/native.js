// 안드로이드(Capacitor) 연결부: 다른 앱에서 탭해서 열린 파일 받기, 파일 고르기, PDF 만들기·저장·공유
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { ViewerError } from './errors.js';

export const FileOpen = registerPlugin('FileOpen');
export const isNative = Capacitor.isNativePlatform();

const seen = new Set();

// handler({ name, size, path, getBuffer })
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
      path: info.path,
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

// 파일 앱(문서 선택 화면)을 열어 고른다. 고른 파일은 listenNativeOpen 으로 들어온다.
export const pickNative = () => FileOpen.pick();

// 화면의 인쇄용 내용을 PDF 파일로 만든다 → { path, pages }
export const printToPdf = (name, landscape) => FileOpen.printToPdf({ name, landscape });

// 권한 없이 Documents 폴더에 저장 → { location }
export const saveToDocuments = (path, name) => FileOpen.saveToDocuments({ path, name });

// 공유 시트 (path: 앱 캐시 안 파일)
export async function sharePath(path, title) {
  await Share.share({ title, url: 'file://' + path });
}

// 열어 둔 PDF를 원래 이름으로 복사한 뒤 공유 시트
export async function shareOriginal(path, name) {
  const r = await FileOpen.copyForShare({ path, name });
  await sharePath(r.path, name);
}

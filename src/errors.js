// 사용자에게 한 줄로 보여줄 오류 종류
export class ViewerError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'encrypted' | 'unsupported' | 'corrupt'
  }
}

export const encrypted = (msg = '암호가 걸린 문서예요. 암호를 푼 파일로 다시 열어주세요.') =>
  new ViewerError('encrypted', msg);
export const unsupported = (ext) =>
  new ViewerError('unsupported', `이 형식은 아직 지원하지 않아요: ${ext ? '.' + ext : '(알 수 없음)'}`);
export const corrupt = (msg = '파일이 손상됐거나 읽을 수 없어요.') =>
  new ViewerError('corrupt', msg);

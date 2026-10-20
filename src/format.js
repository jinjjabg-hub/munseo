// 파일 이름(확장자)과 내용(앞부분)으로 형식을 판별한다. 확장자가 틀려도 내용으로 바로잡는다.
import { unsupported, encrypted } from './errors.js';

const EXT = {
  pdf: 'pdf',
  hwp: 'hwp', hwpx: 'hwpx',
  docx: 'docx',
  xlsx: 'xlsx', xlsm: 'xlsx', xls: 'xlsx', csv: 'xlsx', ods: 'xlsx',
  pptx: 'pptx',
};

const LABEL = { pdf: 'PDF', hwp: '한글', hwpx: '한글', docx: '워드', xlsx: '엑셀', pptx: '파워포인트' };

export const extOf = (name) => {
  const m = /\.([^.\\/]+)$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
};

const startsWith = (u8, sig) => sig.every((b, i) => u8[i] === b);
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

// 반환: { kind, label, ext }
export async function detect(name, buffer) {
  const ext = extOf(name);
  const u8 = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4096));
  let kind = EXT[ext];

  if (startsWith(u8, [0x25, 0x50, 0x44, 0x46]) || new TextDecoder('latin1').decode(u8).includes('%PDF-')) {
    if (kind !== 'pdf' && ext !== 'txt') kind = 'pdf';
  } else if (startsWith(u8, CFB_MAGIC)) {
    // 옛 형식(hwp, xls, doc, ppt) 또는 암호 걸린 OOXML(EncryptedPackage)
    const { default: CFB } = await import('cfb');
    let cfb;
    try { cfb = CFB.read(new Uint8Array(buffer), { type: 'array' }); } catch { cfb = null; }
    const has = (n) => cfb && cfb.FullPaths.some((p) => p.endsWith('/' + n));
    if (has('EncryptedPackage')) throw encrypted();
    if (has('FileHeader') && has('BodyText') ) kind = 'hwp';
    else if (has('FileHeader')) kind = 'hwp';
    else if (has('Workbook') || has('Book')) kind = 'xlsx';
    else if (has('WordDocument')) kind = 'doc';
    else if (has('PowerPoint Document')) kind = 'ppt';
    else if (ext === 'hwp') kind = 'hwp';
  } else if (startsWith(u8, ZIP)) {
    if (!['docx', 'xlsx', 'pptx', 'hwpx'].includes(kind)) {
      const { default: JSZip } = await import('jszip');
      try {
        const zip = await JSZip.loadAsync(buffer);
        const names = Object.keys(zip.files);
        if (names.some((n) => n.startsWith('word/'))) kind = 'docx';
        else if (names.some((n) => n.startsWith('xl/'))) kind = 'xlsx';
        else if (names.some((n) => n.startsWith('ppt/'))) kind = 'pptx';
        else if (names.some((n) => /^Contents\/section\d+\.xml$/i.test(n))) kind = 'hwpx';
        else if (names.includes('content.xml') && ext === 'ods') kind = 'xlsx';
      } catch { /* 깨진 zip은 각 뷰어가 안내 */ }
    }
  }

  if (!kind || !LABEL[kind]) throw unsupported(ext || kind);
  return { kind, label: LABEL[kind], ext };
}

export function humanSize(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

// CSV/텍스트: UTF-8이 아니면 한국어 윈도 인코딩(CP949)으로 읽는다
export function decodeText(buffer) {
  const u8 = new Uint8Array(buffer);
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('euc-kr').decode(u8);
  }
}

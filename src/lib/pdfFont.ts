import jsPDF from 'jspdf';

const KOREAN_FONT_FILE = 'NanumGothic-Regular.ttf';
const KOREAN_FONT_NAME = 'NanumGothic';

let cachedFontBase64Promise: Promise<string> | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

async function loadKoreanFontBase64() {
  if (!cachedFontBase64Promise) {
    cachedFontBase64Promise = fetch(`/fonts/${KOREAN_FONT_FILE}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error('PDF 폰트를 불러오지 못했습니다.');
        }
        return response.arrayBuffer();
      })
      .then(arrayBufferToBase64);
  }

  return cachedFontBase64Promise;
}

export async function registerKoreanPdfFont(doc: jsPDF) {
  const fontBase64 = await loadKoreanFontBase64();
  doc.addFileToVFS(KOREAN_FONT_FILE, fontBase64);
  doc.addFont(KOREAN_FONT_FILE, KOREAN_FONT_NAME, 'normal');
  doc.setFont(KOREAN_FONT_NAME, 'normal');

  return KOREAN_FONT_NAME;
}

import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// PDF 한글 글꼴 지도(cmaps) 등은 인터넷 없이 쓰도록 앱에 같이 넣는다
function copyPdfAssets() {
  return {
    name: 'copy-pdfjs-assets',
    writeBundle(opts) {
      const src = path.resolve('node_modules/pdfjs-dist');
      const out = path.resolve(opts.dir || 'www', 'pdfjs');
      for (const d of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
        fs.cpSync(path.join(src, d), path.join(out, d), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  base: './',
  build: { outDir: 'www', emptyOutDir: true, target: 'es2020', chunkSizeWarningLimit: 2500 },
  plugins: [copyPdfAssets()],
  worker: { format: 'es' },
});

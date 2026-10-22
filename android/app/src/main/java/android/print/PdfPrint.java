package android.print;

import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import java.io.File;

/**
 * WebView가 화면(인쇄용 CSS가 적용된 문서)을 PDF 파일로 만들게 한다.
 * PrintDocumentAdapter의 콜백 클래스 생성자가 패키지 전용이라 같은 패키지(android.print)에 둔다.
 */
public class PdfPrint {
    public interface Callback {
        void onSuccess(int pages);
        void onFailure(String message);
    }

    public static void print(final PrintDocumentAdapter adapter, PrintAttributes attrs, final File out, final Callback cb) {
        adapter.onStart();
        adapter.onLayout(null, attrs, null, new PrintDocumentAdapter.LayoutResultCallback() {
            @Override
            public void onLayoutFinished(final PrintDocumentInfo info, boolean changed) {
                try {
                    final ParcelFileDescriptor fd = ParcelFileDescriptor.open(
                        out,
                        ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE | ParcelFileDescriptor.MODE_READ_WRITE);
                    adapter.onWrite(new PageRange[] {PageRange.ALL_PAGES}, fd, new CancellationSignal(), new PrintDocumentAdapter.WriteResultCallback() {
                        @Override
                        public void onWriteFinished(PageRange[] pages) {
                            try { fd.close(); } catch (Exception ignored) { /* 닫기 실패는 무시 */ }
                            adapter.onFinish();
                            cb.onSuccess(info != null ? info.getPageCount() : -1);
                        }

                        @Override
                        public void onWriteFailed(CharSequence error) {
                            try { fd.close(); } catch (Exception ignored) { /* 무시 */ }
                            adapter.onFinish();
                            cb.onFailure(error != null ? error.toString() : "write failed");
                        }
                    });
                } catch (Exception e) {
                    cb.onFailure(e.getMessage());
                }
            }

            @Override
            public void onLayoutFailed(CharSequence error) {
                cb.onFailure(error != null ? error.toString() : "layout failed");
            }
        }, null);
    }
}

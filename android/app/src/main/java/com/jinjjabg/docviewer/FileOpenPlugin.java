package com.jinjjabg.docviewer;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.print.PdfPrint;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.webkit.WebView;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Locale;
import java.util.UUID;

/**
 * 다른 앱(파일 앱 등)에서 "열기"로 넘어온 문서를 웹 화면에 전달하고,
 * 문서를 PDF로 만들어 저장·공유하는 데 필요한 안드로이드 기능을 묶어 둔다.
 * - 앱이 켜져 있으면 fileOpened 이벤트로, 막 시작했다면 getPending()으로 받는다.
 */
@CapacitorPlugin(name = "FileOpen")
public class FileOpenPlugin extends Plugin {
    private static FileOpenPlugin instance;
    private static JSObject pending;

    @Override
    public void load() {
        instance = this;
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        JSObject res = pending != null ? pending : new JSObject();
        pending = null;
        call.resolve(res);
    }

    /** 파일 앱(문서 선택 화면)을 열어 문서를 고른다. 고른 문서는 fileOpened 이벤트로 들어온다. */
    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        startActivityForResult(call, intent, "pickResult");
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() == Activity.RESULT_OK && data != null && data.getData() != null) {
            importAsync(getActivity(), data.getData());
        }
        call.resolve();
    }

    /** 화면에 준비해 둔 인쇄용 내용을 PDF 파일(앱 캐시)로 만든다. */
    @PluginMethod
    public void printToPdf(final PluginCall call) {
        final String base = safeName(call.getString("name", "문서"));
        final boolean landscape = Boolean.TRUE.equals(call.getBoolean("landscape", false));
        getActivity().runOnUiThread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "share");
                if (!dir.exists()) dir.mkdirs();
                trimOld(dir, 6);
                final File out = new File(dir, base + ".pdf");
                WebView wv = getBridge().getWebView();
                PrintDocumentAdapter adapter = wv.createPrintDocumentAdapter(base);
                PrintAttributes.MediaSize size = landscape ? PrintAttributes.MediaSize.ISO_A4.asLandscape() : PrintAttributes.MediaSize.ISO_A4;
                PrintAttributes.Margins margins = landscape ? new PrintAttributes.Margins(200, 200, 200, 200) : new PrintAttributes.Margins(400, 400, 400, 400);
                PrintAttributes attrs = new PrintAttributes.Builder()
                    .setMediaSize(size)
                    .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 300, 300))
                    .setMinMargins(margins)
                    .build();
                PdfPrint.print(adapter, attrs, out, new PdfPrint.Callback() {
                    @Override
                    public void onSuccess(int pages) {
                        JSObject r = new JSObject();
                        r.put("path", out.getAbsolutePath());
                        r.put("pages", pages);
                        r.put("size", out.length());
                        call.resolve(r);
                    }

                    @Override
                    public void onFailure(String message) {
                        call.reject("PDF를 만들지 못했어요: " + message);
                    }
                });
            } catch (Exception e) {
                call.reject("PDF를 만들지 못했어요: " + e.getMessage());
            }
        });
    }

    /**
     * 만들어 둔 PDF를 Documents 폴더에 저장한다.
     * 안드로이드 10 이상은 MediaStore로 저장해서 저장소 권한이 필요 없다.
     */
    @PluginMethod
    public void saveToDocuments(PluginCall call) {
        final String path = call.getString("path");
        final String name = safeName(call.getString("name", "문서.pdf"));
        if (path == null) { call.reject("path required"); return; }
        new Thread(() -> {
            try {
                File src = new File(path);
                String location;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver cr = getContext().getContentResolver();
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, "application/pdf");
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOCUMENTS);
                    Uri uri = cr.insert(MediaStore.Files.getContentUri("external"), v);
                    if (uri == null) throw new IllegalStateException("저장 위치를 만들지 못했어요");
                    try (InputStream in = new java.io.FileInputStream(src); OutputStream os = cr.openOutputStream(uri)) {
                        copy(in, os);
                    }
                    String shown = name;
                    try (Cursor c = cr.query(uri, new String[] {MediaStore.MediaColumns.DISPLAY_NAME}, null, null, null)) {
                        if (c != null && c.moveToFirst()) shown = c.getString(0);
                    }
                    location = Environment.DIRECTORY_DOCUMENTS + "/" + shown;
                } else {
                    // 안드로이드 9 이하: 저장소 권한 없이 쓸 수 있는 앱 전용 문서 폴더
                    File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS);
                    if (dir == null) dir = getContext().getFilesDir();
                    dir.mkdirs();
                    File dst = new File(dir, name);
                    try (InputStream in = new java.io.FileInputStream(src); OutputStream os = new FileOutputStream(dst)) {
                        copy(in, os);
                    }
                    location = dst.getAbsolutePath();
                }
                JSObject r = new JSObject();
                r.put("location", location);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("저장하지 못했어요: " + e.getMessage());
            }
        }, "munseo-save").start();
    }

    /** 공유할 때 받는 쪽에 보이는 파일 이름이 원래 문서 이름이 되도록 앱 캐시에 복사해 둔다. */
    @PluginMethod
    public void copyForShare(PluginCall call) {
        final String path = call.getString("path");
        final String name = safeName(call.getString("name", "문서.pdf"));
        if (path == null) { call.reject("path required"); return; }
        new Thread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "share");
                if (!dir.exists()) dir.mkdirs();
                trimOld(dir, 6);
                File dst = new File(dir, name);
                try (InputStream in = new java.io.FileInputStream(path); OutputStream os = new FileOutputStream(dst)) {
                    copy(in, os);
                }
                JSObject r = new JSObject();
                r.put("path", dst.getAbsolutePath());
                call.resolve(r);
            } catch (Exception e) {
                call.reject("공유할 파일을 준비하지 못했어요: " + e.getMessage());
            }
        }, "munseo-share").start();
    }

    // ---------------- 받은 파일을 앱 캐시로 복사해 웹 화면에 알린다 ----------------

    /** MainActivity·파일 고르기 공용. 큰 파일도 화면이 멈추지 않게 따로 복사한다. */
    static void importAsync(final Activity activity, final Uri uri) {
        new Thread(() -> importUri(activity, uri), "munseo-import").start();
    }

    private static void importUri(final Activity activity, Uri uri) {
        String id = UUID.randomUUID().toString();
        String name = null;
        long size = -1;
        ContentResolver cr = activity.getContentResolver();
        try {
            try (Cursor c = cr.query(uri, new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    int ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    int si = c.getColumnIndex(OpenableColumns.SIZE);
                    if (ni >= 0 && !c.isNull(ni)) name = c.getString(ni);
                    if (si >= 0 && !c.isNull(si)) size = c.getLong(si);
                }
            } catch (Exception ignored) {
                // 이름/크기를 못 가져와도 내용은 읽을 수 있다
            }
            if (name == null || name.isEmpty()) name = uri.getLastPathSegment();
            if (name == null || name.isEmpty()) name = "문서";

            File dir = new File(activity.getCacheDir(), "open");
            if (!dir.exists()) dir.mkdirs();
            trimOld(dir, 2);
            // 한글·특수문자 파일명 때문에 주소가 꼬이지 않도록 캐시 파일 이름은 영문 숫자로 만든다
            File out = new File(dir, "doc_" + System.currentTimeMillis() + safeExt(name));

            long total = 0;
            try (InputStream in = cr.openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
                if (in == null) throw new IllegalStateException("파일을 열 수 없어요.");
                total = copy(in, os);
            }
            JSObject o = new JSObject();
            o.put("id", id);
            o.put("path", out.getAbsolutePath());
            o.put("name", name);
            o.put("size", size >= 0 ? size : total);
            o.put("mime", cr.getType(uri));
            activity.runOnUiThread(() -> deliver(o));
        } catch (Exception e) {
            JSObject o = new JSObject();
            o.put("id", id);
            o.put("name", name != null ? name : "문서");
            o.put("error", "파일을 읽지 못했어요. 파일 앱에서 다시 열어 주세요.");
            activity.runOnUiThread(() -> deliver(o));
        }
    }

    /** 복사를 끝낸 뒤 호출한다. */
    static void deliver(JSObject info) {
        pending = info;
        if (instance != null) {
            // 웹 쪽 리스너가 아직 없으면 붙을 때까지 보관한다
            instance.notifyListeners("fileOpened", info, true);
        }
    }

    private static long copy(InputStream in, OutputStream os) throws java.io.IOException {
        byte[] buf = new byte[256 * 1024];
        long total = 0;
        int n;
        while ((n = in.read(buf)) > 0) {
            os.write(buf, 0, n);
            total += n;
        }
        return total;
    }

    private static String safeExt(String name) {
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) return "";
        String ext = name.substring(dot + 1).toLowerCase(Locale.ROOT);
        return ext.matches("[a-z0-9]{1,8}") ? "." + ext : "";
    }

    private static String safeName(String name) {
        String s = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\r\\n]+", "_").trim();
        return s.isEmpty() ? "문서" : (s.length() > 100 ? s.substring(0, 100) : s);
    }

    // 캐시가 쌓이지 않게 최근 파일 keep개만 남긴다
    private static void trimOld(File dir, int keep) {
        File[] files = dir.listFiles();
        if (files == null || files.length <= keep) return;
        Arrays.sort(files, Comparator.comparingLong(File::lastModified).reversed());
        for (int i = keep; i < files.length; i++) files[i].delete();
    }
}

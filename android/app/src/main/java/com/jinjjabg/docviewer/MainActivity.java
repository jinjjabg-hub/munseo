package com.jinjjabg.docviewer;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Locale;
import java.util.UUID;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FileOpenPlugin.class);
        super.onCreate(savedInstanceState);
        // 화면 회전 등으로 다시 만들어진 경우엔 같은 파일을 또 열지 않는다
        if (savedInstanceState == null) {
            handleIntent(getIntent());
        }
    }

    // 앱이 이미 켜져 있을 때 다른 문서를 탭한 경우
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        Uri uri = intent.getData();
        if (uri == null) {
            ClipData clip = intent.getClipData();
            if (clip != null && clip.getItemCount() > 0) uri = clip.getItemAt(0).getUri();
        }
        if (uri == null) return;
        final Uri target = uri;
        // 큰 파일도 화면이 멈추지 않게 따로 복사한다
        new Thread(() -> importUri(target), "munseo-import").start();
    }

    private void importUri(Uri uri) {
        String id = UUID.randomUUID().toString();
        String name = null;
        long size = -1;
        ContentResolver cr = getContentResolver();
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

            File dir = new File(getCacheDir(), "open");
            if (!dir.exists()) dir.mkdirs();
            trimOld(dir, 2);
            // 한글·특수문자 파일명 때문에 주소가 꼬이지 않도록 캐시 파일 이름은 영문 숫자로 만든다
            File out = new File(dir, "doc_" + System.currentTimeMillis() + safeExt(name));

            long total = 0;
            try (InputStream in = cr.openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
                if (in == null) throw new IllegalStateException("파일을 열 수 없어요.");
                byte[] buf = new byte[256 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) {
                    os.write(buf, 0, n);
                    total += n;
                }
            }
            JSObject o = new JSObject();
            o.put("id", id);
            o.put("path", out.getAbsolutePath());
            o.put("name", name);
            o.put("size", size >= 0 ? size : total);
            o.put("mime", cr.getType(uri));
            runOnUiThread(() -> FileOpenPlugin.deliver(o));
        } catch (Exception e) {
            JSObject o = new JSObject();
            o.put("id", id);
            o.put("name", name != null ? name : "문서");
            o.put("error", "파일을 읽지 못했어요. 파일 앱에서 다시 열어 주세요.");
            runOnUiThread(() -> FileOpenPlugin.deliver(o));
        }
    }

    private static String safeExt(String name) {
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) return "";
        String ext = name.substring(dot + 1).toLowerCase(Locale.ROOT);
        return ext.matches("[a-z0-9]{1,8}") ? "." + ext : "";
    }

    // 캐시가 쌓이지 않게 최근 파일 keep개만 남긴다
    private static void trimOld(File dir, int keep) {
        File[] files = dir.listFiles();
        if (files == null || files.length <= keep) return;
        Arrays.sort(files, Comparator.comparingLong(File::lastModified).reversed());
        for (int i = keep; i < files.length; i++) files[i].delete();
    }
}

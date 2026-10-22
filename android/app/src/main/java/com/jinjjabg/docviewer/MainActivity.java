package com.jinjjabg.docviewer;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

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
        FileOpenPlugin.importAsync(this, uri);
    }
}

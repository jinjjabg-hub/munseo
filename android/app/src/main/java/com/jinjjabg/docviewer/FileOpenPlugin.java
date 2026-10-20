package com.jinjjabg.docviewer;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 다른 앱(파일 앱 등)에서 "열기"로 넘어온 문서를 웹 화면에 전달한다.
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

    /** MainActivity가 파일 복사를 끝낸 뒤 호출한다. */
    static void deliver(JSObject info) {
        pending = info;
        if (instance != null) {
            // 웹 쪽 리스너가 아직 없으면 붙을 때까지 보관한다
            instance.notifyListeners("fileOpened", info, true);
        }
    }
}

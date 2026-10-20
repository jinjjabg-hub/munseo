package com.jinjjabg.docviewer;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

/** 에뮬레이터 시험 전용: 파일 앱이 content:// 주소로 문서를 넘겨주는 상황을 흉내 낸다. (debug 빌드에만 포함) */
public class SmokeProvider extends ContentProvider {
    private File fileFor(Uri uri) {
        return new File(new File(getContext().getFilesDir(), "smoke"), uri.getLastPathSegment());
    }

    @Override public boolean onCreate() { return true; }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        File f = fileFor(uri);
        MatrixCursor c = new MatrixCursor(new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        c.addRow(new Object[] {f.getName(), f.length()});
        return c;
    }

    @Override public String getType(Uri uri) { return "application/octet-stream"; }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(fileFor(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override public int delete(Uri uri, String s, String[] a) { return 0; }
    @Override public int update(Uri uri, ContentValues v, String s, String[] a) { return 0; }
}

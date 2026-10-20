// AndroidManifest.xml 을 만든다 — "이 확장자·MIME 파일을 탭하면 이 앱이 후보로 뜨게" 하는 목록의 원본.
// 사용: node tools/gen-manifest.mjs   (확장자/MIME을 바꾸려면 아래 목록만 고친다)
import fs from 'node:fs';
import path from 'node:path';

const EXTENSIONS = [
  // 1단계
  'pdf', 'hwp', 'hwpx', 'docx', 'xlsx', 'xlsm', 'xls', 'csv', 'ods', 'pptx',
];

const MIME_TYPES = [
  'application/pdf',
  // 한글: MIME이 제각각이라 모두 건다
  'application/x-hwp', 'application/haansofthwp', 'application/vnd.hancom.hwp', 'application/hwp',
  'application/vnd.hancom.hwpx', 'application/hwp+zip', 'application/x-hwpx',
  // 파일 관리자가 종류를 모를 때 주는 값 — 아래 pathPattern과 함께 쓴다
  'application/octet-stream',
  // 워드 / 엑셀 / 파워포인트 / OpenDocument 표
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/csv', 'text/comma-separated-values', 'application/csv',
];

// 파일명에 점이 여러 개여도 걸리도록: .*\.hwp / .*\..*\.hwp / ... (안드로이드 패턴은 XML에서 \\ 두 번)
const MAX_EXTRA_DOTS = 4;
const patterns = [];
for (const ext of EXTENSIONS) {
  for (const e of new Set([ext, ext.toUpperCase()])) {
    for (let dots = 0; dots <= MAX_EXTRA_DOTS; dots++) {
      patterns.push('.*' + '\\\\..*'.repeat(dots) + '\\\\.' + e);
    }
  }
}

const filter = (inner) => `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />${inner}
            </intent-filter>`;

const schemes = '\n                <data android:scheme="content" />\n                <data android:scheme="file" />';
const mimeFilter = filter(
  schemes + MIME_TYPES.map((m) => `\n                <data android:mimeType="${m}" />`).join('')
);
const pathData = patterns.map((p) => `\n                <data android:pathPattern="${p}" />`).join('');
// 종류(MIME)가 있는데 목록에 없는 경우 / 종류가 아예 없는 경우 둘 다 파일 이름으로 잡는다
const pathFilterTyped = filter(schemes + '\n                <data android:host="*" />\n                <data android:mimeType="*/*" />' + pathData);
const pathFilterUntyped = filter(schemes + '\n                <data android:host="*" />' + pathData);

const xml = `<?xml version="1.0" encoding="utf-8"?>
<!-- 이 파일은 tools/gen-manifest.mjs 가 만든다. 직접 고치지 말고 그 스크립트의 목록을 고친 뒤 다시 실행. -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">

    <application
        android:allowBackup="false"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:usesCleartextTraffic="false"
        android:theme="@style/AppTheme">

        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation|density"
            android:name=".MainActivity"
            android:label="@string/title_activity_main"
            android:theme="@style/AppTheme.NoActionBarLaunch"
            android:launchMode="singleTask"
            android:exported="true">

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
${mimeFilter}
${pathFilterTyped}
${pathFilterUntyped}

        </activity>

        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="\${applicationId}.fileprovider"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/file_paths"></meta-data>
        </provider>
    </application>

    <!-- 인터넷 권한 없음: 광고·외부 전송이 구조적으로 불가능하다.
         다른 라이브러리가 권한을 끼워 넣어도 병합 단계에서 제거한다. -->
    <uses-permission android:name="android.permission.INTERNET" tools:node="remove" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" tools:node="remove" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" tools:node="remove" />
</manifest>
`;
const out = path.resolve('android/app/src/main/AndroidManifest.xml');
fs.writeFileSync(out, xml);
console.log(`wrote ${out}: 확장자 ${EXTENSIONS.length}개, MIME ${MIME_TYPES.length}개, pathPattern ${patterns.length}개`);

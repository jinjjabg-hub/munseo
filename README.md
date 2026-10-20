# 내 문서 뷰어

폰에서 문서 파일(한글 · 워드 · 엑셀 · 파워포인트 · PDF …)을 탭하면 **광고 없는 전용 뷰어 하나로 바로 열리게** 하는 안드로이드 앱입니다.
문서 종류마다 광고 많은 뷰어를 따로 깔지 않으려고 만들었고, **읽기 전용 · 인터넷 권한 없음 · 파일은 폰 밖으로 나가지 않습니다.**

- 앱 이름: **내 문서 뷰어** / 패키지 ID: `com.jinjjabg.docviewer` (확정, 바꾸지 않음)

## 폰에 설치하기 (매번 이 3단계)

1. 폰에서 이 저장소의 **Releases** 페이지를 열고 가장 위 `munseo-viewer-….apk`를 눌러 내려받습니다.
2. 내려받은 파일을 눌러 **이 출처 허용 → 설치**. (이전 버전이 있으면 그 위에 그대로 덮어 설치됩니다)
3. 파일 앱에서 `.hwp` 등 문서를 탭 → **내 문서 뷰어** → **항상**.

## 처음 한 번만: 서명키 등록 (이걸 해야 Releases에 APK가 올라갑니다)

같은 키로 계속 서명해야 업데이트가 덮어 설치됩니다. 키는 한 번 만들어 GitHub에 비밀로 저장합니다.

1. 저장소 → **Settings → Secrets and variables → Actions → New repository secret**
2. `signing-secrets.txt`(작업 폴더에 있음)의 4개를 이름/값 그대로 등록: `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`
3. **`signing-secrets.txt`를 비밀번호 관리자나 개인 클라우드에 백업**하고, 작업 폴더에서는 지웁니다. (잃어버리면 앱을 지우고 새로 설치해야 합니다)
4. Actions 탭에서 최근 실행을 **Re-run all jobs** → 끝나면 Releases에 APK가 올라옵니다.

## 구조 (개발자용)

| 위치 | 역할 |
|---|---|
| `src/` | 웹 앱 (Vite). `parsers/` 한글(hwp·hwpx) 파서, `viewers/` 형식별 뷰어 |
| `android/` | Capacitor 안드로이드 프로젝트. `MainActivity.java`가 `content://` 파일을 받아 캐시에 복사 |
| `tools/gen-manifest.mjs` | 확장자·MIME 목록 → `AndroidManifest.xml` 생성 (목록은 이 파일 하나만 고침) |
| `tests/run.mjs` | Chromium(폰 크기·터치)으로 앱을 실제로 열어 보는 시험 → `test-results/report.md` |
| `tests/android-smoke.sh` | 에뮬레이터에서 "탭해서 열기" 시험 (GitHub Actions에서 자동 실행) |
| `.github/workflows/build-apk.yml` | 빌드 → 권한 검사 → 에뮬레이터 시험 → 서명 → Releases 업로드 |

```bash
npm ci && npm run build                 # 웹 앱 빌드 (www/)
python3 tests/make-fixtures.py          # 시험용 문서 생성
node tests/run.mjs                      # 브라우저 시험
node tools/dump-hwp.mjs 파일.hwp         # .hwp에서 뽑힌 글자를 터미널로 확인
node tools/gen-manifest.mjs             # 확장자 목록을 바꾼 뒤 매니페스트 재생성
```

외부 CDN·구글 폰트는 쓰지 않고(모든 라이브러리는 npm으로 앱에 포함), AndroidManifest에는 INTERNET 권한이 없습니다.

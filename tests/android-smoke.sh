#!/usr/bin/env bash
# 에뮬레이터에서 앱을 실제로 설치해 "탭해서 열기"를 시험한다.
# 사용: tests/android-smoke.sh 디버그.apk   (adb가 연결된 상태)
set -u
APK="$1"
PKG=com.jinjjabg.docviewer
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${SMOKE_OUT:-smoke-out}"
mkdir -p "$OUT"
FAIL=0
RESULT="$OUT/result.md"
echo "| 시험 | 결과 | 상세 |" > "$RESULT"; echo "|---|---|---|" >> "$RESULT"
rec() { # 이름 PASS|FAIL 상세
  echo "$2  $1 | $3"
  echo "| $1 | $( [ "$2" = PASS ] && echo ✅ || echo ❌ ) | $3 |" >> "$RESULT"
  [ "$2" = PASS ] || FAIL=1
}

cdp() { # 자바스크립트 식 → 웹뷰에서 실행한 결과(JSON)
  local pid; pid="$(adb shell pidof $PKG | tr -d '\r' | awk '{print $1}')"
  adb forward tcp:9222 "localabstract:webview_devtools_remote_$pid" >/dev/null 2>&1
  node "$DIR/cdp.mjs" "$1" 2>"$OUT/cdp-err.txt"
}

adb install -r "$APK" >/dev/null 2>&1 && rec "APK 설치" PASS "$(basename "$APK")" || { rec "APK 설치" FAIL "설치 실패"; exit 1; }

# 1) 비행기 모드 (인터넷 없이도 열려야 한다)
adb shell cmd connectivity airplane-mode enable >/dev/null 2>&1 || adb shell settings put global airplane_mode_on 1 >/dev/null 2>&1
sleep 2
rec "비행기 모드 켬" PASS "$(adb shell settings get global airplane_mode_on | tr -d '\r')"

# 2) 권한: 인터넷 권한이 없어야 한다
PERMS="$(adb shell dumpsys package $PKG | sed -n '/requested permissions:/,/install permissions:/p' | tr -d '\r')"
echo "$PERMS" > "$OUT/permissions.txt"
if echo "$PERMS" | grep -q "android.permission.INTERNET"; then rec "INTERNET 권한 없음" FAIL "설치된 앱에 INTERNET 권한이 있음"; else rec "INTERNET 권한 없음" PASS "설치된 앱의 요청 권한에 없음"; fi

# 3) "열기" 후보 목록: 파일 종류/이름 조합별로 이 앱이 뜨는지
check_resolve() { # 설명 URI MIME(없으면 -)
  local args=(-a android.intent.action.VIEW -c android.intent.category.DEFAULT -d "$2")
  [ "$3" != "-" ] && args+=(-t "$3")
  local o; o="$(adb shell cmd package query-activities --brief "${args[@]}" 2>&1 | tr -d '\r')"
  if echo "$o" | grep -q "$PKG"; then rec "후보에 뜸: $1" PASS "$2 ${3}"; else rec "후보에 뜸: $1" FAIL "$(echo "$o" | head -4 | tr '\n' ' ' | cut -c1-200)"; fi
}
check_resolve "hwp (x-hwp)"            "content://x.provider/doc/1"                  application/x-hwp
check_resolve "hwp (haansofthwp)"      "content://x.provider/doc/1"                  application/haansofthwp
check_resolve "hwp (vnd.hancom.hwp)"   "content://x.provider/doc/1"                  application/vnd.hancom.hwp
check_resolve "hwp (hwp)"              "content://x.provider/doc/1"                  application/hwp
check_resolve "hwp octet-stream+이름"  "content://x.provider/files/보고서.hwp"       application/octet-stream
check_resolve "hwp 점 여러 개 이름"    "content://x.provider/files/a.b.c.최종.hwp"   application/octet-stream
check_resolve "hwp 대문자 .HWP"        "content://x.provider/files/REPORT.HWP"       application/octet-stream
check_resolve "hwp 종류 없음+이름"     "file:///sdcard/Download/a.hwp"               -
check_resolve "hwpx 종류 없음+이름"    "file:///sdcard/Download/a.hwpx"              -
check_resolve "pdf"                    "content://x.provider/doc/2"                  application/pdf
check_resolve "docx"                   "content://x.provider/doc/3"                  application/vnd.openxmlformats-officedocument.wordprocessingml.document
check_resolve "xlsx"                   "content://x.provider/doc/4"                  application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
check_resolve "pptx"                   "content://x.provider/doc/5"                  application/vnd.openxmlformats-officedocument.presentationml.presentation
check_resolve "xlsx octet-stream+이름" "content://x.provider/files/표.xlsx"          application/octet-stream
check_resolve "csv"                    "content://x.provider/doc/6"                  text/csv
check_resolve "doc"                    "content://x.provider/doc/7"                  application/msword
check_resolve "ppt"                    "content://x.provider/doc/8"                  application/vnd.ms-powerpoint
check_resolve "odt"                    "content://x.provider/doc/9"                  application/vnd.oasis.opendocument.text
check_resolve "rtf"                    "content://x.provider/doc/10"                 application/rtf
check_resolve "txt"                    "content://x.provider/doc/11"                 text/plain
check_resolve "이미지 png"             "content://x.provider/doc/12"                 image/png
check_resolve "이미지 jpg 이름만"      "file:///sdcard/Download/photo.jpg"           -
check_resolve "html"                   "content://x.provider/doc/13"                 text/html

# 4) 실제로 열어 보기
# 디버그 빌드의 시험용 제공자(content://com.jinjjabg.docviewer.smoke/파일)로 문서를 넘긴다
adb shell run-as $PKG mkdir -p files/smoke
for f in sample.hwp sample.pdf sample.docx sample.xlsx sample.pptx sample.doc sample.ppt sample.odt sample.odp sample.rtf sample.txt sample.png; do
  adb push "$DIR/smoke-files/$f" "/data/local/tmp/$f" >/dev/null
  adb shell chmod 644 "/data/local/tmp/$f"
  adb shell run-as $PKG cp "/data/local/tmp/$f" "files/smoke/$f"
done

open_and_wait() { # 이름 파일 MIME kind 표시글자
  adb logcat -c
  adb shell am start -W -a android.intent.action.VIEW -d "content://com.jinjjabg.docviewer.smoke/$2" -t "$3" -n "$PKG/.MainActivity" >/dev/null 2>&1
  local line=""
  for _ in $(seq 1 40); do
    line="$(adb logcat -d 2>/dev/null | grep 'munseo:opened' | grep "\"kind\":\"$4\"" | tail -1)"
    [ -n "$line" ] && break
    sleep 1
  done
  adb exec-out screencap -p > "$OUT/shot-$1.png" 2>/dev/null
  if [ -n "$line" ] && echo "$line" | grep -q "$5"; then
    rec "$1" PASS "$(echo "$line" | sed 's/.*munseo:opened //' | cut -c1-120)"
  else
    rec "$1" FAIL "열림 로그 없음 또는 글자 불일치: ${line:-없음}"
    adb logcat -d 2>/dev/null | grep -i -E "capacitor|chromium|munseo|AndroidRuntime|FATAL" | tail -40 > "$OUT/logcat-$1.txt"
    echo "--- logcat ($1) ---"; cat "$OUT/logcat-$1.txt"; echo "--- end ---"
  fi
}

adb shell am force-stop $PKG; sleep 1
open_and_wait "꺼진 상태에서 한글 열기" sample.hwp application/x-hwp hwp "SMOKE-HWP"
# 앱이 켜져 있는 채로 다른 문서 열기 (onNewIntent)
open_and_wait "켜진 상태에서 PDF 열기"  sample.pdf application/pdf pdf "SMOKE-PDF"
open_and_wait "켜진 상태에서 워드 열기" sample.docx application/vnd.openxmlformats-officedocument.wordprocessingml.document docx "SMOKE-DOCX"
open_and_wait "켜진 상태에서 엑셀 열기" sample.xlsx application/vnd.openxmlformats-officedocument.spreadsheetml.sheet xlsx "SMOKE-XLSX"
open_and_wait "켜진 상태에서 파워포인트 열기" sample.pptx application/vnd.openxmlformats-officedocument.presentationml.presentation pptx "SMOKE-PPTX"
# 종류(MIME)를 모르고 이름만 있는 경우도 (octet-stream)
adb shell am force-stop $PKG; sleep 1
open_and_wait "꺼진 상태에서 octet-stream으로 한글 열기" sample.hwp application/octet-stream hwp "SMOKE-HWP"


# ---- 2단계: 새 형식 열기 ----
open_and_wait "옛 워드(.doc) 열기"           sample.doc application/msword doc "SMOKE-DOCX"
open_and_wait "옛 파워포인트(.ppt) 열기"     sample.ppt application/vnd.ms-powerpoint ppt "SMOKE-PPTX"
open_and_wait "OpenDocument 글(.odt) 열기"   sample.odt application/vnd.oasis.opendocument.text odf "SMOKE-DOCX"
open_and_wait "OpenDocument 슬라이드(.odp) 열기" sample.odp application/vnd.oasis.opendocument.presentation odf "SMOKE-PPTX"
open_and_wait "RTF 열기"                     sample.rtf application/rtf rtf "SMOKE-DOCX"
open_and_wait "텍스트(.txt) 열기"            sample.txt text/plain text "SMOKE-TXT"
adb shell am start -W -a android.intent.action.VIEW -d "content://com.jinjjabg.docviewer.smoke/sample.png" -t image/png -n "$PKG/.MainActivity" >/dev/null 2>&1
sleep 3
IMG="$(cdp "(() => { const i = document.querySelector('.img-wrap img'); return i ? [i.naturalWidth, i.naturalHeight] : null; })()")"
if [ "$IMG" = "[320,200]" ]; then rec "이미지(.png) 열기" PASS "원본 $IMG"; else rec "이미지(.png) 열기" FAIL "${IMG:-없음}"; fi

# ---- 2단계: 검색 (실제 안드로이드 웹뷰) ----
find_check() { # 이름 파일 MIME 검색어 최소건수
  adb shell am start -W -a android.intent.action.VIEW -d "content://com.jinjjabg.docviewer.smoke/$2" -t "$3" -n "$PKG/.MainActivity" >/dev/null 2>&1
  sleep 4
  local r; r="$(cdp "window.__app.search('$4')")"
  local c; c="$(echo "$r" | sed -n 's/.*"count":\([0-9]*\).*/\1/p')"
  if [ -n "$c" ] && [ "$c" -ge "$5" ]; then rec "검색: $1" PASS "'$4' → $r"; else rec "검색: $1" FAIL "'$4' → ${r:-응답 없음}"; fi
}
find_check "한글" sample.hwp application/x-hwp "두 번째" 1
find_check "워드" sample.docx application/vnd.openxmlformats-officedocument.wordprocessingml.document "시험" 1
find_check "엑셀" sample.xlsx application/vnd.openxmlformats-officedocument.spreadsheetml.sheet "가나다" 1
find_check "파워포인트" sample.pptx application/vnd.openxmlformats-officedocument.presentationml.presentation "시험" 1
find_check "PDF" sample.pdf application/pdf "SMOKE" 1

# ---- 2단계: PDF로 저장 (안드로이드 인쇄 기능 + 권한 없이 Documents 저장) ----
save_check() { # 이름 파일 MIME
  adb shell am start -W -a android.intent.action.VIEW -d "content://com.jinjjabg.docviewer.smoke/$2" -t "$3" -n "$PKG/.MainActivity" >/dev/null 2>&1
  sleep 4
  local r; r="$(cdp "window.__app.savePdf({share:false})")"
  local base="${2%.*}"
  local loc; loc="$(echo "$r" | sed -n 's/.*"location":"\([^"]*\)".*/\1/p')"
  local pg; pg="$(echo "$r" | sed -n 's/.*"pages":\([-0-9]*\).*/\1/p')"
  local p="/sdcard/$loc"
  adb pull "$p" "$OUT/saved-$base.pdf" >/dev/null 2>&1
  local head; head="$(head -c 5 "$OUT/saved-$base.pdf" 2>/dev/null)"
  local sz; sz="$(stat -c %s "$OUT/saved-$base.pdf" 2>/dev/null || echo 0)"
  if [ "$head" = "%PDF-" ] && [ "$sz" -gt 1500 ]; then rec "PDF로 저장: $1" PASS "$loc · ${pg}쪽 · ${sz}바이트"; else rec "PDF로 저장: $1" FAIL "결과: ${r:-없음} / 저장파일 ${sz}바이트"; fi
}
save_check "한글" sample.hwp application/x-hwp
save_check "워드" sample.docx application/vnd.openxmlformats-officedocument.wordprocessingml.document
save_check "엑셀" sample.xlsx application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
save_check "파워포인트" sample.pptx application/vnd.openxmlformats-officedocument.presentationml.presentation

# ---- 2단계: PDF 공유 준비 (공유 시트에 넘길 파일 복사) ----
adb shell am start -W -a android.intent.action.VIEW -d "content://com.jinjjabg.docviewer.smoke/sample.pdf" -t application/pdf -n "$PKG/.MainActivity" >/dev/null 2>&1
sleep 4
SH="$(cdp "(async () => { const d = window.__app.state().doc; const r = await window.__app.fileOpen.copyForShare({ path: d.path, name: d.name }); return r; })()")"
SHP="$(echo "$SH" | sed -n 's/.*"path":"\([^"]*\)".*/\1/p')"
if [ -n "$SHP" ] && adb shell run-as $PKG ls "$SHP" >/dev/null 2>&1; then rec "PDF 공유용 복사" PASS "$SHP"; else rec "PDF 공유용 복사" FAIL "${SH:-없음}"; fi

echo; cat "$RESULT"
[ "$FAIL" = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit $FAIL

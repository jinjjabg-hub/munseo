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
  local o; o="$(adb shell cmd package resolve-activity --brief --all "${args[@]}" 2>&1 | tr -d '\r')"
  if echo "$o" | grep -q "$PKG"; then rec "후보에 뜸: $1" PASS "$2 ${3}"; else rec "후보에 뜸: $1" FAIL "$(echo "$o" | head -2 | tr '\n' ' ')"; fi
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

# 4) 실제로 열어 보기
# 디버그 빌드의 시험용 제공자(content://com.jinjjabg.docviewer.smoke/파일)로 문서를 넘긴다
adb shell run-as $PKG mkdir -p files/smoke
for f in sample.hwp sample.pdf sample.docx sample.xlsx sample.pptx; do
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

echo; cat "$RESULT"
[ "$FAIL" = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit $FAIL

/** @OnlyCurrentDoc */  // 이 시트 파일 하나에만 접근 권한을 요청
// 알림이 연동 키트 → 이미 쓰고 있는 진도표 시트에 컴시간 시간표를 반영합니다. 디자인·서식은 건드리지 않아요.
// 오늘부터의 날짜만 바꾸고(지난 기록은 그대로), 반 칸만 고칩니다(진도 메모 줄은 그대로).
//   빠진 수업: 칸을 비우고 빨간색 + 메모 "[컴시간] 209 빠짐"
//   새로 생긴/바뀐 수업: 반 번호를 써 넣고 메모 "[컴시간] 추가 (원래 216)"
// 내 시트 모양에 맞게 아래 숫자만 바꾸세요.
const SHEET = "진도표";   // 진도표 탭 이름
const DATE_ROW = 1;       // 날짜가 있는 줄
const FIRST_COL = 3;      // 첫 날짜가 있는 열 (C열 = 3)
const FIRST_ROW = 5;      // 1교시 반 번호가 있는 줄
const ROW_STEP = 2;       // 교시마다 몇 줄씩 (반 번호 줄 + 진도 줄 = 2)
const PERIODS = 7;        // 몇 교시까지
const RED = "#ff0000";
const KEY = "";           // 비워 두면 누구나 보낼 수 있음. 정하면 웹훅 URL 끝에 ?key=값

function doPost(e) {
  if (KEY && e.parameter.key !== KEY) return ContentService.createTextOutput("bad key");
  const json = e.postData.contents;
  const ss = SpreadsheetApp.getActive();
  const data = ss.getSheetByName("_컴시간") || ss.insertSheet("_컴시간").hideSheet();
  data.getRange("A1").setValue(json);
  const r = sync(ss, JSON.parse(json));
  return ContentService.createTextOutput(`ok 바뀐 칸 ${r.changed}, 날짜 열 ${r.dates}, 반영한 날 ${r.days}`);
}

// 시트 메뉴 없이 수동으로 다시 반영하고 싶을 때: Apps Script 편집기에서 이 함수 실행
function resync() {
  const ss = SpreadsheetApp.getActive();
  sync(ss, JSON.parse(ss.getSheetByName("_컴시간").getRange("A1").getValue()));
}

// "2-9" → 209
const code = l => l && +l.c.split("-")[0] * 100 + +l.c.split("-")[1];

function sync(ss, tt) {
  const sh = ss.getSheetByName(SHEET);
  const tz = ss.getSpreadsheetTimeZone();
  const today = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  const store = PropertiesService.getDocumentProperties(), props = store.getProperties();  // 빨갛게 칠하기 전 원래 배경색
  const lastRow = FIRST_ROW + ROW_STEP * (PERIODS - 1);
  const width = sh.getLastColumn() - FIRST_COL + 1;
  const dates = sh.getRange(DATE_ROW, FIRST_COL, 1, width).getValues()[0];
  const block = sh.getRange(FIRST_ROW, FIRST_COL, lastRow - FIRST_ROW + 1, width);
  const vals = block.getValues(), bgs = block.getBackgrounds(), notes = block.getNotes();
  let changed = 0, nDates = 0, nDays = 0;

  dates.forEach((d, j) => {
    if (Object.prototype.toString.call(d) !== "[object Date]") return;  // 날짜 칸만 (instanceof는 시트 값에서 실패할 수 있음)
    const date = Utilities.formatDate(d, tz, "yyyy-MM-dd");
    nDates++;
    const day = tt.days[date];
    // 지난 날짜·컴시간에 없는 날짜·하루 종일 수업 없는 날(방학·시험 등)은 건드리지 않음
    if (date < today || !day || !Object.keys(day).length) return;
    nDays++;
    for (let p = 1; p <= PERIODS; p++) {
      const i = (p - 1) * ROW_STEP, cell = sh.getRange(FIRST_ROW + i, FIRST_COL + j);
      const v = vals[i][j], want = code(day[p]);
      const m = String(v).match(/^(\d{3})-?$/);
      const have = m ? +m[1] : null;                    // 209, "209-" → 209 / 부장회의·동아리·빈칸 → null
      const a1 = cell.getA1Notation(), saved = a1 in props ? props[a1] : null;
      if (want && want === have) {                      // 컴시간과 같음 → 원래대로 ("209-" 표시도 그대로)
        if (saved !== null) { cell.setBackground(saved || null).clearNote(); delete props[a1]; changed++; }
      } else if (want && (v === "" || have)) {          // 새로 생겼거나 다른 반으로 바뀜
        const back = [`[컴시간] 추가 (원래 ${want})`, `[컴시간] ${want} 빠짐`].includes(notes[i][j]);  // 원래 반으로 되돌아옴 → 메모 지움
        cell.setValue(want).setNote(back ? "" : "[컴시간] 추가" + (have ? " (원래 " + have + ")" : ""));
        if (saved !== null) { cell.setBackground(saved || null); delete props[a1]; }
        changed++;
      } else if (!want && have && notes[i][j] === "[컴시간] 추가") {  // 컴시간이 추가했다가 다시 취소 → 원래 빈칸으로
        cell.clearContent().clearNote();
        changed++;
      } else if (!want && have) {                       // 빠진 수업 → 비우고 빨간색
        if (saved === null) props[a1] = bgs[i][j] === "#ffffff" ? "" : bgs[i][j];
        cell.clearContent().setBackground(RED).setNote("[컴시간] " + have + " 빠짐");
        changed++;
      }
    }
  });
  store.setProperties(props, true);
  return { changed, dates: nDates, days: nDays };
}

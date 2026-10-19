/** @OnlyCurrentDoc */  // 이 시트 파일 하나에만 접근 권한을 요청
// 알림이 연동 키트 → 이미 쓰고 있는 진도표 시트에 컴시간 시간표를 반영합니다. 디자인·서식은 건드리지 않아요.
// 오늘부터의 날짜만, 반 번호 칸만 고칩니다(지난 기록·진도 메모 줄은 그대로).
// 기준은 컴시간 '기본 시간표'(원래 시간표)예요. 손으로 고쳐 둔 칸도 원래 시간표와 다르면 '바뀐 수업'으로 표시해요.
//   빠진 수업: 칸을 비우고 빨간색 + 메모 "[컴시간] 209 빠짐"
//   새로 생긴/바뀐 수업: 반 번호 + 노란색 + 메모 "[컴시간] 변경 (원래 216)" / "[컴시간] 추가"
//   원래 시간표대로인 칸: 색·메모를 원래대로
// 내 시트 모양에 맞게 아래 숫자만 바꾸세요.
const SHEET = "진도표";   // 진도표 탭 이름
const DATE_ROW = 1;       // 날짜가 있는 줄
const FIRST_COL = 3;      // 첫 날짜가 있는 열 (C열 = 3)
const FIRST_ROW = 5;      // 1교시 반 번호가 있는 줄
const ROW_STEP = 2;       // 교시마다 몇 줄씩 (반 번호 줄 + 진도 줄 = 2)
const PERIODS = 7;        // 몇 교시까지
const RED = "#ff0000";    // 빠진 수업 칸 색
const YELLOW = "#ffff00"; // 새로 생긴/바뀐 수업 칸 색
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

// 수동으로 다시 반영하고 싶을 때: Apps Script 편집기에서 이 함수 실행
function resync() {
  const ss = SpreadsheetApp.getActive();
  sync(ss, JSON.parse(ss.getSheetByName("_컴시간").getRange("A1").getValue()));
}

// {c:"2-9"} → 209
const code = l => l ? +l.c.split("-")[0] * 100 + +l.c.split("-")[1] : null;

function sync(ss, tt) {
  const sh = ss.getSheetByName(SHEET);
  const tz = ss.getSpreadsheetTimeZone();
  const today = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  const store = PropertiesService.getDocumentProperties(), props = store.getProperties();  // 색칠하기 전 원래 배경색
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
    // 지난 날짜·컴시간에 없는 날짜·하루 종일 수업 없는 날(방학·시험·행사)은 건드리지 않음
    if (date < today || !day || !Object.keys(day).length) return;
    nDays++;
    const base = tt.base[String(new Date(date + "T00:00:00Z").getUTCDay())] || {};  // 그 요일의 원래 시간표
    for (let p = 1; p <= PERIODS; p++) {
      const i = (p - 1) * ROW_STEP, v = vals[i][j], note = notes[i][j];
      const want = code(day[p]), orig = code(base[p]);
      const m = String(v).match(/^(\d{3})-?$/);
      const have = m ? +m[1] : null;  // 209, "209-" → 209 / 부장회의·동아리·빈칸 → null

      // 이 칸이 있어야 할 모습
      let value = v;                                     // 글자(부장회의 등)는 그대로 둠
      if (want && (v === "" || have) && have !== want) value = want;   // "209-"처럼 같은 반이면 그대로
      if (!want && have) value = "";
      const color = !want && orig ? RED : want && want !== orig ? YELLOW : null;
      const newNote = !want && orig ? `[컴시간] ${orig} 빠짐`
        : want && want !== orig ? (orig ? `[컴시간] 변경 (원래 ${orig})` : "[컴시간] 추가") : "";

      const cell = sh.getRange(FIRST_ROW + i, FIRST_COL + j), a1 = cell.getA1Notation();
      let touched = false;
      if (value !== v) { value === "" ? cell.clearContent() : cell.setValue(value); touched = true; }
      if (newNote !== note && (note === "" || note.startsWith("[컴시간]"))) { cell.setNote(newNote); touched = true; }  // 내가 쓴 메모는 안 건드림
      if (color && bgs[i][j] !== color) {
        if (!(a1 in props)) props[a1] = bgs[i][j] === "#ffffff" ? "" : bgs[i][j];
        cell.setBackground(color); touched = true;
      } else if (!color && a1 in props) {
        cell.setBackground(props[a1] || null); delete props[a1]; touched = true;
      }
      if (touched) changed++;
    }
  });
  store.setProperties(props, true);
  return { changed, dates: nDates, days: nDays };
}

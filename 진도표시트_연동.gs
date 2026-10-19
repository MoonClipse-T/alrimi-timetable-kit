/** @OnlyCurrentDoc */  // 이 시트 파일 하나에만 접근 권한을 요청
// 알림이 연동 키트 → 이미 쓰고 있는 진도표 시트에 컴시간 시간표를 반영합니다. 칸 색·디자인은 건드리지 않아요.
// 오늘부터의 날짜만, 반 번호 칸만 고칩니다(지난 기록·진도 메모 줄은 그대로).
// 기준은 컴시간 '기본 시간표'(원래 시간표)예요. 손으로 고쳐 둔 칸도 원래 시간표와 다르면 '바뀐 수업'으로 표시해요.
//   새로 생긴/바뀐 수업: 반 번호를 넣고 "213 (변경)"처럼 빨간 굵은 글씨 + 메모 "[컴시간] 변경 (원래 211)"
//   빠진 수업: 칸에 빨간 굵은 글씨로 "변경" + 메모 "[컴시간] 209 빠짐"
//   원래 시간표대로인 칸: 글씨·메모를 원래대로
// 반 번호는 숫자로 남아서(표시만 "(변경)") 수업 횟수 세는 수식도 그대로 맞아요.
// 이미 다른 Apps Script 코드가 있으면 지우지 말고, 새 스크립트 파일(+ → 스크립트)에 이 코드를 넣으세요.
// 내 시트 모양에 맞게 아래 숫자만 바꾸세요.
const ALRIMI = {
  SHEET: "진도표",   // 진도표 탭 이름
  DATE_ROW: 1,       // 날짜가 있는 줄
  FIRST_COL: 3,      // 첫 날짜가 있는 열 (C열 = 3)
  FIRST_ROW: 5,      // 1교시 반 번호가 있는 줄
  ROW_STEP: 2,       // 교시마다 몇 줄씩 (반 번호 줄 + 진도 줄 = 2)
  PERIODS: 7,        // 몇 교시까지
  RED: "#ff0000",    // 표시 글씨 색
  KEY: "",           // 비워 두면 누구나 보낼 수 있음. 정하면 웹훅 URL 끝에 ?key=값
  MARK_NF: '0" (변경)"',  // 숫자는 그대로 두고 보이기만 "213 (변경)"
};

function doPost(e) {
  if (ALRIMI.KEY && e.parameter.key !== ALRIMI.KEY) return ContentService.createTextOutput("bad key");
  const json = e.postData.contents;
  const ss = SpreadsheetApp.getActive();
  const data = ss.getSheetByName("_컴시간") || ss.insertSheet("_컴시간").hideSheet();
  data.getRange("A1").setValue(json);
  const r = alrimiSync(ss, JSON.parse(json));
  return ContentService.createTextOutput(`ok 바뀐 칸 ${r.changed}, 날짜 열 ${r.dates}, 반영한 날 ${r.days}`);
}

// 수동으로 다시 반영하고 싶을 때: Apps Script 편집기에서 이 함수 실행
function alrimiResync() {
  const ss = SpreadsheetApp.getActive();
  alrimiSync(ss, JSON.parse(ss.getSheetByName("_컴시간").getRange("A1").getValue()));
}

// {c:"2-9"} → 209
const alrimiCode = l => l ? +l.c.split("-")[0] * 100 + +l.c.split("-")[1] : null;
const alrimiRedBold = () => SpreadsheetApp.newTextStyle().setForegroundColor(ALRIMI.RED).setBold(true).build();

function alrimiSync(ss, tt) {
  const sh = ss.getSheetByName(ALRIMI.SHEET);
  const tz = ss.getSpreadsheetTimeZone();
  const today = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  const store = PropertiesService.getDocumentProperties(), props = store.getProperties();  // 표시하기 전 원래 글씨 서식
  // 이전 버전(칸 색칠)이 남긴 색은 원래 색으로 되돌림
  for (const a1 in props) if (props[a1][0] !== "{") { sh.getRange(a1).setBackground(props[a1] || null); delete props[a1]; }
  const lastRow = ALRIMI.FIRST_ROW + ALRIMI.ROW_STEP * (ALRIMI.PERIODS - 1);
  const width = sh.getLastColumn() - ALRIMI.FIRST_COL + 1;
  const dates = sh.getRange(ALRIMI.DATE_ROW, ALRIMI.FIRST_COL, 1, width).getValues()[0];
  const block = sh.getRange(ALRIMI.FIRST_ROW, ALRIMI.FIRST_COL, lastRow - ALRIMI.FIRST_ROW + 1, width);
  const vals = block.getValues(), notes = block.getNotes();
  const nfs = block.getNumberFormats(), fcs = block.getFontColors(), fws = block.getFontWeights();
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
    for (let p = 1; p <= ALRIMI.PERIODS; p++) {
      const i = (p - 1) * ALRIMI.ROW_STEP, v = vals[i][j], note = notes[i][j];
      const want = alrimiCode(day[p]), orig = alrimiCode(base[p]);
      const cell = sh.getRange(ALRIMI.FIRST_ROW + i, ALRIMI.FIRST_COL + j), a1 = cell.getA1Notation();
      const saved = a1 in props ? JSON.parse(props[a1]) : null;

      // 지금 칸에서 내가 붙인 표시를 떼어 낸 원래 값
      const s = String(v).replace(/ \(변경\)$/, "");
      const cur = typeof v === "number" ? v : s === "변경" && saved ? "" : s;
      const m = String(cur).match(/^(\d{3})-?$/);
      const have = m ? +m[1] : null;  // 209, "209-" → 209 / 부장회의·동아리·빈칸 → null

      // 이 칸에 있어야 할 값과 표시
      let value = cur;                                   // 글자(부장회의 등)는 그대로 둠
      if (want && (cur === "" || have) && have !== want) value = want;  // "209-"처럼 같은 반이면 그대로
      if (!want && have) value = "";
      const mark = want ? want !== orig : !!orig;
      const newNote = !mark ? "" : !want ? `[컴시간] ${orig} 빠짐` : orig ? `[컴시간] 변경 (원래 ${orig})` : "[컴시간] 추가";
      const show = !mark || typeof value === "number" ? value : value === "" ? "변경" : value + " (변경)";

      let touched = false;
      if (mark && !saved) props[a1] = JSON.stringify({ nf: nfs[i][j], fc: fcs[i][j], fw: fws[i][j] });
      const orig_ = saved || (mark ? JSON.parse(props[a1]) : null);
      if (typeof show === "number") {
        if (v !== show) { cell.setValue(show); touched = true; }
        if (mark && (nfs[i][j] !== ALRIMI.MARK_NF || fcs[i][j] !== ALRIMI.RED || fws[i][j] !== "bold")) {
          cell.setNumberFormat(ALRIMI.MARK_NF).setFontColor(ALRIMI.RED).setFontWeight("bold"); touched = true;
        }
      } else if (v !== show) {
        if (orig_) cell.setNumberFormat(orig_.nf).setFontColor(orig_.fc).setFontWeight(orig_.fw);  // 글자 칸은 칸 서식은 원래대로
        if (show === "") cell.clearContent();
        else if (!mark) cell.setValue(show);
        else cell.setRichTextValue(SpreadsheetApp.newRichTextValue().setText(show)
          .setTextStyle(show === "변경" ? 0 : show.length - 4, show.length, alrimiRedBold()).build());
        touched = true;
      }
      if (!mark && saved) {                              // 원래대로 돌아옴 → 글씨 서식 복원
        cell.setNumberFormat(saved.nf).setFontColor(saved.fc).setFontWeight(saved.fw);
        delete props[a1]; touched = true;
      }
      if (newNote !== note && (note === "" || note.startsWith("[컴시간]"))) { cell.setNote(newNote); touched = true; }  // 내가 쓴 메모는 안 건드림
      if (touched) changed++;
    }
  });
  store.setProperties(props, true);
  return { changed, dates: nDates, days: nDays };
}

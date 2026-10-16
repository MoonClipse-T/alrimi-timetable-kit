# 알림이(컴시간) 시간표 연동 키트

학교 PC에 깔린 **컴시간 알림이**의 시간표를 20분마다 자동으로 읽어서, **내가 직접 만든 웹앱**이 쓸 수 있는 JSON으로 내보내 줍니다.
디자인·화면은 마음대로 만들고, 시간표 연동만 이 키트에 맡기면 됩니다.

- 윈도우 기본 PowerShell만 씁니다. 따로 설치할 것이 없어요.
- 알림이 파일은 **읽기만** 합니다. 알림이에는 아무 영향이 없어요.
- 컴시간에서 시간표가 바뀌면(교체·보강 등) 다음 동기화 때 반영됩니다. 바뀐 게 없으면 아무것도 보내지 않아요.

| 파일 | 하는 일 |
|---|---|
| `PC연동.bat` | 처음 한 번 더블클릭: 설정 질문에 답하면 바로 한 번 보내고, 20분마다 자동 실행 등록 |
| `alrimi_sync.ps1` | 실제 동작하는 스크립트 (설정은 `%LOCALAPPDATA%\alrimi_sync_kit\config.json`에 저장) |

---

## 설치 3단계

1. **키트 폴더를 알림이가 깔린 학교 PC에 둡니다.** (바탕 화면 등 아무 곳. 나중에 폴더를 옮기면 `PC연동.bat`을 다시 실행하세요.)
2. **`PC연동.bat` 더블클릭** 후 질문에 답합니다.
   - 알림이 dat 폴더: 보통 그냥 Enter (`C:\Program Files (x86)\알림이\dat` 자동 감지)
   - 컴시간 교사 이름: 알림이에 보이는 이름 그대로 (예: `홍길동`)
   - 보낼 곳: `1` 내 Firebase / `2` 웹훅 URL / `3` 이 PC에 `timetable.json` 파일로만 저장 (아래 "출력 방식" 참고)
3. **"내보내기 완료", "자동 동기화 등록 완료"가 보이면 끝.** 이후 PC가 켜져 있고 로그인돼 있는 동안 20분마다 조용히(창 없이) 동기화됩니다.

확인·관리
- 결과를 눈으로 보기: PowerShell에서 `.\alrimi_sync.ps1 -Dump` (아무 데도 보내지 않고 JSON만 출력. `-Teacher 이름`으로 다른 이름 시험 가능)
- 기록: `%LOCALAPPDATA%\alrimi_sync_kit\sync.log` (실패하면 이유가 남아요. 다음 실행 때 자동 재시도)
- 설정 바꾸기: `PC연동.bat` 다시 실행
- 자동 실행 끄기: 작업 스케줄러에서 `AlrimiTimetableSync` 삭제 (또는 PowerShell에서 `Unregister-ScheduledTask AlrimiTimetableSync`)

---

## 출력 방식 3가지

### 1) 내 Firebase Firestore 문서에 저장 (웹앱이 Firebase를 쓸 때 추천)

웹앱에 구글 로그인이 있으면, 로그인한 **나만의 문서**에 시간표가 저장됩니다. 설정 때 묻는 것:

| 질문 | 어디서 찾나요 |
|---|---|
| apiKey, projectId | 웹앱 코드의 `firebaseConfig` (`initializeApp({...})` 안) |
| 문서 경로 | 기본값 `users/{uid}/meta/timetable`. `{uid}`는 로그인한 사용자 ID로 자동으로 바뀜. 웹앱에서 읽는 경로와 똑같이 맞추면 됨 |
| PC 연동 코드 | 웹앱에 아래 버튼을 만들어 두고 거기서 복사 |

문서에는 필드 두 개가 저장됩니다: `json`(시간표 JSON **문자열**), `syncedAt`(마지막 동기화 시각, timestamp).

**① 웹앱에 'PC 연동 코드' 버튼 만들기** — 로그인한 사용자의 `refreshToken`을 복사해 주는 버튼입니다.

```html
<button id="pcCode">PC 연동 코드 복사</button>
<script type="module">
  // auth = getAuth(app) 로 이미 로그인한 상태라고 가정
  document.getElementById("pcCode").onclick = async () => {
    await navigator.clipboard.writeText(auth.currentUser.refreshToken);
    alert("복사했어요. PC연동.bat 창에 붙여넣으세요. (비밀번호처럼 다른 사람에게 공유하지 마세요)");
  };
</script>
```

**② 웹앱에서 시간표 읽기** (Firebase v11 모듈 방식 예시)

```js
import { getFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
const db = getFirestore(app);
onSnapshot(doc(db, "users", auth.currentUser.uid, "meta", "timetable"), snap => {
  if (!snap.exists()) return;                 // 아직 PC 연동 전
  const tt = JSON.parse(snap.data().json);    // ← 아래 "JSON 형식" 그대로
  const syncedAt = snap.data().syncedAt?.toDate();
  draw(tt);                                   // 내 화면 그리기
});
```

**③ Firebase 콘솔에서 꼭 할 것 두 가지**
- **승인된 도메인 추가**: Authentication → 설정(Settings) → 승인된 도메인 → 내 웹앱 주소 추가 (예: `myname.github.io`). 안 하면 내 사이트에서 구글 로그인이 막힙니다.
- **보안 규칙**: 스크립트는 "나"로 로그인해서 쓰기 때문에, 내 문서를 내가 읽고 쓸 수 있어야 합니다. 예:
  ```
  match /users/{uid}/{document=**} {
    allow read, write: if request.auth != null && request.auth.uid == uid;
  }
  ```

> PC 연동 코드는 오래 유지되지만, 계정 비밀번호 변경·보안 조치 등으로 무효가 되면 `sync.log`에 "내보내기 실패"가 남습니다. 그때는 새 코드를 복사해 `PC연동.bat`을 다시 실행하세요.

### 2) 웹훅 URL로 POST (Firebase가 아닌 다른 백엔드)

바뀔 때마다 지정한 URL로 시간표 JSON을 그대로 `POST` 합니다(`Content-Type: application/json; charset=utf-8`).
아무 서버나 되지만, 서버가 없다면 **구글 Apps Script**가 가장 쉽습니다:

```js
// 구글 Apps Script: 배포 → 새 배포 → 웹 앱(실행: 나, 액세스: 모든 사용자) → 나온 /exec 주소를 웹훅 URL로 입력
function doPost(e) {
  PropertiesService.getScriptProperties().setProperty("tt", e.postData.contents);
  return ContentService.createTextOutput("ok");
}
function doGet() {   // 웹앱에서 fetch(같은 /exec 주소) 로 읽기
  return ContentService.createTextOutput(PropertiesService.getScriptProperties().getProperty("tt") || "{}")
    .setMimeType(ContentService.MimeType.JSON);
}
```

> URL을 아는 사람은 누구나 보낼 수 있으니 주소를 공개하지 마세요. 필요하면 URL에 `?key=비밀값`을 붙이고 `doPost`에서 `e.parameter.key`를 확인하세요.

### 3) 이 PC에 `timetable.json` 파일로만 저장

기본 위치는 키트 폴더 안 `timetable.json`. 다른 경로도 지정할 수 있어요.
OneDrive·구글 드라이브 동기화 폴더에 저장하게 하거나, 웹앱 개발 중에 테스트 데이터로 쓰기 좋습니다.

---

## JSON 형식

```json
{
  "teacher": "홍길동",
  "subject": "과학B",
  "savedAt": "2026-10-16 10:56:48",
  "source": "2026_2_xx0000.Gwa",
  "base": {
    "1": { "1": { "c": "2-9", "s": "과학B" }, "3": { "c": "1-4", "s": "과학A" } },
    "2": { },
    "3": { "2": { "c": "2-1", "s": "과학B" } },
    "4": { },
    "5": { }
  },
  "days": {
    "2026-10-19": { "1": { "c": "2-9", "s": "과학B" } },
    "2026-10-20": { "4": { "c": "2-3", "s": "과학B" } }
  }
}
```

| 항목 | 뜻 |
|---|---|
| `teacher` | 교사 이름 |
| `subject` | 기본 시간표에서 가장 많이 가르치는 과목 |
| `savedAt` | 컴시간에서 시간표를 마지막으로 저장한 시각 |
| `source` | 읽은 알림이 파일 이름(학년도_학기_학교코드) |
| `base` | **기본 시간표**. 요일 `"1"`(월)~`"5"`(금) → 교시 `"1"`~`"8"` → 수업 |
| `days` | **날짜별 실제 시간표**(교체·보강 반영). `"YYYY-MM-DD"` → 교시 → 수업. 알림이가 가진 학기 주간 전체 |
| `c` | 반 `"학년-반"` (예: `"2-9"` = 2학년 9반) |
| `s` | 과목명 |

- 수업이 없는 교시는 **키 자체가 없습니다**(빈 칸 = 공강). 수업 없는 날은 `{}`.
- 요일·교시 키는 숫자가 아니라 **문자열**입니다.

**변경(교체·보강) 판별법** — 같은 날짜·교시에서 `days`와 `base`를 비교합니다.

```js
const wd = String(new Date(date + "T00:00:00").getDay());   // "1"=월 … "5"=금
const now = tt.days[date]?.[p], usual = tt.base[wd]?.[p];
if (!now && !usual) {}                                        // 원래도 지금도 공강
else if (now && !usual) {}                                    // 추가된 수업(보강 등)
else if (!now && usual) {}                                    // 빠진 수업(다른 선생님께 넘어감 등)
else if (now.c !== usual.c || now.s !== usual.s) {}           // 반/과목이 바뀜(교체)
else {}                                                       // 평소대로
```

---

## AI에게 화면 만들어 달라고 하기 (프롬프트 템플릿)

아래 단락을 Claude·Gemini·ChatGPT 등에 붙여넣고, `-Dump`로 나온 JSON(또는 위 예시)을 함께 주세요. `[ ]` 부분은 원하는 대로 바꾸세요.

> 나는 중학교 [과학] 교사이고, 학급별 수업 진도를 관리하는 웹앱을 HTML 파일 하나로 만들고 싶어. 시간표는 아래 JSON 형식으로 [Firebase Firestore 문서 `users/{uid}/meta/timetable`의 `json` 필드(문자열)에 / 웹훅으로 받은 주소에서 fetch로 / 같은 폴더의 timetable.json에] 들어 있어. 형식: `base`는 요일("1"=월~"5"=금)→교시("1"~"8")→`{c:"학년-반", s:"과목"}`인 기본 시간표, `days`는 "YYYY-MM-DD"→교시→`{c,s}`인 날짜별 실제 시간표(교체·보강 반영)이고, 수업 없는 교시는 키가 없어. 같은 날짜·교시에서 `days`와 `base`를 비교해 다르면 '변경된 수업'으로 눈에 띄게 표시해 줘. 화면에는 [이번 주 시간표, 반별로 지금까지 몇 차시 했는지, 한 줄에 한 차시씩 적는 차시 계획 입력, 각 수업 칸에 그날 한 내용 메모]가 있었으면 좋겠고, 디자인은 [깔끔하고 휴대폰에서도 보기 좋게] 해 줘. 차시 계획과 메모는 [Firebase에 / 브라우저 localStorage에] 저장해 줘. [Firebase를 쓰면 구글 로그인과, 로그인한 사용자의 `refreshToken`을 복사해 주는 'PC 연동 코드' 버튼도 설정 화면에 넣어 줘.] 아래는 실제 JSON 예시야:

---

## 주의

- **알림이 파일 형식은 공개된 규격이 아닙니다.** 이 키트는 알림이의 `.Gwa` 파일(zip 안의 `.kim` 파일들)을 직접 분석해 읽는 비공식 방식이라, **알림이가 업데이트되면 갑자기 안 될 수 있어요.** 이상하면 `-Dump` 결과를 알림이 화면과 비교해 보고, `sync.log`를 확인하세요.
- 알림이에 받아진 시간표만 읽습니다. 알림이를 한동안 안 켰다면 최신 변경이 없을 수 있어요(알림이가 켜져서 새 시간표를 받으면 다음 동기화 때 반영).
- `PC 연동 코드`(refreshToken)는 내 계정으로 Firebase에 쓸 수 있는 열쇠입니다. 남에게 주지 말고, 이 키트를 공유할 때 `%LOCALAPPDATA%\alrimi_sync_kit` 폴더(설정·코드 저장 위치)는 넣지 마세요. 키트 폴더 자체에는 개인 정보가 저장되지 않습니다(파일 저장 방식으로 키트 폴더에 만든 `timetable.json`은 제외).
- 시간표 JSON에는 내 이름과 담당 반·수업 시간이 들어 있으니, 공개 저장소나 공개 웹에 그대로 올리지 않도록 주의하세요.

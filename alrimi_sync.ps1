# 알림이(컴시간) 시간표 → 내 웹앱 자동 연동 키트. 윈도우 기본 PowerShell만 사용(설치 필요 없음).
# 알림이가 받아 둔 최신 *.Gwa(zip) 안의 교사 시간표를 읽어 날짜별(변경 반영) 시간표 JSON을 만든다.
# 알림이 파일은 읽기만 한다. 출력: firebase(내 Firestore 문서) / webhook(URL로 POST) / file(timetable.json)
#   PC연동.bat                          처음 한 번: 설정 + 20분마다 자동 실행 등록
#   alrimi_sync.ps1                     동기화(바뀐 게 있을 때만 내보냄)
#   alrimi_sync.ps1 -Dump [-Teacher 이름] 내보내지 않고 해석 결과(JSON)만 출력
param([switch]$Setup, [switch]$Dump, [string]$Teacher)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$ConfDir = Join-Path $env:LOCALAPPDATA 'alrimi_sync_kit'
$ConfPath = Join-Path $ConfDir 'config.json'
$LogPath = Join-Path $ConfDir 'sync.log'
$Task = 'AlrimiTimetableSync'  # 작업 스케줄러 이름. 해제: Unregister-ScheduledTask AlrimiTimetableSync
$cp949 = [Text.Encoding]::GetEncoding(949)

function Log($msg) {
    New-Item -ItemType Directory -Force $ConfDir | Out-Null
    $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $msg
    Write-Host $line
    Add-Content -Path $LogPath -Value $line -Encoding UTF8
}

function Find-Dat {
    foreach ($p in "${env:ProgramFiles(x86)}\알림이\dat", "$env:ProgramFiles\알림이\dat") { if (Test-Path $p) { return $p } }
}

# 가장 최근 학기 Gwa(2026_2 > 2026_1, 파일명 순)를 열어 @{파일명 = byte[]} 반환. zip 안 한글 파일명은 cp949.
function Read-Gwa($dat) {
    $gwa = Get-ChildItem $dat -Filter '*.Gwa' | Sort-Object Name | Select-Object -Last 1
    if (-not $gwa) { throw "$dat 에 .Gwa 파일이 없어요. 알림이를 한 번 실행해 시간표를 받아 주세요." }
    $zip = [IO.Compression.ZipFile]::Open($gwa.FullName, 'Read', $cp949)
    $files = @{}
    try {
        foreach ($e in $zip.Entries) {
            $ms = New-Object IO.MemoryStream
            $s = $e.Open(); $s.CopyTo($ms); $s.Close()
            $files[$e.FullName] = $ms.ToArray()
        }
    } finally { $zip.Dispose() }
    return @{ Name = $gwa.Name; Files = $files }
}

function Parse($files, $teacher) {
    $names = $cp949.GetString($files['교사명.kim']).Split('^')   # 맨 앞이 빈 칸 → 교사 i = names[i+1]
    $subjects = $cp949.GetString($files['과목명.kim']).Split('$') | ForEach-Object { $_.Split('^')[0] }
    $t = [array]::IndexOf($names, $teacher) - 1
    if ($t -lt 0) { throw "컴시간 교사 명단에 '$teacher' 이름이 없어요. 알림이에 보이는 이름 그대로 입력해 주세요." }
    $nTeachers = [BitConverter]::ToInt16($files['cfg.kim'], 10)  # 교사 슬롯 수

    # 주간일자: 1452바이트 레코드마다 offset 2에 그 주 월요일(VB Date)
    $wk = $files['주간일자.kim']
    $mondays = @()
    for ($off = 2; $off -le $wk.Length - 8; $off += 1452) {
        $v = [BitConverter]::ToDouble($wk, $off)
        if ($v -lt 40000) { break }
        $mondays += (Get-Date '1899-12-30').AddDays([int]$v)
    }

    # 시간표 배열: 교사마다 Long[요일0..6][교시0..8] (요일이 빠르게 변함) = 63칸
    function Week($bytes, $rec) {
        $out = [ordered]@{}
        foreach ($d in 1..5) {
            $day = [ordered]@{}
            foreach ($p in 1..8) {
                $code = [BitConverter]::ToInt32($bytes, ($rec * 63 + $d + 7 * $p) * 4)
                if ($code) {
                    $day["$p"] = [ordered]@{
                        c = '{0}-{1}' -f [math]::Floor(($code % 1000) / 100), ($code % 100)
                        s = $subjects[[math]::Floor($code / 1000)]
                    }
                }
            }
            $out["$d"] = $day
        }
        return $out
    }

    $base = Week $files['기본교사시간표.kim'] $t

    # dayhour_t: 주마다 [교사별 (시간표 63칸, 표시 63칸)] 블록. 마지막 주만 교사 수만큼 잘려 있음.
    $daily = $files['dayhour_t.kim']
    $recs = $daily.Length / 4 / 63
    $stride = ($recs - 2 * $nTeachers) / ($mondays.Count - 1)
    if ($stride -ne [math]::Floor($stride)) { throw 'dayhour_t 구조가 예상과 달라요(알림이 업데이트?).' }
    $days = [ordered]@{}
    for ($w = 0; $w -lt $mondays.Count; $w++) {
        $periods = Week $daily ($w * $stride + 2 * $t)
        foreach ($d in $periods.Keys) { $days[$mondays[$w].AddDays([int]$d - 1).ToString('yyyy-MM-dd')] = $periods[$d] }
    }

    $count = @{}
    foreach ($day in $base.Values) { foreach ($c in $day.Values) { $count[$c.s] = 1 + $count[$c.s] } }
    $subject = ($count.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1).Key
    $saved = ($cp949.GetString($files['cfg2.kim']) -split "`r?`n")[0].Split('=', 2)[1]
    return [ordered]@{ teacher = $teacher; subject = $subject; savedAt = $saved; base = $base; days = $days }
}

function Load-Conf {
    $c = @{}
    if (Test-Path $ConfPath) { (Get-Content $ConfPath -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $c[$_.Name] = $_.Value } }
    return $c
}
function Save-Conf($c) {
    New-Item -ItemType Directory -Force $ConfDir | Out-Null
    [IO.File]::WriteAllText($ConfPath, ($c | ConvertTo-Json), [Text.Encoding]::UTF8)
}
function Ask($q, $def) {
    $a = (Read-Host $(if ($def) { "$q [$def]" } else { $q })).Trim()
    if ($a) { $a } else { $def }
}

function Send-Firebase($conf, $json) {
    $tok = Invoke-RestMethod -Method Post -Uri "https://securetoken.googleapis.com/v1/token?key=$($conf.apiKey)" `
        -Body @{ grant_type = 'refresh_token'; refresh_token = $conf.token }
    $conf.token = $tok.refresh_token
    $doc = "projects/$($conf.projectId)/databases/(default)/documents/" + $conf.docPath.Replace('{uid}', $tok.user_id)
    $body = @{ fields = @{
            json     = @{ stringValue = $json }
            syncedAt = @{ timestampValue = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }
        } } | ConvertTo-Json -Depth 5 -Compress
    Invoke-RestMethod -Method Patch -Uri "https://firestore.googleapis.com/v1/$doc" `
        -Headers @{ Authorization = "Bearer $($tok.id_token)" } -ContentType 'application/json; charset=utf-8' `
        -Body ([Text.Encoding]::UTF8.GetBytes($body)) | Out-Null
}

function Send-Webhook($conf, $json) {
    Invoke-RestMethod -Method Post -Uri $conf.webhookUrl -ContentType 'application/json; charset=utf-8' `
        -Body ([Text.Encoding]::UTF8.GetBytes($json)) | Out-Null
}

function Send-File($conf, $json) {
    [IO.File]::WriteAllText($conf.outFile, $json, (New-Object Text.UTF8Encoding $false))
}

# 작업 스케줄러: 로그인해 있는 동안 20분마다 창 없이(conhost --headless) 실행. 놓친 실행은 켜지면 바로.
function Register-Task {
    $action = New-ScheduledTaskAction -Execute 'conhost.exe' `
        -Argument "--headless powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 20) -RepetitionDuration (New-TimeSpan -Days 3650)
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $Task -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
    Write-Host '자동 동기화 등록 완료 (20분마다)'
}

$conf = Load-Conf
if ($Setup) {
    $conf.alrimiDat = Ask '알림이 dat 폴더' $(if ($conf.alrimiDat) { $conf.alrimiDat } else { Find-Dat })
    $conf.teacher = Ask '컴시간 교사 이름(알림이에 보이는 그대로)' $conf.teacher
    Write-Host "`n시간표를 어디로 보낼까요?`n  1) 내 Firebase Firestore 문서`n  2) 웹훅 URL로 POST (Apps Script 등 다른 백엔드)`n  3) 이 PC에 timetable.json 파일로만 저장"
    $def = @{ firebase = '1'; webhook = '2'; file = '3' }[[string]$conf.mode]
    $conf.mode = @{ '1' = 'firebase'; '2' = 'webhook'; '3' = 'file' }[(Ask '번호' $(if ($def) { $def } else { '3' }))]
    if (-not $conf.mode) { throw '1, 2, 3 중 하나를 입력해 주세요.' }
    switch ($conf.mode) {
        'firebase' {
            $conf.apiKey = Ask 'Firebase apiKey (웹앱 firebaseConfig의 apiKey)' $conf.apiKey
            $conf.projectId = Ask 'Firebase projectId' $conf.projectId
            $conf.docPath = Ask '저장할 문서 경로({uid}는 로그인 사용자 ID로 바뀜)' $(if ($conf.docPath) { $conf.docPath } else { 'users/{uid}/meta/timetable' })
            $conf.token = Ask "웹앱의 'PC 연동 코드'(user.refreshToken)를 붙여넣으세요" ''
        }
        'webhook' { $conf.webhookUrl = Ask '웹훅 URL' $conf.webhookUrl }
        'file' { $conf.outFile = Ask '저장할 파일 경로' $(if ($conf.outFile) { $conf.outFile } else { Join-Path $PSScriptRoot 'timetable.json' }) }
    }
    $conf.Remove('lastHash')
    Save-Conf $conf
}
$dat = if ($conf.alrimiDat) { $conf.alrimiDat } else { Find-Dat }
if (-not $Teacher) { $Teacher = $conf.teacher }
if (-not $Teacher) { Write-Host '먼저 PC연동.bat 을 실행하세요.'; exit 1 }
$gwa = Read-Gwa $dat
$payload = Parse $gwa.Files $Teacher
$payload.source = $gwa.Name
$json = $payload | ConvertTo-Json -Depth 10 -Compress
if ($Dump) { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $json; return }
if (-not $conf.mode) { Write-Host '먼저 PC연동.bat 을 실행하세요.'; exit 1 }

$hash = -join ([Security.Cryptography.SHA1]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($json)) | ForEach-Object { $_.ToString('x2') })
if ($hash -eq $conf.lastHash -and ($conf.mode -ne 'file' -or (Test-Path $conf.outFile))) { return }  # 변경 없음: 조용히 종료
try {
    switch ($conf.mode) { 'firebase' { Send-Firebase $conf $json } 'webhook' { Send-Webhook $conf $json } 'file' { Send-File $conf $json } }
} catch { Log "내보내기 실패($($conf.mode)): $($_.Exception.Message) $($_.ErrorDetails.Message)"; exit 1 }  # 다음 실행 때 다시 시도
$conf.lastHash = $hash
Save-Conf $conf
Log "내보내기 완료($($conf.mode), $($gwa.Name), 컴시간 저장 $($payload.savedAt))"
if ($Setup) { Register-Task }

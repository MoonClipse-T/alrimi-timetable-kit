@echo off
cd /d "%~dp0"
if not exist "%~dp0alrimi_sync.ps1" (
  echo alrimi_sync.ps1 파일이 이 폴더에 없어요.
  echo GitHub에서 Code - Download ZIP 으로 받은 뒤, ZIP을 오른쪽 클릭 - 모두 압축 풀기 한 폴더에서 PC연동.bat 을 실행해 주세요.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0alrimi_sync.ps1" -Setup
pause
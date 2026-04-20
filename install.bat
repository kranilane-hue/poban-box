@echo off
setlocal
set "SRC=%~dp0com.refboard.cloudpanel"
set "DEST=%AppData%\Adobe\CEP\extensions\com.refboard.cloudpanel"

if not exist "%SRC%\CSXS\manifest.xml" (
  echo ERROR: extension folder not found: "%SRC%"
  exit /b 1
)

echo Copying extension to "%DEST%" ...
if not exist "%DEST%" mkdir "%DEST%"
xcopy /E /I /Y "%SRC%\*" "%DEST%\"
if errorlevel 1 (
  echo ERROR: xcopy failed
  exit /b 1
)

echo Writing PlayerDebugMode for CSXS.8 through CSXS.30 ...
for %%V in (8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30) do (
  reg add "HKCU\Software\Adobe\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
)

echo Done. Restart Illustrator, then open:
echo Window -^> Extensions -^> Cloud Plugin Center
exit /b 0

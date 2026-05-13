@echo off
:: Cree un raccourci "SR-Analyzer" sur le Bureau
:: Lancez ce script une seule fois apres avoir dezipe l'application.

setlocal

set "APP_DIR=%~dp0"
set "EXE_PATH=%APP_DIR%SR-Analyzer.exe"
set "SHORTCUT=%USERPROFILE%\Desktop\SR-Analyzer.lnk"

if not exist "%EXE_PATH%" (
    echo ERREUR: SR-Analyzer.exe introuvable dans %APP_DIR%
    echo Verifiez que vous lancez ce script depuis le dossier SR-Analyzer.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; ^
   $s  = $ws.CreateShortcut('%SHORTCUT%'); ^
   $s.TargetPath      = '%EXE_PATH%'; ^
   $s.WorkingDirectory = '%APP_DIR%'; ^
   $s.IconLocation    = '%EXE_PATH%'; ^
   $s.Description     = 'SR-Analyzer - Support et Resistance'; ^
   $s.Save()"

if %errorlevel% equ 0 (
    echo [OK] Raccourci cree sur le Bureau : SR-Analyzer
    echo Vous pouvez maintenant double-cliquer dessus pour lancer l'application.
) else (
    echo [ERREUR] Impossible de creer le raccourci.
    echo Essayez de lancer ce script en tant qu'Administrateur.
)

pause

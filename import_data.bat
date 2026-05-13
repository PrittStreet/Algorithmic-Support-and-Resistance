@echo off
:: Importe une base de donnees sr_data.db recue d'un ami.
:: ATTENTION : remplace votre base actuelle (une sauvegarde est creee automatiquement).

setlocal

set "APP_DIR=%~dp0"
set "DB_DEST=%APP_DIR%sr_data.db"

echo ============================================================
echo   SR-Analyzer - Import de donnees
echo ============================================================
echo.
echo   ATTENTION : votre base actuelle sera remplacee.
echo   Une sauvegarde .backup sera creee automatiquement.
echo.
echo   Appuyez sur une touche pour ouvrir le selecteur de fichier...
echo   (Ctrl+C pour annuler)
pause >nul

:: Ecriture du script PowerShell dans un fichier temporaire
:: (les ^ de continuation sont consommes par batch dans les backticks for/f)
set "PS_TMP=%TEMP%\sr_import_%RANDOM%.ps1"
(
    echo Add-Type -AssemblyName System.Windows.Forms
    echo $d = New-Object System.Windows.Forms.OpenFileDialog
    echo $d.Filter = 'Base SR-Analyzer ^(*.db^)^|*.db^|Tous les fichiers ^(*.*^)^|*.*'
    echo $d.Title = 'Selectionner le fichier sr_data.db a importer'
    echo $d.InitialDirectory = [Environment]::GetFolderPath^('MyDocuments'^)
    echo if ^($d.ShowDialog^(^) -eq 'OK'^) ^{ $d.FileName ^} else ^{ '' ^}
) > "%PS_TMP%"

set "DB_SOURCE="
for /f "usebackq delims=" %%F in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_TMP%"`) do set "DB_SOURCE=%%F"
del "%PS_TMP%" >nul 2>&1

if "%DB_SOURCE%"=="" (
    echo Import annule.
    pause
    exit /b 0
)

if not exist "%DB_SOURCE%" (
    echo ERREUR: Fichier introuvable : %DB_SOURCE%
    pause
    exit /b 1
)

:: Sauvegarde de la base actuelle
if exist "%DB_DEST%" (
    copy /Y "%DB_DEST%" "%DB_DEST%.backup" >nul
    echo [OK] Sauvegarde : sr_data.db.backup
)

copy /Y "%DB_SOURCE%" "%DB_DEST%" >nul

if %errorlevel% equ 0 (
    echo.
    echo [OK] Import reussi depuis :
    echo     %DB_SOURCE%
    echo.
    echo Relancez SR-Analyzer pour utiliser les nouvelles donnees.
) else (
    echo [ERREUR] L'import a echoue.
)

pause

@echo off
:: Exporte sr_data.db pour le partager avec un ami.
:: Le fichier est copie dans Mes Documents avec un horodatage.

setlocal EnableDelayedExpansion

set "APP_DIR=%~dp0"
set "DB_SOURCE=%APP_DIR%sr_data.db"

if not exist "%DB_SOURCE%" (
    echo ERREUR: sr_data.db introuvable dans %APP_DIR%
    pause
    exit /b 1
)

:: Horodatage AAAAMMJJ_HHMM
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value 2^>nul') do set "dt=%%I"
set "TS=%dt:~0,8%_%dt:~8,4%"

set "EXPORT_DIR=%USERPROFILE%\Documents\SR-Analyzer-Export"
if not exist "%EXPORT_DIR%" mkdir "%EXPORT_DIR%"

set "DEST=%EXPORT_DIR%\sr_data_%TS%.db"
copy /Y "%DB_SOURCE%" "%DEST%" >nul

if %errorlevel% equ 0 (
    echo [OK] Base de donnees exportee :
    echo     %DEST%
    echo.
    echo Envoyez ce fichier a votre ami.
    echo Il devra utiliser import_data.bat pour l'importer.
    explorer "%EXPORT_DIR%"
) else (
    echo [ERREUR] L'export a echoue.
)

pause

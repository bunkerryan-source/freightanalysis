@echo off
echo ============================================================
echo   FREIGHT MARKET SUMMARY TOOL - SETUP
echo ============================================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo   [ERROR] Node.js is not installed!
    echo.
    echo   Please download and install Node.js from:
    echo   https://nodejs.org/
    echo.
    echo   Download the LTS version, run the installer, and
    echo   check "Automatically install necessary tools" during install.
    echo.
    echo   After installing, close this window and run setup.bat again.
    echo.
    pause
    exit /b 1
)

echo   [OK] Node.js found:
node --version
echo.

REM Install dependencies
echo [1/2] Installing packages (this may take a minute)...
cd /d "%~dp0"
call npm install
echo.

if %ERRORLEVEL% neq 0 (
    echo   [ERROR] Package installation failed.
    echo   Try running this again, or manually run: npm install
    pause
    exit /b 1
)

echo   [OK] All packages installed.
echo.

REM Create desktop shortcut .bat
echo [2/2] Creating desktop shortcut...
set DESKTOP=%USERPROFILE%\Desktop
set SCRIPT_DIR=%~dp0

(
echo @echo off
echo echo ============================================================
echo echo   Weekly Freight Market Summary Tool
echo echo ============================================================
echo echo.
echo cd /d "%SCRIPT_DIR%"
echo node freight_summary.js
echo echo.
echo echo ============================================================
echo echo   Press any key to close this window.
echo echo ============================================================
echo pause ^>nul
) > "%DESKTOP%\Run Freight Summary.bat"

echo   [OK] Created "Run Freight Summary.bat" on your Desktop.
echo.

echo ============================================================
echo   SETUP COMPLETE!
echo ============================================================
echo.
echo   Next steps:
echo.
echo   1. Open config.json in Notepad and add your API keys
echo      (see README.md for where to get them)
echo.
echo   2. Edit your YouTube channels and podcast feeds in config.json
echo.
echo   3. Double-click "Run Freight Summary.bat" on your Desktop
echo      or run: node freight_summary.js
echo.
echo ============================================================
pause

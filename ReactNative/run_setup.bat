@echo off
REM One-click bootstrapper for the React Native + Expo environment setup on Windows
REM It creates a venv under D:\ReactNative and runs the Python setup script.

set ROOT=D:\ReactNative
if not exist "%ROOT%" mkdir "%ROOT%"
cd /d "%ROOT%"

REM Try to find a Python 3
where python >nul 2>&1
if errorlevel 1 (
  echo Python not found on PATH. Please install Python 3.10+ from https://www.python.org/downloads/windows/ and re-run.
  pause
  exit /b 1
)

REM Create or reuse venv
if not exist "%ROOT%\.venv" (
  python -m venv "%ROOT%\.venv"
)

call "%ROOT%\.venv\Scripts\activate"

python -m pip install --upgrade pip
if exist "%~dp0requirements.txt" (
  python -m pip install -r "%~dp0requirements.txt"
) else (
  echo (requirements.txt not found near this BAT; continuing anyway)
)

REM Copy the setup script next to ROOT if it's not there
if not exist "%ROOT%\setup_reactnative_env.py" (
  if exist "%~dp0setup_reactnative_env.py" copy "%~dp0setup_reactnative_env.py" "%ROOT%\setup_reactnative_env.py"
)

echo.
echo =============================================================
echo  Running environment setup... (run as Administrator for best results)
echo =============================================================
python "%ROOT%\setup_reactnative_env.py"

echo.
echo Done. If PATH changes were made, open a NEW terminal before running:
echo   cd D:\ReactNative\dev\apps\universal-app
echo   npx expo start
pause

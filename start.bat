@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   ============================================
echo    大肥鱼 · 情绪陪伴 AI  M1
echo   ============================================
echo.
echo   打开地址：http://127.0.0.1:5173/whale.html
echo.
echo   按 Ctrl+C 停止服务
echo   ============================================
echo.
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:5173/whale.html"
node server.js
if errorlevel 1 python -m http.server 5173
pause

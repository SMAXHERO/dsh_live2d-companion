@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 换 key · 大肥鱼
echo.
echo  ============================================================
echo   换 key / 检查 key —— 只动 config.local.json 一个文件
echo  ============================================================
echo.
choice /c 12 /n /t 20 /d 1 /m "  1) 换一把新 key    2) 只检查现在的 key 能不能用    [20 秒后默认 1] "
if errorlevel 2 goto check
goto rotate

:check
node "%~dp0tools\set-key.js" --check
goto end

:rotate
start "" https://platform.deepseek.com/api_keys
echo.
echo  浏览器已打开 DeepSeek 控制台：点 Create new API key 生成一把新的。
echo  回到这个窗口把新 key 粘进来（不回显，只显示 *），脚本会先联网验证再写入。
echo.
node "%~dp0tools\set-key.js"

:end
echo.
echo  完成。网页刷新一下就是新 key 在跑；收尾别忘了去控制台把旧 key 删掉。
pause

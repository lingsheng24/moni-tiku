@echo off
chcp 65001 >nul
cd /d "%~dp0"
node "desktop\推送源码.js"
echo.
pause

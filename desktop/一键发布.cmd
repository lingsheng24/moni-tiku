@echo off
chcp 65001 >nul
title 模拟题库 · 一键发布更新（GitHub + GitCode）
cd /d "%~dp0"

echo ============================================
echo   模拟题库 · 一键发布更新
echo   GitHub Release + GitCode Release
echo ============================================
echo.
echo  Token 会自动从本机用户环境变量读取（GH_TOKEN / GITCODE_TOKEN）
echo  若提示缺少，请先执行（一次设置永久生效）：
echo     setx GH_TOKEN       ^<GitHub 令牌^>
echo     setx GITCODE_TOKEN  ^<GitCode 令牌^>
echo ============================================
echo.

node 一键发布.js

echo.
pause

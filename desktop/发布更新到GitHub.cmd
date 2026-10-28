@echo off
chcp 65001 >nul
title 发布更新到 GitHub Release
cd /d "%~dp0"

echo ============================================
echo   模拟题库 · 发布更新到 GitHub Release
echo ============================================
echo.
echo  Token 申请地址：
echo    https://github.com/settings/tokens
echo    Generate new token (classic)
echo    勾选 repo （含 public_repo 权限）
echo.
echo  输入时屏幕不显示字符，输完直接回车即可。
echo ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$t = Read-Host 'GitHub Token' -AsSecureString;" ^
  "$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($t);" ^
  "$p = [Runtime.InteropServices.Marshal]::PtrToStringAuto($b);" ^
  "$env:GH_TOKEN = $p;" ^
  "node 发布更新到GitHub.js;" ^
  "Remove-Item Env:\GH_TOKEN -ErrorAction SilentlyContinue"

echo.
pause

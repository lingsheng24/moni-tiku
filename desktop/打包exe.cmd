@echo off
chcp 65001 >nul
title 打包 exe
cd /d "%~dp0"

if not exist "node_modules\electron-builder" (
  echo 正在安装打包依赖…
  call npm install --no-audit --no-fund --registry=https://registry.npmmirror.com
)

echo 正在打包便携版 exe，首次打包需要下载 Electron 二进制，请耐心等待…
call npm run dist

if exist "release" (
  echo.
  echo 打包完成，正在进行数字签名…
  node 签名exe.js
  echo.
  echo 成品目录：..\发布\
  start "" "%~dp0..\发布"
)
pause

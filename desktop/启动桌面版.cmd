@echo off
chcp 65001 >nul
title 模拟题库 · 桌面版
cd /d "%~dp0"

rem 清除宿主可能注入的 Electron-as-Node 变量，避免以纯 Node 模式启动
set ELECTRON_RUN_AS_NODE=
set ELECTRON_ENABLE_LOGGING=

if not exist "node_modules\electron" (
  echo ============================================
  echo  首次运行，正在安装依赖，请耐心等待几分钟…
  echo ============================================
  call npm install --no-audit --no-fund --registry=https://registry.npmmirror.com
  if errorlevel 1 goto err
)

echo 正在启动…
call npm start
goto end

:err
echo.
echo 依赖安装失败，请检查网络后重试，或手动执行：
echo   npm install
echo   npm start
pause

:end
pause

@echo off
chcp 65001 >nul
title 紫禁城 · 体素沙盘
cd /d %~dp0
echo 正在启动紫禁城体素沙盘...
where node >nul 2>nul
if %errorlevel%==0 (
  start "" http://127.0.0.1:8137/
  node server.js
  goto :eof
)
where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://127.0.0.1:8137/
  python -m http.server 8137
  goto :eof
)
echo [错误] 未找到 Node.js 或 Python,请安装其一后重试。
pause

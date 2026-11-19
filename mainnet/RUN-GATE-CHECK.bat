@echo off
title Rayls mainnet gate check
cls
echo.
echo  Rayls mainnet gate check (read-only). Press any key to start.
pause >nul
cls
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0gate-check.ps1"
echo.
pause

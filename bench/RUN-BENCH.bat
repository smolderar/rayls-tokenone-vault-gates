@echo off
title Rayls Testnet bench
cls
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0bench-server.ps1"

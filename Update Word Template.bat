@echo off
setlocal
set "ROOT=%~dp0"
set "PROJECTROOT=%~dp0."

if not exist "%ROOT%data\letter-templates.js" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('The workspace files were not found next to this updater.`n`nPlease extract the entire ZIP file first, then run Update Word Template.bat from inside the extracted workspace folder.','BU International Center - Template Manager','OK','Warning') | Out-Null"
  exit /b 1
)

if not exist "%ROOT%tools\TemplateManager.ps1" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('TemplateManager.ps1 is missing from the tools folder. Please restore the complete workspace package.','BU International Center - Template Manager','OK','Error') | Out-Null"
  exit /b 1
)

start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%ROOT%tools\TemplateManager.ps1" -ProjectRoot "%PROJECTROOT%"
exit /b 0

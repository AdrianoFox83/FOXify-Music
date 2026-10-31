@echo off
setlocal
cd /d "%~dp0"
set "PORTA=8765"

powershell -NoProfile -Command "try{(Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:%PORTA%/api/health').StatusCode}catch{exit 1}" >nul 2>&1
if not errorlevel 1 goto :abrir

set "PY=python"
where python >nul 2>&1
if not errorlevel 1 goto :iniciar
where py >nul 2>&1
if errorlevel 1 goto :sem_python
set "PY=py -3"

:iniciar
echo Iniciando o servidor do FOXify...
start "FOXify - servidor" /min cmd /c %PY% "%~dp0servidor.py" --porta %PORTA%
timeout /t 2 /nobreak >nul
goto :abrir

:sem_python
echo.
echo  Python 3 nao encontrado.
echo  Instale em https://www.python.org/downloads/ ou publique a pasta
echo  em um site HTTPS para usar direto no navegador.
echo.
pause
exit /b 1

:abrir
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "EDGE64=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set "CHROME64=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

if not exist "%EDGE%" goto :tenta_edge64
start "" "%EDGE%" --app=http://127.0.0.1:%PORTA%/ --window-size=1500,980
goto :fim
:tenta_edge64
if not exist "%EDGE64%" goto :tenta_chrome
start "" "%EDGE64%" --app=http://127.0.0.1:%PORTA%/ --window-size=1500,980
goto :fim
:tenta_chrome
if not exist "%CHROME%" goto :tenta_chrome64
start "" "%CHROME%" --app=http://127.0.0.1:%PORTA%/ --window-size=1500,980
goto :fim
:tenta_chrome64
if not exist "%CHROME64%" goto :navegador_padrao
start "" "%CHROME64%" --app=http://127.0.0.1:%PORTA%/ --window-size=1500,980
goto :fim
:navegador_padrao
start "" "http://127.0.0.1:%PORTA%/"

:fim
endlocal

@echo off
setlocal
cd /d "%~dp0"

set "PY=python"
where python >nul 2>&1
if not errorlevel 1 goto :iniciar
where py >nul 2>&1
if errorlevel 1 goto :sem_python
set "PY=py -3"

:iniciar
echo.
echo  Abrindo o FOXify para o celular...
echo  A janela do servidor vai mostrar o endereco de Wi-Fi.
echo  Digite esse endereco no Chrome do Android (mesma rede Wi-Fi).
echo.
start "FOXify - servidor (deixe esta janela aberta)" cmd /k %PY% "%~dp0servidor.py" --porta 8765
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8765/"
goto :fim

:sem_python
echo.
echo  Python 3 nao encontrado. Instale em https://www.python.org/downloads/
echo  ou publique a pasta do FOXify em um site HTTPS.
echo.
pause

:fim
endlocal

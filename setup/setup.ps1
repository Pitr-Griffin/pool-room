# Ставит на новый компьютер всё, что нужно для работы над Pool Room:
# Blender 5.2, Node.js, FFmpeg, Python, uv, yt-dlp, Claude Code, плагины и скиллы,
# видеоинструменты, MCP for Blender — и переносит заметки памяти Claude.
#
#   powershell -ExecutionPolicy Bypass -File setup\setup.ps1
#
# Скрипт можно запускать повторно: уже установленное он пропускает.
param(
  [string]$Tools = "$env:USERPROFILE\tools",
  [switch]$SkipVideo   # только Blender и веб-версия, без видеоинструментов
)
$ErrorActionPreference = 'Continue'
$Repo = Split-Path $PSScriptRoot -Parent

function Step($text) { Write-Host "`n=== $text" -ForegroundColor Cyan }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Winget($id, $version) {
  $extra = if ($version) { @('--version', $version) } else { @() }
  # winget.exe, а не winget: имена в PowerShell без учёта регистра, иначе функция вызывает саму себя.
  winget.exe install --id $id -e --silent --accept-package-agreements --accept-source-agreements --disable-interactivity @extra |
    Select-Object -Last 1
}

Step 'Программы (winget)'
Winget 'Git.Git'
Winget 'GitHub.cli'
Winget 'BlenderFoundation.Blender' '5.2.3'
Winget 'OpenJS.NodeJS.LTS'
Winget 'Gyan.FFmpeg'
Winget 'Python.Python.3.12'
Winget 'astral-sh.uv'
Winget 'yt-dlp.yt-dlp'
Refresh-Path

Step 'Claude Code (команда claude)'
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { npm install -g @anthropic-ai/claude-code }
Refresh-Path
# Через claude.exe напрямую: обёртка claude.ps1 съедает аргумент «--».
$claude = "$env:APPDATA\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe"
if (-not (Test-Path $claude)) { $claude = (Get-Command claude).Source }

Step 'Плагины Claude Code'
$plugins = @(
  @('heygen-com/hyperframes', 'hyperframes@hyperframes'),
  @('greensock/gsap-skills', 'gsap-skills@gsap-skills'),
  @('Leonxlnx/taste-skill', 'taste-skill@taste-skill'),
  @('anthropics/skills', 'example-skills@anthropic-agent-skills')
)
foreach ($p in $plugins) {
  & $claude plugin marketplace add $p[0]
  & $claude plugin install $p[1]
}

Step 'Скиллы (~/.claude/skills)'
Push-Location $env:USERPROFILE
foreach ($s in 'cloudai-x/threejs-skills', 'remotion-dev/skills', 'AbubakrChan/product-launch-motion', 'diffusionstudio/skills') {
  npx -y skills add $s -g -y --agent claude-code
}
Pop-Location

Step 'MCP for Blender (без телеметрии)'
& $claude mcp add blender -s user -e DISABLE_TELEMETRY=true '--' uvx mcp-for-blender
uvx mcp-for-blender install-addon
$blender = Get-ChildItem 'C:\Program Files\Blender Foundation' -Recurse -Filter blender.exe -ErrorAction SilentlyContinue |
  Select-Object -First 1 -ExpandProperty FullName
if ($blender) {
  # Без --factory-startup: включаем аддон, не трогая остальные настройки Blender.
  & $blender --background --python-expr "import bpy; bpy.ops.preferences.addon_enable(module='blender_mcp'); bpy.ops.wm.save_userpref()" | Out-Null
}

if (-not $SkipVideo) {
  Step 'HyperFrames и Playwright'
  npm install -g hyperframes playwright --allow-scripts=esbuild
  npx -y playwright install chromium
  py -3.12 -m pip install -q --disable-pip-version-check playwright imageio-ffmpeg numpy pillow
  py -3.12 -m playwright install chromium

  Step "Видеоинструменты в $Tools"
  New-Item -ItemType Directory -Force $Tools | Out-Null
  $repos = @{
    'claude-motion-design' = 'https://github.com/howseen-ai/claude-motion-design'
    'video-use'            = 'https://github.com/browser-use/video-use'
    'OpenMontage'          = 'https://github.com/calesthio/OpenMontage'
  }
  foreach ($name in $repos.Keys) {
    if (Test-Path "$Tools\$name") { git -C "$Tools\$name" pull -q --ff-only } else { git clone -q --depth 1 $repos[$name] "$Tools\$name" }
  }

  # claude-motion-design: скилл копируется в ~/.claude/skills.
  Copy-Item -Recurse -Force "$Tools\claude-motion-design\skill\motion-design" "$env:USERPROFILE\.claude\skills\"

  # video-use: скилл подключается целой папкой (helpers/ должны лежать рядом с SKILL.md).
  Push-Location "$Tools\video-use"; uv sync; Pop-Location
  $link = "$env:USERPROFILE\.claude\skills\video-use"
  if (-not (Test-Path $link)) { New-Item -ItemType Junction -Path $link -Target "$Tools\video-use" | Out-Null }
  if (-not (Test-Path "$Tools\video-use\.env")) { Copy-Item "$Tools\video-use\.env.example" "$Tools\video-use\.env" }

  # OpenMontage: своё окружение Python, Remotion-композер и офлайн-озвучка Piper.
  Push-Location "$Tools\OpenMontage"
  if (-not (Test-Path .venv)) { uv venv --python 3.12 .venv }
  uv pip install --python .venv\Scripts\python.exe -r requirements.txt piper-tts
  Push-Location remotion-composer; npm install; npm install-scripts approve esbuild; npm rebuild esbuild; Pop-Location
  if (-not (Test-Path .env)) { Copy-Item .env.example .env }
  Pop-Location

  Step 'Diffusion Studio'
  if (-not (Test-Path "$env:LOCALAPPDATA\DiffusionStudio")) {
    $dir = "$Tools\downloads\diffusion-studio"
    New-Item -ItemType Directory -Force $dir | Out-Null
    $exe = "$dir\Diffusion-Studio-x64-Setup.exe"
    Invoke-WebRequest 'https://github.com/diffusionstudio/editor/releases/latest/download/Diffusion-Studio-x64-Setup.exe' -OutFile $exe
    $sig = Get-AuthenticodeSignature $exe
    if ($sig.Status -eq 'Valid' -and $sig.SignerCertificate.Subject -like '*Diffusion Studio Inc.*') {
      Start-Process $exe -ArgumentList '--silent' -Wait
    } else {
      Write-Warning "Подпись установщика Diffusion Studio не прошла проверку ($($sig.Status)) — пропускаю."
    }
  }
}

Step 'Заметки памяти Claude'
# Папка памяти зависит от пути к проекту: C:\Users\me\pool-room -> C--Users-me-pool-room.
$key = ($Repo -replace '[:\\/]', '-')
$memory = "$env:USERPROFILE\.claude\projects\$key\memory"
New-Item -ItemType Directory -Force $memory | Out-Null
Copy-Item "$PSScriptRoot\memory\*.md" $memory -Force
Write-Host "Заметки скопированы в $memory"

Step 'Готово'
Write-Host @"
Осталось сделать вручную:
  1. gh auth login — войти в GitHub (если ещё не вошёл).
  2. Открыть Diffusion Studio и пройти первую настройку, выбрать Claude Code.
  3. Если нужен монтаж по речи — вписать ELEVENLABS_API_KEY в $Tools\video-use\.env.
  4. Открыть папку проекта в Claude Code и начать новую сессию.
"@

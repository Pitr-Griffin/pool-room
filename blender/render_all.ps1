# Рендерит набор кадров Pool Room в папку renders/.
param([int]$Samples = 512, [string]$Res = '1920x1080')
$blender = Get-ChildItem 'C:\Program Files\Blender Foundation' -Recurse -Filter blender.exe | Select-Object -First 1 -ExpandProperty FullName
$script = Join-Path $PSScriptRoot 'pool_room.py'
$shots = @(
  @('day', 'Camera'),
  @('day', 'CameraPool'),
  @('day', 'CameraMeadow'),
  @('evening', 'Camera'),
  @('night', 'Camera'),
  @('morning', 'CameraPool')
)
foreach ($s in $shots) {
  & $blender --background --factory-startup --python $script -- --time $s[0] --camera $s[1] --samples $Samples --res $Res --save 0 | Select-String 'RENDERED|Error|Traceback'
}

# Рендерит набор кадров Pool Room в папку renders/.
param([int]$Samples = 1024, [string]$Res = '2560x1440')
$blender = Get-ChildItem 'C:\Program Files\Blender Foundation' -Recurse -Filter blender.exe | Select-Object -First 1 -ExpandProperty FullName
$script = Join-Path $PSScriptRoot 'pool_room.py'
$shots = @(
  @('noon', 'CameraHero'),
  @('noon', 'CameraLow'),
  @('glint', 'CameraPool'),
  @('evening', 'CameraHero'),
  @('night', 'CameraLow'),
  @('day', 'Camera'),
  @('noon', 'CameraMeadow2'),
  @('evening', 'CameraCorridor')
)
foreach ($s in $shots) {
  & $blender --background --factory-startup --python $script -- --time $s[0] --camera $s[1] --samples $Samples --res $Res --save 0 | Select-String 'RENDERED|Error|Traceback'
}

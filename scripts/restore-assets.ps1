$assets = "C:\Users\katko\Desktop\divane\divane-site\assets"
$night = Join-Path $assets "night-3-Ba3J82nB.jpg"
$bg = Join-Path $assets "background.png"
$bg2 = Join-Path $assets "background2.png"
$frame = Join-Path $assets "Frame 244.png"

$jpgTargets = @(
  "morning-1-48ZFs6MN.jpg","morning-2-BYaiLuvq.jpg","morning-3-Djoe_UWf.jpg","morning-4-BFeRX6yn.jpg",
  "night-2-M87CilwX.jpg","night-4-B707M2WH.jpg",
  "day-1-B-j-4icY.jpg","day-2-DCTqzDZf.jpg","day-3-DcdsBr8e.jpg","day-4-mV0FtEqT.jpg"
)

$pngFromBg = @(
  "morning-CcRdvl8L.png","morning-DCqPT9jh.png",
  "day-DKvZdU74.png","day-vnDxU6R_.png"
)

$pngFromBg2 = @(
  "night-1z0pI4rK.png","night-C5VCxznl.png"
)

$pngFromFrame = @(
  "macbook-morning-DXO3pEjE.png","macbook-day-CbRyii9T.png","macbook-night-D2FVOiw2.png"
)

foreach ($name in $jpgTargets) {
  Copy-Item $night (Join-Path $assets $name) -Force
  Write-Host "jpg -> $name"
}

foreach ($name in $pngFromBg) {
  Copy-Item $bg (Join-Path $assets $name) -Force
  Write-Host "png(bg) -> $name"
}

foreach ($name in $pngFromBg2) {
  Copy-Item $bg2 (Join-Path $assets $name) -Force
  Write-Host "png(bg2) -> $name"
}

foreach ($name in $pngFromFrame) {
  Copy-Item $frame (Join-Path $assets $name) -Force
  Write-Host "png(frame) -> $name"
}

Write-Host "Assets restored."

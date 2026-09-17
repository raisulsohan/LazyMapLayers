# Splits a very large image (JPEG or TIFF) into a grid of PNG pieces, for tools that cannot open it
# whole (Chromium limits canvases to 16384 pixels). Development tool, Windows only.
#   powershell -File tools\split-image.ps1 <image> <out folder> <columns> <rows>
param([string]$Source, [string]$OutDir, [int]$Columns = 4, [int]$Rows = 4)
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force $OutDir | Out-Null
$image = [System.Drawing.Image]::FromFile($Source)
$w = [int]($image.Width / $Columns); $h = [int]($image.Height / $Rows)
"{0} x {1}: {2} x {3} pieces of {4} x {5}" -f $image.Width, $image.Height, $Columns, $Rows, $w, $h
for ($r = 0; $r -lt $Rows; $r++) {
  for ($c = 0; $c -lt $Columns; $c++) {
    $piece = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($piece)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    $from = New-Object System.Drawing.Rectangle ($c * $w), ($r * $h), $w, $h
    $to = New-Object System.Drawing.Rectangle 0, 0, $w, $h
    $g.DrawImage($image, $to, $from, [System.Drawing.GraphicsUnit]::Pixel)
    $piece.Save((Join-Path $OutDir ("piece_{0}_{1}.png" -f $r, $c)), [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $piece.Dispose()
  }
}
$image.Dispose()
"done"

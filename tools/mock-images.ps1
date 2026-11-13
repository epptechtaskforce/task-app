# Draws the sample "photos" used by the mock data (docs/mock/*.jpg and *.thumb.jpg). Run: powershell -File tools/mock-images.ps1
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\docs\mock'
New-Item -ItemType Directory -Force $out | Out-Null
$W = 720; $H = 500
$rnd = New-Object System.Random 7

function C($hex, $a = 255) { $c = [System.Drawing.ColorTranslator]::FromHtml($hex); [System.Drawing.Color]::FromArgb($a, $c.R, $c.G, $c.B) }
function Brush($hex, $a = 255) { New-Object System.Drawing.SolidBrush (C $hex $a) }
function Grad($g, $x0, $y0, $x1, $y1, $a, $b) {
  $r = New-Object System.Drawing.RectangleF $x0, $y0, ([Math]::Max(1, $x1 - $x0)), ([Math]::Max(1, $y1 - $y0))
  $br = New-Object System.Drawing.Drawing2D.LinearGradientBrush $r, (C $a), (C $b), 90.0
  $g.FillRectangle($br, $r); $br.Dispose()
}
function Dot($g, $x, $y, $r, $hex, $a = 255) { $b = Brush $hex $a; $g.FillEllipse($b, [single]($x - $r), [single]($y - $r), [single](2 * $r), [single](2 * $r)); $b.Dispose() }
function RRect($g, $x, $y, $w, $h, $r, $hex, $a = 255) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = [single](2 * $r)
  $p.AddArc([single]$x, [single]$y, $d, $d, 180, 90); $p.AddArc([single]($x + $w - $d), [single]$y, $d, $d, 270, 90)
  $p.AddArc([single]($x + $w - $d), [single]($y + $h - $d), $d, $d, 0, 90); $p.AddArc([single]$x, [single]($y + $h - $d), $d, $d, 90, 90); $p.CloseFigure()
  $b = Brush $hex $a; $g.FillPath($b, $p); $b.Dispose(); $p.Dispose()
}
function Txt($g, $s, $x, $y, $size, $hex, $style = 'Bold', $align = 'Near') {
  $f = New-Object System.Drawing.Font 'Segoe UI', $size, ([System.Drawing.FontStyle]::$style), ([System.Drawing.GraphicsUnit]::Pixel)
  $sf = New-Object System.Drawing.StringFormat; $sf.Alignment = [System.Drawing.StringAlignment]::$align
  $b = Brush $hex; $g.DrawString($s, $f, $b, [single]$x, [single]$y, $sf); $b.Dispose(); $f.Dispose()
}
function Sky($g, $hz) {
  Grad $g 0 0 $W $hz '#8cc8f5' '#eaf6ff'; Dot $g ($W * 0.82) ($H * 0.14) 34 '#fff3b0'
}
function Poly($g, $pts, $hex) { $b = Brush $hex; $g.FillPolygon($b, [System.Drawing.PointF[]]$pts); $b.Dispose() }
function P($x, $y) { New-Object System.Drawing.PointF ([single]$x), ([single]$y) }

$paint = @{}
$paint['field'] = {
  param($g)
  $hz = $H * 0.4; Sky $g $hz
  $pts = @((P 0 $hz)); for ($x = 0; $x -le $W; $x += 40) { $pts += (P $x ($hz - 18 - 14 * [Math]::Sin($x / 90))) }; $pts += (P $W $hz); Poly $g $pts '#7fb069'
  Grad $g 0 $hz $W $H '#6b4a2f' '#4a3220'
  for ($i = -5; $i -le 5; $i++) {
    $vx = $W / 2; $bx = $W / 2 + $i * $W * 0.2
    Poly $g @((P ($vx + $i * 4) $hz), (P ($bx - $W * 0.06) $H), (P ($bx + $W * 0.06) $H), (P ($vx + $i * 4 + 4) $hz)) '#2f7d32'
    for ($k = 0; $k -lt 46; $k++) {
      $t = 0.08 + $rnd.NextDouble() * 0.92
      $x = $vx + $i * 4 + ($bx - $vx - $i * 4) * $t + ($rnd.NextDouble() - 0.5) * $W * 0.08 * $t; $y = $hz + ($H - $hz) * $t
      $col = if ($rnd.NextDouble() -lt 0.7) { '#c2185b' } else { '#3b3bb5' }
      Dot $g $x $y (1.5 + 6 * $t) $col
    }
  }
}
$paint['leak'] = {
  param($g)
  Grad $g 0 0 $W $H '#7a5a3a' '#3e2a1a'
  for ($i = 0; $i -lt 90; $i++) { Dot $g ($rnd.NextDouble() * $W) ($rnd.NextDouble() * $H) (1 + $rnd.NextDouble() * 3) '#000000' 46 }
  RRect $g -20 ($H * 0.34) ($W + 40) 64 12 '#15181c'; RRect $g -20 ($H * 0.34) ($W + 40) 14 8 '#ffffff' 30
  RRect $g ($W * 0.46) ($H * 0.3) 60 72 10 '#2b3138'; RRect $g ($W * 0.48) ($H * 0.3 - 8) 24 12 4 '#9aa5b1'
  $pen = New-Object System.Drawing.Pen (C '#78c8ff' 215), 3
  for ($i = 0; $i -lt 16; $i++) { $g.DrawBezier($pen, [single]($W * 0.5 + 8), [single]($H * 0.34 + 70), [single]($W * 0.5 + ($rnd.NextDouble() - 0.5) * 100), [single]($H * 0.45), [single]($W * 0.5 + ($rnd.NextDouble() - 0.5) * 200), [single]($H * 0.6), [single]($W * 0.5 + ($rnd.NextDouble() - 0.5) * 250), [single]($H * 0.78)) }
  $b = Brush '#4aa3df' 190; $g.FillEllipse($b, [single]($W * 0.2), [single]($H * 0.8 - 52), [single]($W * 0.6), 104)
  $b2 = Brush '#ffffff' 90; $g.FillEllipse($b2, [single]($W * 0.36), [single]($H * 0.78 - 12), [single]($W * 0.2), 24)
}
$paint['drip'] = {
  param($g)
  Grad $g 0 0 $W $H '#8a6a47' '#4d3622'
  for ($i = 0; $i -lt 70; $i++) { Dot $g ($rnd.NextDouble() * $W) ($rnd.NextDouble() * $H) (1 + $rnd.NextDouble() * 2.5) '#000000' 50 }
  $pen = New-Object System.Drawing.Pen (C '#111111'), 9; $g.DrawLine($pen, 0, [single]($H * 0.62), $W, [single]($H * 0.6))
  for ($i = 0; $i -lt 7; $i++) {
    $x = 50 + $i * ($W - 100) / 6; $y = $H * 0.61
    for ($l = 0; $l -lt 6; $l++) { $b = Brush '#2f9e44'; $g.FillEllipse($b, [single]($x + ($l - 2.5) * 11 - 11), [single]($y - 55 - [Math]::Abs($l - 2.5) * 6 - 38), 22, 76) }
    Dot $g $x ($y + 8) 6 '#4aa3df'; Dot $g $x ($y + 30) 4 '#4aa3df' 180
    $b = Brush '#2864a0' 90; $g.FillEllipse($b, [single]($x - 26), [single]($y + 44), 52, 16)
  }
}
$paint['crates'] = {
  param($g)
  Grad $g 0 0 $W ($H * 0.55) '#d9dde2' '#bcc3cb'; Grad $g 0 ($H * 0.55) $W $H '#8f959c' '#6c7279'
  for ($r = 0; $r -lt 3; $r++) { for ($c = 0; $c -lt 4; $c++) {
    $x = 70 + $c * 150 + ($r % 2) * 40; $y = $H * 0.82 - $r * 110
    RRect $g $x $y 136 100 8 '#e53935'; RRect $g ($x + 8) ($y + 18) 120 70 6 '#b71c1c'; RRect $g ($x + 40) ($y + 8) 56 12 6 '#7f0f0f'
    for ($k = 0; $k -lt 16; $k++) { $col = if ($rnd.NextDouble() -lt 0.5) { '#c2185b' } else { '#ad1457' }; Dot $g ($x + 18 + $rnd.NextDouble() * 100) ($y + 6 + $rnd.NextDouble() * 12) 9 $col }
  } }
}
$paint['chart'] = {
  param($g)
  $g.Clear((C '#ffffff')); Txt $g 'Results by block' 40 26 30 '#1c2430'
  $pen = New-Object System.Drawing.Pen (C '#cfd6df'), 1; for ($i = 0; $i -lt 6; $i++) { $y = 100 + $i * 58; $g.DrawLine($pen, 70, $y, ($W - 40), $y) }
  $cols = @('#8e24aa', '#3949ab', '#00897b', '#f9a825', '#e53935'); $vals = @(0.82, 0.64, 0.9, 0.48, 0.7)
  for ($i = 0; $i -lt 5; $i++) { $x = 100 + $i * 120; $hh = $vals[$i] * 290; RRect $g $x (390 - $hh) 74 $hh 6 $cols[$i]; Txt $g ('ABCDE'[$i]) ($x + 37) 396 20 '#586272' 'Bold' 'Center' }
}
$paint['cold'] = {
  param($g)
  $g.Clear((C '#1b2430')); RRect $g 90 80 ($W - 180) ($H - 220) 24 '#0d1117'
  Txt $g 'COLD ROOM 2' 130 110 26 '#7e8a99'; Txt $g '2.4' ($W / 2 - 40) 160 150 '#3ddc84' 'Bold' 'Center'; Txt $g 'C' ($W / 2 + 140) 175 56 '#3ddc84' 'Bold' 'Center'
  $pen = New-Object System.Drawing.Pen (C '#3ddc84'), 3; $pts = @(); for ($x = 130; $x -lt $W - 130; $x += 10) { $pts += (P $x (345 + [Math]::Sin($x / 30) * 8 + $rnd.NextDouble() * 6)) }; $g.DrawLines($pen, [System.Drawing.PointF[]]$pts)
  Txt $g 'OK  -  set point 3.0' 130 372 22 '#7e8a99'
}
$paint['sheet'] = {
  param($g)
  $g.Clear((C '#ffffff')); $b = Brush '#1e7e34'; $g.FillRectangle($b, 0, 0, $W, 44)
  Txt $g 'Date' 24 8 22 '#ffffff'; Txt $g 'Room' 200 8 22 '#ffffff'; Txt $g 'Temp' 340 8 22 '#ffffff'; Txt $g 'Checked by' 480 8 22 '#ffffff'
  for ($r = 0; $r -lt 8; $r++) { $y = 44 + $r * 50; $bb = if ($r % 2) { Brush '#f3f6f9' } else { Brush '#ffffff' }; $g.FillRectangle($bb, 0, $y, $W, 50)
    Txt $g ((10 + $r).ToString() + ' Nov') 24 ($y + 12) 20 '#1c2430' 'Regular'; Txt $g '2' 200 ($y + 12) 20 '#1c2430' 'Regular'; Txt $g (('{0:N1}' -f (2 + $rnd.NextDouble() * 1.4)) + ' C') 340 ($y + 12) 20 '#1c2430' 'Regular'; Txt $g @('Checked', 'Verified')[$r % 2] 480 ($y + 12) 20 '#1c2430' 'Regular' }
}
$paint['truck'] = {
  param($g)
  $hz = $H * 0.52; Sky $g $hz; $b = Brush '#9aa0a6'; $g.FillRectangle($b, 0, $hz, $W, $H - $hz); $wb = Brush '#ffffff'; for ($x = 0; $x -lt $W; $x += 90) { $g.FillRectangle($wb, $x, $H * 0.84, 50, 6) }
  RRect $g 80 ($H * 0.3) 380 190 10 '#fafafa'; Txt $g 'BERRY FRESH' 270 ($H * 0.3 + 80) 38 '#8e24aa' 'Bold' 'Center'; RRect $g 460 ($H * 0.4) 130 120 14 '#3949ab'; RRect $g 520 ($H * 0.43) 56 48 6 '#bfe3ff'
  foreach ($x in 150, 330, 520) { Dot $g $x ($H * 0.78) 34 '#222222'; Dot $g $x ($H * 0.78) 15 '#9aa0a6' }
}
$paint['extinguisher'] = {
  param($g)
  Grad $g 0 0 $W $H '#e8e1d4' '#cbc3b4'; RRect $g ($W / 2 - 60) 120 120 280 40 '#d32f2f'; RRect $g ($W / 2 - 18) 80 36 50 8 '#222222'; RRect $g ($W / 2 - 60) 190 120 90 6 '#fff3e0'
  Txt $g 'FIRE' ($W / 2) 215 34 '#d32f2f' 'Bold' 'Center'
  $pen = New-Object System.Drawing.Pen (C '#222222'), 8; $g.DrawBezier($pen, [single]($W / 2 + 18), 100, [single]($W / 2 + 120), 70, [single]($W / 2 + 120), 120, [single]($W / 2 + 110), 200)
  RRect $g ($W / 2 + 70) 300 70 44 4 '#ffffff'; Txt $g 'CHECKED' ($W / 2 + 105) 312 14 '#2e7d32' 'Bold' 'Center'
}

$jpg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
function Save-Jpeg($bmp, $path, $q) {
  $ep = New-Object System.Drawing.Imaging.EncoderParameters 1
  $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]$q)
  $bmp.Save($path, $jpg, $ep)
}
foreach ($kind in $paint.Keys) {
  $bmp = New-Object System.Drawing.Bitmap $W, $H
  $g = [System.Drawing.Graphics]::FromImage($bmp); $g.SmoothingMode = 'AntiAlias'; $g.TextRenderingHint = 'AntiAliasGridFit'
  & $paint[$kind] $g
  Txt $g 'SAMPLE PHOTO' ($W - 16) 10 15 '#ffffff' 'Bold' 'Far'
  Save-Jpeg $bmp (Join-Path $out "$kind.jpg") 70
  $t = New-Object System.Drawing.Bitmap 128, 89; $tg = [System.Drawing.Graphics]::FromImage($t); $tg.InterpolationMode = 'HighQualityBicubic'; $tg.DrawImage($bmp, 0, 0, 128, 89)
  Save-Jpeg $t (Join-Path $out "$kind.thumb.jpg") 50
  $g.Dispose(); $bmp.Dispose(); $tg.Dispose(); $t.Dispose()
}
Get-ChildItem $out | Select-Object Name, Length | Format-Table -AutoSize

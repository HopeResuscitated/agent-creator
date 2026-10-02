# node.ps1 — dot-sourced by the evals/bench PowerShell scripts: `. (Join-Path $PSScriptRoot 'node.ps1')` (from
# relaytest/: `. (Join-Path $PSScriptRoot '..\node.ps1')`). Sets $NodeBin to the pinned runner node by ABSOLUTE
# path, never `node` from PATH. Override with $env:NODE_BIN. Throws unless its version and sha256 equal the pin
# in evals/baseline-env.json.
$NodeBin = if ($env:NODE_BIN) { $env:NODE_BIN } else { 'C:\Users\cierra\AppData\Local\hermes\tools\node-26.7.0-win32-x64\node.exe' }
$pinFile = Join-Path $PSScriptRoot '..\baseline-env.json'
if (-not (Test-Path $pinFile)) { $pinFile = Join-Path $PSScriptRoot '..\..\baseline-env.json' }
$pin = Get-Content -Raw $pinFile | ConvertFrom-Json
if (-not (Test-Path -LiteralPath $NodeBin)) { throw "pinned node not found: NODE_BIN=$NodeBin" }
$haveVer = (& $NodeBin --version).Trim()
$haveSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $NodeBin).Hash.ToLowerInvariant()
if ($haveVer -ne $pin.node -or $haveSha -ne $pin.node_sha256) {
  throw "NODE_BIN=$NodeBin is $haveVer sha256=$haveSha; pinned $($pin.node) sha256=$($pin.node_sha256) (evals/baseline-env.json)"
}
$env:NODE_BIN = $NodeBin

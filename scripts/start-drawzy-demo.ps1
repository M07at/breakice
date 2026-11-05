#requires -Version 7.4
param(
  [string]$RuntimeRoot = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) '.local-services'),
  [string]$ProjectRef = 'qfgyotxmcqmrbpjktuzo',
  [int]$Port = 8787
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$source = Join-Path $RuntimeRoot 'drawzy-ai'
$python = Join-Path $source '.venv/Scripts/python.exe'
$cloudflared = Join-Path $RuntimeRoot 'cloudflared.exe'
$credentialsPath = Join-Path $RuntimeRoot 'drawzy-secret.env'
foreach ($path in @($python, $cloudflared, (Join-Path $source 'app/core/model/model_75_v1.h5'))) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Missing AI runtime: $path. See docs/c/drawing-scoring.md." }
}
if (Test-Path -LiteralPath $credentialsPath) {
  $token = [regex]::Match((Get-Content -LiteralPath $credentialsPath -Raw), '(?m)^DRAWZY_TOKEN=([a-f0-9]{64})\r?$').Groups[1].Value
  if ($token.Length -ne 64) { throw 'Invalid local AI credentials; refusing to replace an existing token.' }
} else {
  $token = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
  Set-Content -LiteralPath $credentialsPath -Value "DRAWZY_TOKEN=$token" -Encoding utf8
}
function Test-Recognizer([string]$Url) {
  try {
    $health = Invoke-RestMethod -Uri "$Url/health" -TimeoutSec 5
    return $health.status -eq 'ready' -and $health.classes -eq 46
  } catch { return $false }
}
$localUrl = "http://127.0.0.1:$Port"
if (-not (Test-Recognizer $localUrl)) {
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $Port is already used by another service. No process was stopped."
  }
  Start-Process -FilePath $python -ArgumentList @('-m', 'uvicorn', 'drawzy_server:app', '--app-dir', ('"{0}"' -f $PSScriptRoot), '--host', '127.0.0.1', '--port', $Port) `
    -Environment @{ DRAWZY_SOURCE = $source; DRAWZY_TOKEN = $token; TF_CPP_MIN_LOG_LEVEL = '2' } -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $RuntimeRoot 'drawzy-server.out.log') -RedirectStandardError (Join-Path $RuntimeRoot 'drawzy-server.err.log') | Out-Null
  $deadline = (Get-Date).AddSeconds(60)
  while (-not (Test-Recognizer $localUrl)) {
    if ((Get-Date) -gt $deadline) { throw 'Recognizer did not become ready; inspect drawzy-server.err.log.' }
    Start-Sleep -Seconds 1
  }
}
$tunnelLog = Join-Path $RuntimeRoot 'cloudflared.err.log'
$existingTunnel = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $cloudflared -and $_.CommandLine -like "*--url $localUrl*" }
if (-not $existingTunnel) {
  Start-Process -FilePath $cloudflared -ArgumentList @('tunnel', '--url', $localUrl, '--no-autoupdate', '--protocol', 'http2') -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $RuntimeRoot 'cloudflared.out.log') -RedirectStandardError $tunnelLog | Out-Null
}
$deadline = (Get-Date).AddSeconds(60)
$tunnelUrl = ''
do {
  if (Test-Path -LiteralPath $tunnelLog) {
    $tunnelUrl = [regex]::Match((Get-Content -LiteralPath $tunnelLog -Raw), 'https://[a-z0-9-]+\.trycloudflare\.com').Value
  }
  if ($tunnelUrl -and (Test-Recognizer $tunnelUrl)) { break }
  if ((Get-Date) -gt $deadline) { throw 'Public tunnel did not become ready; inspect cloudflared.err.log.' }
  Start-Sleep -Seconds 2
} while ($true)
# Never put this token into VITE_ variables, command arguments, or Git.
Set-Content -LiteralPath $credentialsPath -Value @("DRAWZY_TOKEN=$token", "AI_BASE_URL=$tunnelUrl") -Encoding utf8
Push-Location $repoRoot
try {
  & npx --yes supabase@3.0.0 secrets set --env-file $credentialsPath "--remote=$ProjectRef" --yes
  if ($LASTEXITCODE -ne 0) { throw 'Supabase update failed. Sign in using npx supabase login, then run this script again.' }
} finally { Pop-Location }
Write-Output 'AI recognizer and tunnel are healthy; Supabase endpoint configuration is updated. Keep this PC awake for the demo.'

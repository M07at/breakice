# Build the CloudRun deployment zip (Windows)
# Usage: & scripts/pack-cloudrun.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $root 'deploy\cloudrun\_stage'
$dist = Join-Path $root 'deploy\cloudrun\dist'
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $dist -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stage -Force | Out-Null
New-Item -ItemType Directory -Path $dist -Force | Out-Null
foreach ($f in 'Dockerfile','nginx.conf','entrypoint.sh','storage-shim.ts','env.example') {
  Copy-Item (Join-Path $root ('deploy\cloudrun\' + $f)) $stage -Force
}
Copy-Item (Join-Path $root 'supabase\migrations') $stage -Recurse -Force
Copy-Item (Join-Path $root 'supabase\local') $stage -Recurse -Force
Copy-Item (Join-Path $root 'supabase\functions') $stage -Recurse -Force
$zip = Join-Path $dist 'cloudrun.zip'
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
Write-Host ('zip ready: ' + $zip + '  ' + [math]::Round((Get-Item $zip).Length / 1MB, 2) + ' MB')

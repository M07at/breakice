# Apply the 26 migrations to a local PostgreSQL (no Docker needed).
#
# Usage:
#   & scripts/apply-migrations-local.ps1 -PgBin D:\1\pg-portable\pgsql\bin -Port 5433 -Database breakice
#
# Prerequisite: a local PostgreSQL instance already initialized and running.

param(
  [Parameter(Mandatory = $true)][string]$PgBin,
  [int]$Port = 5433,
  [string]$Database = 'breakice',
  [string]$User = 'postgres'
)

$ErrorActionPreference = 'Stop'
$psql = Join-Path $PgBin 'psql.exe'
if (-not (Test-Path $psql)) { throw "psql not found: $psql" }

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrations = Get-ChildItem (Join-Path $repoRoot 'supabase\migrations') -Filter '*.sql' | Sort-Object Name

$env:PGPASSWORD = 'postgres'
$env:PGCLIENTENCODING = 'UTF8'

function Invoke-Sql([string]$file) {
  # psql writes NOTICE to stderr; PowerShell would treat that as a terminating error,
  # so capture everything as text and rely on the exit code instead.
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = & $psql -h 127.0.0.1 -p $Port -U $User -d $Database -v ON_ERROR_STOP=1 -q -f $file 2>&1 | Out-String
  $code = $LASTEXITCODE
  $script:lastOutput = $output
  $ErrorActionPreference = $previous
  return $code
}

Write-Host "== step 1/3: supabase shim =="
$shim = Join-Path $repoRoot 'supabase\local\00-supabase-shim.sql'
$code = Invoke-Sql $shim
if ($code -ne 0) { Write-Host "shim FAILED (exit $code)"; exit 1 }

Write-Host "== step 2/3: migrations =="
$failed = @()
$passed = 0
foreach ($m in $migrations) {
  $code = Invoke-Sql $m.FullName
  if ($code -eq 0) {
    $passed++
    Write-Host ("  OK   " + $m.Name)
  } else {
    $failed += $m.Name
    Write-Host ("  FAIL " + $m.Name)
    Write-Host ($script:lastOutput.Trim())
  }
}

Write-Host "== step 3/3: summary =="
Write-Host ("passed " + $passed + " / " + $migrations.Count)
if ($failed.Count -gt 0) {
  Write-Host ("failed: " + ($failed -join ', '))
  exit 1
}
Write-Host "ALL MIGRATIONS PASSED"

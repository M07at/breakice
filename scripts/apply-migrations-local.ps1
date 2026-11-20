# 本地验证 26 支迁移（不需要 Docker）
#
# 用法：
#   pwsh -File scripts/apply-migrations-local.ps1 -PgBin D:\1\pg-portable\pgsql\bin `
#       -Port 5433 -Db breakice
#
# 前提：已经 initdb 并启动了一个本地 PostgreSQL 实例（见 docs/技术推进计划.md 阶段四）。

param(
  [Parameter(Mandatory = $true)][string]$PgBin,
  [int]$Port = 5433,
  [string]$Db = 'breakice',
  [string]$User = 'postgres'
)

$ErrorActionPreference = 'Stop'
$psql = Join-Path $PgBin 'psql.exe'
if (-not (Test-Path $psql)) { throw "找不到 psql：$psql" }

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrations = Get-ChildItem (Join-Path $repoRoot 'supabase\migrations') -Filter '*.sql' |
  Sort-Object Name

$env:PGPASSWORD = 'postgres'
$env:PGCLIENTENCODING = 'UTF8'

function Invoke-Sql([string]$file) {
  & $psql -h 127.0.0.1 -p $Port -U $User -d $Db -v ON_ERROR_STOP=1 -q -f $file 2>&1
  return $LASTEXITCODE
}

Write-Host "== 1/3 应用 Supabase 兼容层 ==" -ForegroundColor Cyan
$shim = Join-Path $repoRoot 'supabase\local\00-supabase-shim.sql'
$code = Invoke-Sql $shim
if ($code -ne 0) { Write-Host "兼容层失败（exit $code）" -ForegroundColor Red; exit 1 }

Write-Host "== 2/3 依次执行迁移 ==" -ForegroundColor Cyan
$failed = @()
$passed = 0
foreach ($m in $migrations) {
  $code = Invoke-Sql $m.FullName
  if ($code -eq 0) {
    $passed++
    Write-Host ("  OK   " + $m.Name) -ForegroundColor Green
  } else {
    $failed += $m.Name
    Write-Host ("  FAIL " + $m.Name) -ForegroundColor Red
  }
}

Write-Host "== 3/3 结果 ==" -ForegroundColor Cyan
Write-Host ("通过 " + $passed + " / " + $migrations.Count)
if ($failed.Count -gt 0) {
  Write-Host ("失败：" + ($failed -join ', ')) -ForegroundColor Red
  exit 1
}
Write-Host "全部迁移通过" -ForegroundColor Green

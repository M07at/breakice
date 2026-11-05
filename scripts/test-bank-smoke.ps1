#requires -Version 7.4
param([string]$WeChatCli = 'E:\微信web开发者工具\wechatide.cmd')
$ErrorActionPreference = 'Stop'
$bankRepoRoot = Split-Path $PSScriptRoot -Parent
$bankTestProject = Join-Path $bankRepoRoot 'app/reports/bank-smoke-project'
$bankEvidence = [System.Collections.Generic.List[object]]::new()
function Invoke-WeChatTest([string]$Action, [string[]]$Arguments = @()) {
  $raw = & $WeChatCli -c Codex $Action --project $bankTestProject @Arguments | Out-String
  $jsonOffset = $raw.IndexOf('{')
  if ($jsonOffset -lt 0) { throw "No result from $Action" }
  $value = $raw.Substring($jsonOffset) | ConvertFrom-Json
  if (-not $value.ok) { throw "$Action failed: $($value.message)" }
  return $value.result
}
function Read-SmokeResult {
  for ($attempt=0; $attempt -lt 8; $attempt++) {
    try { $reply = Invoke-WeChatTest 'automation_evaluate' @('--fn-source', 'function(){return getCurrentPages().pop().data}') }
    catch {
      if ($_.Exception.Message -notmatch 'timeout|ECONNRESET' -or $attempt -ge 2) { throw }
      Start-Sleep -Seconds 2
      continue
    }
    $data = $reply.result.result
    if ($data.status -eq 'FAIL') { throw $data.error }
    if ($data.status -like 'PASS:*') { $bankEvidence.Add($data); return }
    Start-Sleep -Milliseconds 500
  }
  throw 'Native bank smoke did not finish'
}
Push-Location $bankRepoRoot
try {
  & node scripts/prepare-bank-smoke.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Preparing isolated smoke project failed' }
  Invoke-WeChatTest 'open_project_window' | Out-Null
  $pending = Invoke-WeChatTest 'automation_evaluate' @('--fn-source', "function(){return Boolean(wx.getStorageSync('pobingju:bank-smoke:v22'))}")
  if ($pending.result.result -eq $true) {
    Invoke-WeChatTest 'simulator_open_page' @('--page', 'pages/qa/bank-smoke', '--query', 'phase=resume') | Out-Null
    Read-SmokeResult
  }
  Invoke-WeChatTest 'simulator_open_page' @('--page', 'pages/qa/bank-smoke') | Out-Null
  Read-SmokeResult
  Invoke-WeChatTest 'simulator_refresh' | Out-Null
  Invoke-WeChatTest 'simulator_open_page' @('--page', 'pages/qa/bank-smoke', '--query', 'phase=resume') | Out-Null
  Read-SmokeResult
  Invoke-WeChatTest 'simulator_open_page' @('--page', 'pages/qa/bank-smoke', '--query', 'phase=file-io') | Out-Null
  Read-SmokeResult
  $bankEvidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $bankRepoRoot 'app/reports/bank-smoke-native.json') -Encoding utf8
  Write-Output 'PASS: native bank CRUD, CSV/JSON, persistence, owner/read-only rules and file IO.'
} finally {
  try { Invoke-WeChatTest 'close_project_window' | Out-Null } catch { Write-Warning $_.Exception.Message }
  Pop-Location
}

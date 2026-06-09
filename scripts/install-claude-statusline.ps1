param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$source = Join-Path $PSScriptRoot "claude-code-statusline.ps1"
if (!(Test-Path -LiteralPath $source)) {
  throw "Missing $source."
}

$claudeDir = Join-Path $HOME ".claude"
New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null

$target = Join-Path $claudeDir "ai-usage-dock-statusline.ps1"
Copy-Item -LiteralPath $source -Destination $target -Force

$settingsPath = Join-Path $claudeDir "settings.json"
if (Test-Path -LiteralPath $settingsPath) {
  $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
  $backup = "$settingsPath.bak-$(Get-Date -Format 'yyyyMMddHHmmss')"
  Copy-Item -LiteralPath $settingsPath -Destination $backup
} else {
  $settings = [pscustomobject]@{}
}

if ($settings.PSObject.Properties["statusLine"] -and -not $Force) {
  throw "Claude Code already has statusLine configured. Re-run with -Force to replace it. A backup is created first."
}

$command = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$target`""
$statusLine = [pscustomobject]@{
  type = "command"
  command = $command
  refreshInterval = 30
}

if ($settings.PSObject.Properties["statusLine"]) {
  $settings.statusLine = $statusLine
} else {
  $settings | Add-Member -NotePropertyName "statusLine" -NotePropertyValue $statusLine
}

$settings | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $settingsPath -Encoding UTF8

Write-Output "Installed Claude Code status-line export."
Write-Output "Export file will be written to: $(Join-Path $HOME '.ai-usage-dock\\claude-code-usage.json')"

param()

$ErrorActionPreference = "Stop"

# Vessel status-line hook for Claude Code.
# Claude Code pipes a JSON payload to this script. We save the subscriber rate limits
# to ~/.vessel/claude-code-usage.json so Vessel can read them, and print a short status line.

function Get-JsonProperty {
  param(
    [Parameter(Mandatory = $true)] $Object,
    [Parameter(Mandatory = $true)] [string[]] $Names
  )

  foreach ($name in $Names) {
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$name]
    if ($null -ne $property) { return $property.Value }
  }

  return $null
}

function New-RateLimitExport {
  param($Window)

  if ($null -eq $Window) { return $null }
  $used = Get-JsonProperty $Window @("used_percentage", "usedPercentage")
  if ($null -eq $used) { return $null }

  [ordered]@{
    used_percentage = [int][Math]::Round([double]$used)
    resets_at = Get-JsonProperty $Window @("resets_at", "resetsAt", "reset_at", "resetAt")
  }
}

try {
  $raw = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($raw)) {
    Write-Output "Claude"
    exit 0
  }

  $payload = $raw | ConvertFrom-Json
  $rateLimits = Get-JsonProperty $payload @("rate_limits", "rateLimits")
  $fiveHour = New-RateLimitExport (Get-JsonProperty $rateLimits @("five_hour", "fiveHour"))
  $sevenDay = New-RateLimitExport (Get-JsonProperty $rateLimits @("seven_day", "sevenDay"))

  $export = [ordered]@{
    source = "vessel_claude_statusline"
    captured_at = (Get-Date).ToUniversalTime().ToString("o")
    rate_limits = [ordered]@{}
  }

  if ($null -ne $fiveHour) { $export.rate_limits["five_hour"] = $fiveHour }
  if ($null -ne $sevenDay) { $export.rate_limits["seven_day"] = $sevenDay }

  $exportDir = Join-Path $HOME ".vessel"
  New-Item -ItemType Directory -Path $exportDir -Force | Out-Null
  $exportPath = Join-Path $exportDir "claude-code-usage.json"
  $export | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $exportPath -Encoding UTF8

  $parts = @()
  if ($null -ne $fiveHour) { $parts += "5h: $($fiveHour.used_percentage)%" }
  if ($null -ne $sevenDay) { $parts += "7d: $($sevenDay.used_percentage)%" }

  if ($parts.Count -gt 0) {
    Write-Output "Claude $($parts -join ' ')"
  } else {
    Write-Output "Claude usage unavailable"
  }
} catch {
  Write-Output "Claude usage unavailable"
}

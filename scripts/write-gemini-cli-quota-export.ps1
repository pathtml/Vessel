param(
  [Parameter(Mandatory = $true)]
  [string]$QuotaJsonPath
)

$ErrorActionPreference = "Stop"

if (!(Test-Path -LiteralPath $QuotaJsonPath)) {
  throw "Quota JSON file was not found: $QuotaJsonPath"
}

$raw = Get-Content -LiteralPath $QuotaJsonPath -Raw
$payload = $raw | ConvertFrom-Json
$buckets = @()

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

if ($payload.PSObject.Properties["buckets"]) {
  $buckets = @($payload.buckets)
} elseif ($payload.PSObject.Properties["modelQuotas"]) {
  $buckets = @($payload.modelQuotas)
} elseif ($payload.PSObject.Properties["models"]) {
  $buckets = @($payload.models)
}

$exportBuckets = foreach ($bucket in $buckets) {
  [ordered]@{
    modelId = Get-JsonProperty $bucket @("modelId", "model_id", "model")
    remainingAmount = Get-JsonProperty $bucket @("remainingAmount", "remaining_amount", "remaining")
    remainingFraction = Get-JsonProperty $bucket @("remainingFraction", "remaining_fraction")
    resetTime = Get-JsonProperty $bucket @("resetTime", "reset_time", "resetAt")
  }
}

$export = [ordered]@{
  source = "gemini_cli_local"
  captured_at = (Get-Date).ToUniversalTime().ToString("o")
  buckets = @($exportBuckets)
}

$exportDir = Join-Path $HOME ".ai-usage-dock"
New-Item -ItemType Directory -Path $exportDir -Force | Out-Null
$exportPath = Join-Path $exportDir "gemini-cli-usage.json"
$export | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $exportPath -Encoding UTF8

Write-Output "Wrote Gemini CLI quota export to: $exportPath"

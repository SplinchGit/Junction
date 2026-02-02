$ErrorActionPreference = "Stop"

function Get-PropValue {
  param(
    [string]$Path,
    [string]$Key
  )
  if (!(Test-Path -LiteralPath $Path)) { return $null }
  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if ($trimmed -eq "" -or $trimmed.StartsWith("#")) { continue }
    if ($trimmed -match "^\s*$Key\s*=") {
      return $trimmed.Split("=", 2)[1].Trim()
    }
  }
  return $null
}

function Mask-Value {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return "<missing>" }
  if ($Value.Length -le 12) { return $Value }
  return $Value.Substring(0, 6) + "..." + $Value.Substring($Value.Length - 4)
}

$root = (Get-Location).Path

Write-Output "== Android =="
$gsPath = Join-Path $root "app\\google-services.json"
if (Test-Path -LiteralPath $gsPath) {
  $gs = Get-Content -LiteralPath $gsPath | ConvertFrom-Json
  $projectId = $gs.project_info.project_id
  $packageName = $gs.client[0].client_info.android_client_info.package_name
  $oauthCount = 0
  foreach ($client in $gs.client) {
    if ($null -ne $client.oauth_client) { $oauthCount += $client.oauth_client.Count }
  }
  Write-Output ("google-services.json: OK (project_id={0}, package={1}, oauth_client_count={2})" -f $projectId, $packageName, $oauthCount)
} else {
  Write-Output "google-services.json: MISSING"
}

$localProps = Join-Path $root "local.properties"
$webClientId = Get-PropValue -Path $localProps -Key "JUNCTION_WEB_CLIENT_ID"
$realtimeEndpoint = Get-PropValue -Path $localProps -Key "JUNCTION_REALTIME_ENDPOINT"
$realtimeClientSecret = Get-PropValue -Path $localProps -Key "JUNCTION_REALTIME_CLIENT_SECRET_ENDPOINT"
Write-Output ("JUNCTION_WEB_CLIENT_ID: {0}" -f (Mask-Value $webClientId))
Write-Output ("JUNCTION_REALTIME_ENDPOINT: {0}" -f (Mask-Value $realtimeEndpoint))
Write-Output ("JUNCTION_REALTIME_CLIENT_SECRET_ENDPOINT: {0}" -f (Mask-Value $realtimeClientSecret))

Write-Output ""
Write-Output "== Web =="
$webEnv = Join-Path $root "web\\.env"
$webKeys = @(
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
  "VITE_FIREBASE_MEASUREMENT_ID",
  "VITE_REALTIME_ENDPOINT"
)
if (Test-Path -LiteralPath $webEnv) {
  foreach ($key in $webKeys) {
    $value = Get-PropValue -Path $webEnv -Key $key
    Write-Output ("{0}: {1}" -f $key, (Mask-Value $value))
  }
} else {
  Write-Output "web/.env: MISSING"
}

Write-Output ""
Write-Output "== Server =="
$serverEnv = Join-Path $root "server\\.env"
if (Test-Path -LiteralPath $serverEnv) {
  $openAi = Get-PropValue -Path $serverEnv -Key "OPENAI_API_KEY"
  $svc = Get-PropValue -Path $serverEnv -Key "FIREBASE_SERVICE_ACCOUNT_JSON"
  $gac = Get-PropValue -Path $serverEnv -Key "GOOGLE_APPLICATION_CREDENTIALS"
  Write-Output ("OPENAI_API_KEY: {0}" -f (Mask-Value $openAi))
  if (![string]::IsNullOrWhiteSpace($svc) -or ![string]::IsNullOrWhiteSpace($gac)) {
    Write-Output "Firebase Admin creds: OK"
  } else {
    Write-Output "Firebase Admin creds: MISSING (set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS)"
  }
} else {
  Write-Output "server/.env: MISSING"
}

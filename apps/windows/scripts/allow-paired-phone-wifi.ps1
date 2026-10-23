param(
  [Parameter(Mandatory = $true)][ValidatePattern('^\d{1,3}(\.\d{1,3}){3}$')][string]$PhoneAddress,
  [Parameter(Mandatory = $true)][ValidatePattern('^\d{1,3}(\.\d{1,3}){3}$')][string]$PcAddress
)

$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
$program = (Resolve-Path -LiteralPath (Join-Path $workspace 'apps/windows/dist/nethra-agent-chat-20261022/Junction.exe')).Path
$wifi = Get-NetIPAddress -InterfaceAlias WiFi -AddressFamily IPv4 | Where-Object IPAddress -EQ $PcAddress
if (-not $wifi) { throw 'The PC address is not assigned to the WiFi adapter.' }
$phone = [System.Net.IPAddress]::Parse($PhoneAddress)
if ($phone.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or $PhoneAddress -eq $PcAddress) {
  throw 'A distinct IPv4 phone address is required.'
}
$ruleName = "Junction paired phone WiFi $PhoneAddress"
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
  $filter = Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $existing
  if ($existing.Enabled -eq 'True' -and $existing.Action -eq 'Allow' -and $filter.RemoteAddress -contains $PhoneAddress) {
    Write-Output "Scoped Junction firewall rule already exists for $PhoneAddress."
    exit 0
  }
  throw 'A rule with this name exists but does not match the expected scope; inspect it manually.'
}
New-NetFirewallRule -DisplayName $ruleName -Description 'Pinned-TLS Junction API for this one paired phone on hostel WiFi.' `
  -Direction Inbound -Action Allow -Enabled True -Profile Public -Protocol TCP -LocalPort 43111 `
  -LocalAddress $PcAddress -RemoteAddress $PhoneAddress -InterfaceAlias WiFi -Program $program | Out-Null
Write-Output "Allowed only $PhoneAddress to reach Junction on $PcAddress`:43111 over WiFi."

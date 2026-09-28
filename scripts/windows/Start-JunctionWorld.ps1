param(
    [ValidateSet('gui', 'headless')]
    [string] $Type = 'gui',

    [ValidateRange(5, 60)]
    [int] $TimeoutSeconds = 30,

    [switch] $ValidateOnly
)

$ErrorActionPreference = 'Stop'
$VBoxCommand = Get-Command VBoxManage.exe -ErrorAction SilentlyContinue
$VBoxManage = if ($VBoxCommand) { $VBoxCommand.Source } else { Join-Path $env:ProgramFiles 'Oracle\VirtualBox\VBoxManage.exe' }
if (-not (Test-Path -LiteralPath $VBoxManage)) { throw 'Install official Oracle VirtualBox before starting Junction World.' }

function Invoke-VBox {
    param([Parameter(Mandatory = $true)][string[]] $Arguments)
    $result = & $VBoxManage @Arguments
    if ($LASTEXITCODE -ne 0) { throw "VBoxManage failed: $($Arguments -join ' ')" }
    return $result
}

function Read-VmInfo {
    $rows = Invoke-VBox -Arguments @('showvminfo', 'junction-world', '--machinereadable')
    $map = @{}
    foreach ($row in $rows) {
        if ($row -match '^([^=]+)=(.*)$') { $map[$Matches[1]] = $Matches[2].Trim('"') }
    }
    return @{ Rows = $rows; Values = $map }
}

$info = Read-VmInfo
if ($info.Values.VMState -ne 'poweroff') { throw "junction-world must be fully powered off before the guarded start (current state: $($info.Values.VMState))." }
if ($info.Values.memory -ne '2048' -or $info.Values.cpus -ne '2') { throw 'VM resource settings changed; expected exactly 2048 MiB RAM and 2 vCPUs.' }
if ($info.Values.nic1 -ne 'nat' -or (@('nic2', 'nic3', 'nic4', 'nic5', 'nic6', 'nic7', 'nic8') | Where-Object { $info.Values[$_] -ne 'none' })) { throw 'Expected only NIC 1 attached to NAT.' }
if ($info.Values.clipboard -ne 'disabled' -or $info.Values.draganddrop -ne 'disabled' -or $info.Values.audio -ne 'none' -or $info.Values.vrde -ne 'off' -or $info.Values.usb -ne 'off' -or $info.Values.recording_enabled -ne 'off') {
    throw 'A host/guest convenience or recording feature is enabled; inspect VM settings before starting.'
}
$forwardRows = @($info.Rows | Where-Object { $_ -match '^Forwarding\(\d+\)\s*=' })
if ($forwardRows.Count -gt 1) { throw 'Only the single reviewed Junction World audit forward is allowed.' }
if ($forwardRows.Count -eq 1) {
    $forward = ($forwardRows[0] -replace '^Forwarding\(\d+\)\s*=', '').Trim('"').Split(',')
    $expectedForward = @('junction-world-audit', 'tcp', '127.0.0.1', '43130', '10.0.2.15', '43130')
    if ($forward.Count -ne $expectedForward.Count -or (($forward -join ',') -cne ($expectedForward -join ','))) {
        throw 'A NAT forward other than the reviewed loopback-only audit route is configured.'
    }
}
$details = Invoke-VBox -Arguments @('showvminfo', 'junction-world', '--details')
if ($details | Where-Object { $_ -match '^\s*Shared folders:\s*(?!<none>)\S' }) { throw 'A shared folder is configured; remove it before starting.' }
if ($details | Where-Object { $_ -match '^\s*USB Device Filters:\s*(?!<none>)\S' }) { throw 'A host USB passthrough filter is configured; remove it before starting.' }
if ($ValidateOnly) {
    Write-Output 'Static junction-world resource, adapter, integration-channel, port-forward and shared-folder checks passed. Live NAT loopback must still be checked at startup.'
    return
}

# VirtualBox 7.2 has reported localhostReachable=1 after earlier GUI starts.
# Start disconnected, verify the live NAT engine, then bring up its cable.
Invoke-VBox -Arguments @('modifyvm', 'junction-world', '--nat-localhostreachable1', 'off', '--cableconnected1', 'off', '--natdnsproxy1', 'on', '--natdnshostresolver1', 'off', '--clipboard-mode', 'disabled', '--clipboard-file-transfers', 'disabled', '--drag-and-drop', 'disabled', '--audio-enabled', 'off', '--audio-in', 'off', '--audio-out', 'off', '--audio-driver', 'none', '--vrde', 'off', '--keyboard', 'usb', '--mouse', 'usbtablet', '--usb-ohci', 'off', '--usb-ehci', 'off', '--usb-xhci', 'on', '--usb-card-reader', 'off', '--recording', 'off', '--accelerate3d', 'off', '--nested-hw-virt', 'off') | Out-Null
$info = Read-VmInfo
if ($info.Values.localhostReachable -ne '0') { throw 'VirtualBox did not apply localhost loopback isolation while powered off.' }

Invoke-VBox -Arguments @('startvm', 'junction-world', '--type', $Type) | Out-Null
$deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
do {
    Start-Sleep -Milliseconds 500
    $info = Read-VmInfo
    if ($info.Values.VMState -eq 'running') { break }
} while ([DateTime]::UtcNow -lt $deadline)

if ($info.Values.VMState -ne 'running' -or $info.Values.localhostReachable -ne '0') {
    & $VBoxManage controlvm 'junction-world' setlinkstate1 off 2>$null | Out-Null
    & $VBoxManage controlvm 'junction-world' acpipowerbutton 2>$null | Out-Null
    throw 'The running NAT engine did not confirm localhostReachable=0. The virtual cable was left disconnected; shut the VM down from VirtualBox Manager after reviewing it.'
}

Invoke-VBox -Arguments @('controlvm', 'junction-world', 'setlinkstate1', 'on') | Out-Null
$info = Read-VmInfo
if ($info.Values.localhostReachable -ne '0') {
    & $VBoxManage controlvm 'junction-world' setlinkstate1 off 2>$null | Out-Null
    & $VBoxManage controlvm 'junction-world' acpipowerbutton 2>$null | Out-Null
    throw 'Loopback isolation changed when the NAT cable was connected. The VM was disconnected; shut it down from VirtualBox Manager after reviewing it.'
}

Write-Output 'junction-world is running. Live VirtualBox NAT localhostReachable=0; only its NAT network cable was connected after that value was verified.'

param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string] $DebianIso,

    [string] $VmRoot = (Join-Path $env:USERPROFILE 'VirtualBox VMs')
)

$ErrorActionPreference = 'Stop'
$VBoxCommand = Get-Command VBoxManage.exe -ErrorAction SilentlyContinue
$VBoxManage = if ($VBoxCommand) { $VBoxCommand.Source } else { $null }
if (-not $VBoxManage) {
    $candidate = Join-Path $env:ProgramFiles 'Oracle\VirtualBox\VBoxManage.exe'
    if (Test-Path -LiteralPath $candidate) { $VBoxManage = $candidate }
}
if (-not $VBoxManage) { throw 'Oracle VirtualBox is not installed. Install the official Oracle Windows package, then retry.' }
$ResolvedIso = (Resolve-Path -LiteralPath $DebianIso).Path
if ([IO.Path]::GetExtension($ResolvedIso) -ne '.iso') { throw 'Debian installer input must be an ISO file.' }
if ((& $VBoxManage list vms) -match '"junction-world"') { throw 'A VM named junction-world already exists; refusing to alter it.' }
$null = New-Item -ItemType Directory -Path $VmRoot -Force

& $VBoxManage createvm --name 'junction-world' --ostype 'Debian_64' --basefolder $VmRoot --register
if ($LASTEXITCODE -ne 0) { throw 'VirtualBox could not create junction-world.' }
& $VBoxManage modifyvm 'junction-world' --memory 2048 --cpus 2 --ioapic on --firmware bios --nic1 nat --cableconnected1 off --natdnsproxy1 on --natdnshostresolver1 off --nat-localhostreachable1 off --clipboard-mode disabled --clipboard-file-transfers disabled --drag-and-drop disabled --audio-enabled off --audio-in off --audio-out off --audio-driver none --vrde off --keyboard usb --mouse usbtablet --usb-ohci off --usb-ehci off --usb-xhci on --usb-card-reader off --recording off --recording-screens none --accelerate3d off --nested-hw-virt off
if ($LASTEXITCODE -ne 0) { throw 'VirtualBox could not apply the required isolation/resource settings.' }
& $VBoxManage createhd --filename (Join-Path $VmRoot 'junction-world\junction-world.vdi') --size 16384 --format VDI --variant Standard
if ($LASTEXITCODE -ne 0) { throw 'VirtualBox could not create the 16 GiB dynamically allocated disk sized for Debian plus about 10 GB of usable workspace.' }
& $VBoxManage storagectl 'junction-world' --name 'SATA' --add sata --controller IntelAhci --portcount 2
if ($LASTEXITCODE -ne 0) { throw 'VirtualBox could not create the SATA controller.' }
& $VBoxManage storageattach 'junction-world' --storagectl 'SATA' --port 0 --device 0 --type hdd --medium (Join-Path $VmRoot 'junction-world\junction-world.vdi')
if ($LASTEXITCODE -ne 0) { throw 'VirtualBox could not attach the virtual disk.' }
& $VBoxManage storagectl 'junction-world' --name 'IDE' --add ide
if ($LASTEXITCODE -ne 0) { throw 'VirtualBox could not create an installer controller.' }
& $VBoxManage storageattach 'junction-world' --storagectl 'IDE' --port 0 --device 0 --type dvddrive --medium $ResolvedIso
if ($LASTEXITCODE -ne 0) { throw 'VirtualBox could not attach the Debian installer.' }

Write-Output 'Created junction-world and left it powered off. The disk is dynamically allocated, capped at 16 GiB, to reserve about 10 GB after a minimal Debian/runtime install.'
& $VBoxManage showvminfo 'junction-world' --details

param(
    [string] $OutputPath = (Join-Path $PSScriptRoot '..\..\artifacts\junction-world-provisioning.iso')
)

$ErrorActionPreference = 'Stop'
$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$GuestSource = Join-Path $RepositoryRoot 'scripts\junction-world'
$Output = [IO.Path]::GetFullPath($OutputPath)
$Stage = Join-Path ([IO.Path]::GetTempPath()) ('junction-world-iso-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $Stage -Force

try {
    foreach ($Name in @('expand-guest-root.sh', 'harden-guest.sh', 'update-guest-runtime.sh', 'open-viewer.sh', 'junction-cli.py', 'junction-world-viewer.desktop', 'junction-world-tmpfiles.conf', 'junction-world.nft', 'junction-world.service', 'junction-world-heartbeat.service', 'world-service.py', 'viewer_history.py', 'viewer_http.py', 'persistent_runtime.py', 'research-broker.py', 'agent.py')) {
        Copy-Item -LiteralPath (Join-Path $GuestSource $Name) -Destination (Join-Path $Stage $Name)
    }
    foreach ($Name in @('native-chat.py', 'open-native-chat.sh', 'junction-chat.desktop')) {
        Copy-Item -LiteralPath (Join-Path $GuestSource $Name) -Destination (Join-Path $Stage $Name)
    }
    Copy-Item -LiteralPath (Join-Path $GuestSource 'viewer') -Destination $Stage -Recurse
    $InstallText = @'
JUNCTION WORLD GUEST BOOTSTRAP

This read-only optical disc contains the reviewed guest runtime. It does not
contain credentials. The runtime installs paused and does not start autonomy.

1. Sign in to the Debian administrator account at the VirtualBox console.
2. Become root with: su -
3. Install only official Debian packages before applying the default-deny firewall:
     apt-get update
     apt-get install -y python3 nftables util-linux cloud-guest-utils
4. Mount this disc read-only and verify its manifest:
     mkdir -p /mnt/junction-world-iso
     mount -o ro /dev/sr0 /mnt/junction-world-iso
     cd /mnt/junction-world-iso
     sha256sum -c SHA256SUMS
5. Safely extend the Debian root filesystem if it is the final partition, then install the runtime:
     /bin/sh /mnt/junction-world-iso/expand-guest-root.sh
     /bin/sh /mnt/junction-world-iso/harden-guest.sh
6. Confirm the agent stays stopped/paused:
     systemctl is-active junction-world.service
     systemctl is-enabled junction-world.service
     systemctl is-active junction-world-heartbeat.service
     nft list ruleset

UPDATING AN ALREADY INSTALLED JUNCTION WORLD VM

Pause Junction World from Android Audit before updating the running VM. From
the Debian console, become root, mount this disc read-only, and verify the
manifest as shown above. Confirm a supported browser is already installed:
     command -v firefox-esr || command -v firefox || command -v chromium || command -v chromium-browser
Then run:
     /bin/sh /mnt/junction-world-iso/update-guest-runtime.sh
The updater verifies the complete manifest and restarts only the guest
Junction service. It does not change nftables, VM networking, USB, clipboard,
or the work disk. Open Junction World from the Applications menu or run
`junction chat` in a Debian terminal. Both connect to the same runtime. Use
`junction status` and `junction diary` to inspect it. Android Audit continues
to send messages and control pause/resume.

The heartbeat service must report inactive. The supervisor should be active,
but its host-owned control begins paused. Do not resume until all checklist
items in the companion SECURITY-AND-SETUP.md pass.

After setup, shut down or leave paused while Junction for Windows is running.
Only then add the single localhost-only VirtualBox NAT forward described in
SECURITY-AND-SETUP.md. Never use a shared folder or enable clipboard/drag-drop.
'@
    [IO.File]::WriteAllText((Join-Path $Stage 'INSTALL.txt'), $InstallText, [Text.UTF8Encoding]::new($false))
    $Manifest = Get-ChildItem -LiteralPath $Stage -File -Recurse | Sort-Object { $_.FullName.Substring($Stage.Length + 1).Replace('\', '/') } | ForEach-Object {
        $Hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        $RelativePath = $_.FullName.Substring($Stage.Length + 1).Replace('\', '/')
        "$Hash  $RelativePath"
    }
    [IO.File]::WriteAllLines((Join-Path $Stage 'SHA256SUMS'), $Manifest, [Text.UTF8Encoding]::new($false))

    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $Output) -Force
    if (-not ('JunctionIsoNative' -as [type])) { Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
[ComImport, Guid("0000000C-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface JunctionIStream {
  [PreserveSig] int Read(IntPtr buffer, int count, IntPtr read);
  [PreserveSig] int Write(IntPtr buffer, int count, IntPtr written);
  [PreserveSig] int Seek(long move, int origin, IntPtr position);
  [PreserveSig] int SetSize(long size);
  [PreserveSig] int CopyTo(JunctionIStream target, long count, out long read, out long written);
  [PreserveSig] int Commit(int flags);
  [PreserveSig] int Revert();
  [PreserveSig] int LockRegion(long offset, long count, int lockType);
  [PreserveSig] int UnlockRegion(long offset, long count, int lockType);
  [PreserveSig] int Stat(out System.Runtime.InteropServices.ComTypes.STATSTG stat, int flags);
  [PreserveSig] int Clone(out JunctionIStream stream);
}
public static class JunctionIsoNative {
  [DllImport("shlwapi.dll", CharSet=CharSet.Unicode, PreserveSig=true)]
  public static extern int SHCreateStreamOnFileEx(string file, uint mode, uint attributes, bool create, JunctionIStream template, out JunctionIStream stream);
  public static long CopyImage(object imageStream, string output) {
    IntPtr unknown = Marshal.GetIUnknownForObject(imageStream);
    JunctionIStream source;
    try { source = (JunctionIStream)Marshal.GetTypedObjectForIUnknown(unknown, typeof(JunctionIStream)); }
    finally { Marshal.Release(unknown); }
    JunctionIStream target;
    int hr = SHCreateStreamOnFileEx(output, 0x1001, 0, true, null, out target);
    if (hr < 0) Marshal.ThrowExceptionForHR(hr);
    try {
      System.Runtime.InteropServices.ComTypes.STATSTG stat;
      hr = source.Stat(out stat, 1);
      if (hr < 0) Marshal.ThrowExceptionForHR(hr);
      long read, written;
      hr = source.CopyTo(target, stat.cbSize, out read, out written);
      if (hr < 0) Marshal.ThrowExceptionForHR(hr);
      if (written != stat.cbSize) throw new InvalidOperationException("Incomplete provisioning ISO stream.");
      hr = target.Commit(0);
      if (hr < 0) Marshal.ThrowExceptionForHR(hr);
      return written;
    }
    finally { Marshal.ReleaseComObject(target); Marshal.ReleaseComObject(source); }
  }
}
'@
    }
    $ImageBuilder = New-Object -ComObject IMAPI2FS.MsftFileSystemImage
    $ImageBuilder.FileSystemsToCreate = 7
    $ImageBuilder.VolumeName = 'JUNCTION_WORLD'
    $null = $ImageBuilder.Root.AddTree($Stage, $false)
    $Image = $ImageBuilder.CreateResultImage()
    $Written = [JunctionIsoNative]::CopyImage($Image.ImageStream, $Output)
    if ($ImageBuilder) { [Runtime.InteropServices.Marshal]::ReleaseComObject($ImageBuilder) | Out-Null }
    Get-Item -LiteralPath $Output | Select-Object FullName, Length
}
finally {
    Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue
}

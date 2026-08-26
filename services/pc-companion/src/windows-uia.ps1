param([ValidateRange(1,100)][int]$MaxElements = 100)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class JunctionNativeWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@

function Limit-Text([string]$Value) {
  if ($null -eq $Value) { return '' }
  if ($Value.Length -le 500) { return $Value }
  return $Value.Substring(0, 500)
}

$handle = [JunctionNativeWindow]::GetForegroundWindow()
if ($handle -eq [IntPtr]::Zero) { throw 'No foreground window is available.' }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
if ($null -eq $root) { throw 'The foreground window does not expose UI Automation metadata.' }
$condition = [System.Windows.Automation.Condition]::TrueCondition
$nodes = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
$items = [System.Collections.Generic.List[object]]::new()
for ($i = 0; $i -lt $nodes.Count -and $items.Count -lt $MaxElements; $i++) {
  $node = $nodes.Item($i)
  try {
    $name = Limit-Text $node.Current.Name
    $automationId = Limit-Text $node.Current.AutomationId
    $className = Limit-Text $node.Current.ClassName
    if ([string]::IsNullOrWhiteSpace($name) -and [string]::IsNullOrWhiteSpace($automationId)) { continue }
    $rect = $node.Current.BoundingRectangle
    $items.Add([ordered]@{
      name = $name; automationId = $automationId; className = $className
      controlType = $node.Current.ControlType.ProgrammaticName
      enabled = $node.Current.IsEnabled; offscreen = $node.Current.IsOffscreen
      bounds = [ordered]@{ x = [int]$rect.X; y = [int]$rect.Y; width = [int]$rect.Width; height = [int]$rect.Height }
    })
  } catch { continue }
}
[ordered]@{
  schemaVersion = 1
  capturedAt = [DateTimeOffset]::UtcNow.ToString('o')
  provenance = 'UNTRUSTED'
  sourceRef = 'windows:uia:foreground'
  window = [ordered]@{ title = Limit-Text $root.Current.Name; processId = $root.Current.ProcessId; className = Limit-Text $root.Current.ClassName }
  elements = $items
  truncated = $nodes.Count -gt $items.Count
} | ConvertTo-Json -Depth 6 -Compress

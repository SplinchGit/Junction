param([Parameter(Mandatory=$true)][string]$Executable,[string]$HostArguments='--agent-host',[ValidateSet('true','false')][string]$Enabled='true')
$ErrorActionPreference='Stop'
$junctionUser=[Security.Principal.WindowsIdentity]::GetCurrent()
$junctionTaskName='Junction Nethra '+$junctionUser.User.Value
if($Enabled -eq 'false'){
  Unregister-ScheduledTask -TaskName $junctionTaskName -Confirm:$false -ErrorAction SilentlyContinue
  exit 0
}
if(-not(Test-Path -LiteralPath $Executable -PathType Leaf)){throw 'Junction executable was not found'}
$junctionAction=New-ScheduledTaskAction -Execute $Executable -Argument $HostArguments -WorkingDirectory (Split-Path -LiteralPath $Executable)
$junctionLogon=New-ScheduledTaskTrigger -AtLogOn -User $junctionUser.Name
$junctionRecovery=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$junctionSettings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$junctionPrincipal=New-ScheduledTaskPrincipal -UserId $junctionUser.Name -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $junctionTaskName -Action $junctionAction -Trigger @($junctionLogon,$junctionRecovery) -Settings $junctionSettings -Principal $junctionPrincipal -Description 'Runs your paired local Nethra host after Windows sign-in. No model inference occurs while objectives are waiting.' -Force | Out-Null

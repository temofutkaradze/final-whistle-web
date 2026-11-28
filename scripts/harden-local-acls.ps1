param([switch]$Apply, [string]$Restore)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
if ($root -ne 'C:\final-whistle-web') { throw 'Unexpected checkout; refusing ACL changes.' }
if ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Checkout root must not be a reparse point.' }
$owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
if ($Restore) {
  $record = Get-Content -LiteralPath $Restore -Raw | ConvertFrom-Json
  foreach ($entry in $record) {
    $target = [IO.Path]::GetFullPath($entry.path)
    if ($target -ne $root -and !$target.StartsWith($root + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Backup contains an unrelated path.' }
    if (Test-Path -LiteralPath $target) {
      if ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Recovery refuses reparse points.' }
      $isDir = (Get-Item -LiteralPath $target).PSIsContainer
      if ($isDir) { $acl = [IO.Directory]::GetAccessControl($target,[Security.AccessControl.AccessControlSections]::Access) }
      else { $acl = [IO.File]::GetAccessControl($target,[Security.AccessControl.AccessControlSections]::Access) }
      $acl.SetSecurityDescriptorSddlForm($entry.sddl,[Security.AccessControl.AccessControlSections]::Access)
      if ($isDir) { [IO.Directory]::SetAccessControl($target,$acl) } else { [IO.File]::SetAccessControl($target,$acl) }
    }
  }
  Write-Output 'Recorded application DACLs restored.'
  exit
}
# Do not follow junctions or change dependency/Git directories, accounts, or firewall rules.
$items = @((Get-Item -LiteralPath $root))
$items += Get-ChildItem -LiteralPath $root -Force | Where-Object { !$_.PSIsContainer -and !($_.Attributes -band [IO.FileAttributes]::ReparsePoint) }
foreach ($name in @('src','scripts','render','prisma','public','storage','.next')) {
  $dir = Join-Path $root $name
  if (!(Test-Path -LiteralPath $dir)) { continue }
  $queue = [Collections.Generic.Queue[string]]::new(); $queue.Enqueue($dir)
  while ($queue.Count) {
    $current = Get-Item -LiteralPath $queue.Dequeue() -Force
    if ($current.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
    $items += $current
    foreach ($child in Get-ChildItem -LiteralPath $current.FullName -Force) {
      if (($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $child.Name -eq 'node_modules' -or $child.Name -eq '.git') { continue }
      if ($child.PSIsContainer) { $queue.Enqueue($child.FullName) } else { $items += $child }
    }
  }
}
$records = @($items | ForEach-Object { @{path=$_.FullName;sddl=(Get-Acl -LiteralPath $_.FullName).GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)} })
$backup = Join-Path $root ('storage\security-backups\acl-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
if (!$Apply) { Write-Output ('Would protect ' + $records.Count + ' application paths. Use -Apply.'); exit }
[IO.Directory]::CreateDirectory((Split-Path $backup)) | Out-Null
[IO.File]::WriteAllText($backup,($records | ConvertTo-Json -Depth 4))
# First secure the recovery record. Keep only the current owner, SYSTEM and Administrators.
function Protect-Path([string]$target,[bool]$directory) {
  # Read/write DACL only: never request SACL privileges or alter owner/group metadata.
  if ($directory) { $acl = [IO.Directory]::GetAccessControl($target,[Security.AccessControl.AccessControlSections]::Access) }
  else { $acl = [IO.File]::GetAccessControl($target,[Security.AccessControl.AccessControlSections]::Access) }
  $acl.SetAccessRuleProtection($true,$false)
  foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
  $inherit = [Security.AccessControl.InheritanceFlags]::None
  if ($directory) { $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' }
  foreach ($sid in @($owner.Value,'S-1-5-18','S-1-5-32-544')) {
    $identity = [Security.Principal.SecurityIdentifier]::new($sid)
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($identity,'FullControl',$inherit,'None','Allow')
    $acl.AddAccessRule($rule)
  }
  if ($directory) { [IO.Directory]::SetAccessControl($target,$acl) } else { [IO.File]::SetAccessControl($target,$acl) }
}
Protect-Path (Split-Path $backup) $true
Protect-Path $backup $false
foreach ($item in $items) { Protect-Path $item.FullName $item.PSIsContainer }
# Protected directories propagate only these identities to future files.
Write-Output ('Protected ' + $records.Count + ' application paths. Recovery DACLs: ' + $backup)

param(
    [Parameter(Mandatory=$true)][string]$ArchivePath,
    [Parameter(Mandatory=$true)][string]$Destination,
    [string]$SevenZipPath = 'C:\Program Files\7-Zip\7z.exe',
    [switch]$VerifyEfsCertificate,
    [switch]$VerifyExtractedOnly
)
# Portable recovery: no original project, EFS profile or database connection required.
# Never pass passwords as parameters. Native 7-Zip prompts privately.
$ErrorActionPreference = 'Stop'
if (-not $VerifyExtractedOnly -and -not (Test-Path -LiteralPath $SevenZipPath -PathType Leaf)) { throw 'Install official verified 7-Zip first.' }
$archive = (Resolve-Path -LiteralPath $ArchivePath).Path
$target = [IO.Path]::GetFullPath($Destination)
if ($VerifyExtractedOnly) {
    if (-not (Test-Path -LiteralPath $target -PathType Container)) { throw 'Verification requires the existing extraction directory.' }
} elseif (Test-Path -LiteralPath $target) { throw 'Use a NEW recovery directory; existing data is never overwritten.' }
$parent = Split-Path -Parent $target
if (-not (Test-Path -LiteralPath $parent -PathType Container)) { throw 'Recovery parent must already exist.' }
for ($p = $(if ($VerifyExtractedOnly) { $target } else { $parent }); $p; $p = Split-Path -Parent $p) {
    $item = Get-Item -LiteralPath $p -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked recovery ancestor refused.' }
    if ($item.Attributes -band [IO.FileAttributes]::Encrypted) { throw 'Use a non-EFS recovery destination.' }
}
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
$owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
foreach ($sid in @($owner.Value,'S-1-5-18','S-1-5-32-544')) {
    $identity = New-Object Security.Principal.SecurityIdentifier($sid)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.AddAccessRule($rule)
}
if (-not $VerifyExtractedOnly) {
New-Item -ItemType Directory -Path $target | Out-Null
Set-Acl -LiteralPath $target -AclObject $acl
# Deliberately omit -p: for t/x a bare -p supplies an empty password, not a prompt.
Write-Host '7-Zip will ask for the existing archive password to test integrity.'
& $SevenZipPath t $archive
if ($LASTEXITCODE -ne 0) { throw 'Archive integrity/password check failed.' }
Write-Host '7-Zip will ask for the same archive password again to verify extraction.'
& $SevenZipPath x -y $archive ('-o' + $target)
if ($LASTEXITCODE -ne 0) { throw 'Extraction failed. Protected recovery files retained for inspection.' }
} else {
    Write-Host 'Reusing existing extracted files; archive testing and extraction are skipped.'
}
function Assert-NoLinks([string]$directory) {
    if ((Get-Item -LiteralPath $directory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked recovery directory refused.' }
    foreach ($entry in Get-ChildItem -LiteralPath $directory -Force) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked archive content refused.' }
        if ($entry.PSIsContainer) { Assert-NoLinks $entry.FullName }
    }
}
Assert-NoLinks $target
# Resume never weakens or silently replaces existing permissions. Check every file.
$allowed = @($owner.Value,'S-1-5-18','S-1-5-32-544')
$protectedItems = @((Get-Item -LiteralPath $target -Force)) + @(Get-ChildItem -LiteralPath $target -Recurse -Force)
foreach ($item in $protectedItems) {
    foreach ($rule in (Get-Acl -LiteralPath $item.FullName).Access) {
        if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $allowed) { throw 'Unexpected recovery ACL; verification stopped without changing files.' }
    }
}
$manifests = @(Get-ChildItem -LiteralPath (Join-Path $target 'storage/recovery-exports') -Filter manifest.json -Recurse -File)
if ($manifests.Count -ne 1) { throw 'Expected exactly one recovery checksum manifest.' }
# PS 5.1 emits a JSON array as ONE pipeline object. Assign first, then enumerate
# the resulting array, rather than wrapping the ConvertFrom-Json pipeline in @().
$decoded = ConvertFrom-Json -InputObject (Get-Content -LiteralPath $manifests[0].FullName -Raw)
$entries = @($decoded)
if (-not $entries.Count) { throw 'Empty recovery manifest.' }
foreach ($entry in $entries) {
    if ($entry -is [Array] -or $entry.Path -isnot [string] -or [string]::IsNullOrWhiteSpace($entry.Path) -or $entry.SHA256 -isnot [string] -or $entry.SHA256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid recovery manifest entry; expected a single path and SHA256 string.' }
    $restored = [IO.Path]::GetFullPath((Join-Path -Path $target -ChildPath $entry.Path))
    if (-not $restored.StartsWith($target + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Recovery manifest path escaped destination.' }
    if ((Get-FileHash -LiteralPath $restored -Algorithm SHA256).Hash -ne $entry.SHA256) { throw 'Recovered file checksum mismatch.' }
}
Write-Host ('Verified protected recovery files and ' + $entries.Count + ' file checksums. No originals or database records changed: ' + $target)
if ($VerifyEfsCertificate) {
    $pfxFiles = @(Get-ChildItem -LiteralPath (Join-Path $target 'storage/recovery-exports') -Filter efs-recovery.pfx -Recurse -File)
    if ($pfxFiles.Count -ne 1) { throw 'Expected exactly one exported EFS recovery certificate.' }
    if (-not [Enum]::IsDefined([Security.Cryptography.X509Certificates.X509KeyStorageFlags],'EphemeralKeySet')) { throw 'Ephemeral PFX verification requires a supported .NET Framework; no certificate will be installed.' }
    $pfxPassword = Read-Host 'Enter the separate PFX password to verify its private key (not installed)' -AsSecureString
    try {
        $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($pfxFiles[0].FullName,$pfxPassword,[Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet)
        try {
            if (-not $certificate.HasPrivateKey) { throw 'EFS recovery PFX does not contain its private key.' }
            Write-Host 'EFS recovery private key verified in memory; no certificate was installed.'
        } finally { if ($certificate) { $certificate.Dispose() } }
    } finally { $pfxPassword.Dispose() }
}
Write-Host 'Restore PostgreSQL only into an explicitly approved EMPTY recovery database. Keep passwords and PFX separately protected.'

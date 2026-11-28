param([string]$SevenZipPath = 'C:\Program Files\7-Zip\7z.exe', [switch]$ExportEfsCertificate)
# Run manually in a normal interactive PowerShell window. No password parameter:
# 7-Zip and cipher prompt securely; secrets never enter command arguments/history.
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if (-not (Test-Path -LiteralPath $SevenZipPath -PathType Leaf)) { throw '7-Zip is not installed at this path. Obtain approval before installing it, then rerun.' }
function Assert-NoLinks([string]$directory) {
    $item = Get-Item -LiteralPath $directory -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked backup path refused.' }
    foreach ($entry in Get-ChildItem -LiteralPath $directory -Force) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked backup entry refused.' }
        if ($entry.PSIsContainer) { Assert-NoLinks $entry.FullName }
    }
}
$private = Join-Path $root 'storage/private-backups'
$security = Join-Path $root 'storage/security-backups'
foreach ($ancestor in @($root,(Join-Path $root 'storage'))) {
    if ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked storage ancestor refused.' }
}
foreach ($p in @($private,$security)) { Assert-NoLinks $p }
$acl = Get-Acl -LiteralPath $private
$allowed = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544')
foreach ($rule in $acl.Access) {
    if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $allowed) { throw 'Private backup ACL requires review.' }
}
$exports = Join-Path $root 'storage/recovery-exports'
if (Test-Path -LiteralPath $exports) { Assert-NoLinks $exports }
else { New-Item -ItemType Directory -Path $exports | Out-Null; Set-Acl -LiteralPath $exports -AclObject $acl }
$destination = Join-Path $exports ([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $destination | Out-Null
Set-Acl -LiteralPath $destination -AclObject $acl
if ((Get-Item -LiteralPath $destination).Attributes -band [IO.FileAttributes]::Encrypted) { throw 'The recovery destination inherits EFS. Use an ACL-protected non-EFS destination before independent recovery.' }
$files = @(Get-ChildItem -LiteralPath $private,$security -File -Recurse -Force)
if ($ExportEfsCertificate) {
    $efs = Join-Path $private 'match-delivery-migration-2026-11-28/database-before.dump'
    if (-not (Test-Path -LiteralPath $efs)) { throw 'Expected EFS backup is missing; choose the correct certificate source before exporting.' }
    $pfxBase = Join-Path $destination 'efs-recovery'
    Write-Host 'Windows will prompt for a separate PFX recovery password. Store it outside this laptop.'
    & cipher.exe ("/x:" + $efs) $pfxBase
    if ($LASTEXITCODE -ne 0) { throw 'EFS recovery certificate export failed; originals preserved.' }
    $files += Get-Item -LiteralPath ($pfxBase + '.pfx')
}
if (-not $files.Count) { throw 'No backups found.' }
$manifest = @($files | ForEach-Object {
    $relative = $_.FullName.Substring($root.Length + 1)
    if ($relative -match '[\r\n]') { throw 'Unsupported backup filename.' }
    [pscustomobject]@{ Path=$relative; SHA256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
})
$list = Join-Path $destination 'archive-inputs.txt'
$manifestFile = Join-Path $destination 'manifest.json'
$manifest | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $manifestFile -Encoding UTF8
@($manifest.Path) + @($manifestFile.Substring($root.Length + 1)) | Set-Content -LiteralPath $list -Encoding UTF8
$archive = Join-Path $destination 'backups.7z'
$extract = Join-Path $destination 'verification-only'
Push-Location $root
try {
    Write-Host 'Enter a strong archive passphrase only in the 7-Zip prompts. No password is stored by this script.'
    & $SevenZipPath a -t7z -mhe=on -mx=1 -mmt=1 -md=16m -spd -scsUTF-8 -p $archive ("@" + $list)
    if ($LASTEXITCODE -ne 0) { throw 'Archive creation failed; originals preserved.' }
    if ((Get-Item -LiteralPath $archive).Attributes -band [IO.FileAttributes]::Encrypted) { throw 'Archive is EFS-bound; independent recovery is not verified.' }
    # For t/x, bare -p means an explicitly EMPTY password, suppressing the prompt.
    # Omit it so 7-Zip requests the password from the interactive console.
    Write-Host '7-Zip will now ask for the archive password again to test integrity.'
    & $SevenZipPath t $archive
    if ($LASTEXITCODE -ne 0) { throw 'Archive integrity test failed; originals preserved.' }
    New-Item -ItemType Directory -Path $extract | Out-Null
    Set-Acl -LiteralPath $extract -AclObject $acl
    Write-Host '7-Zip will ask for the same archive password again to verify extraction.'
    & $SevenZipPath x -y $archive ("-o" + $extract)
    if ($LASTEXITCODE -ne 0) { throw 'Recovery extraction failed; originals and protected extraction preserved.' }
    Assert-NoLinks $extract
    foreach ($entry in $manifest) {
        $restored = [IO.Path]::GetFullPath((Join-Path $extract $entry.Path))
        if (-not $restored.StartsWith($extract + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Recovery containment check failed.' }
        if ((Get-FileHash -LiteralPath $restored -Algorithm SHA256).Hash -ne $entry.SHA256) { throw 'Recovery checksum mismatch; originals preserved.' }
    }
    # Only this invocation's newly created and verified extraction is removed.
    if ([IO.Path]::GetFullPath($extract) -ne (Join-Path $destination 'verification-only')) { throw 'Cleanup containment check failed.' }
    Remove-Item -LiteralPath $extract -Recurse -Force
    Write-Host ("Verified independent archive and " + $manifest.Count + " recovered file checksums: " + $archive)
    Write-Host 'Keep a copy of the archive off-device and its passphrase separately. Existing backups were not modified or removed.'
} finally { Pop-Location }

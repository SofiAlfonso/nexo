[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $CliArguments = @()
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Push-Location $repoRoot
try {
    node (Join-Path $PSScriptRoot 'reset.mjs') @CliArguments
    if ($LASTEXITCODE -ne 0) { throw "deploy/scripts/reset failed (exit code $LASTEXITCODE)." }
} finally {
    Pop-Location
}

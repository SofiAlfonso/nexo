[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $CliArguments = @()
)

$ErrorActionPreference = 'Stop'

function Get-Setting([string] $Name, [string] $Default = $null) {
    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value)) {
        $value = $Default
    }
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Required environment variable $Name is not set."
    }
    return $value
}

Get-Setting 'SEED_OPERATOR_PASSWORD' | Out-Null
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    throw 'Node.js 24 or newer is required.'
}
$version = & $node.Source --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v?(\d+)\.' -or [int]$Matches[1] -lt 24) {
    throw "Node.js 24 or newer is required; found $version."
}

$factoryVariables = @(
    'LOCAL_POSTGRES_HOST', 'LOCAL_POSTGRES_PORT', 'LOCAL_POSTGRES_DB',
    'LOCAL_POSTGRES_USER', 'LOCAL_POSTGRES_PASSWORD',
    'CENTRAL_POSTGRES_HOST', 'CENTRAL_POSTGRES_PORT', 'CENTRAL_POSTGRES_DB',
    'CENTRAL_POSTGRES_USER', 'CENTRAL_POSTGRES_PASSWORD'
)
$previousFactoryValues = @{}
foreach ($name in $factoryVariables) {
    $previousFactoryValues[$name] = [Environment]::GetEnvironmentVariable($name)
}

try {
    if ([string]::IsNullOrWhiteSpace($env:D1_DATABASE_URL)) {
        $env:LOCAL_POSTGRES_HOST = Get-Setting 'LOCAL_POSTGRES_HOST' (Get-Setting 'D1_HOST' 'localhost')
        $env:LOCAL_POSTGRES_PORT = Get-Setting 'LOCAL_POSTGRES_PORT' (Get-Setting 'D1_PORT' '5433')
        $env:LOCAL_POSTGRES_DB = Get-Setting 'LOCAL_POSTGRES_DB' (Get-Setting 'D1_POSTGRES_DB' 'nexo_venue')
        $env:LOCAL_POSTGRES_USER = Get-Setting 'LOCAL_POSTGRES_USER' (Get-Setting 'D1_POSTGRES_USER' 'nexo_venue')
        $localPassword = [Environment]::GetEnvironmentVariable('LOCAL_POSTGRES_PASSWORD')
        if ([string]::IsNullOrWhiteSpace($localPassword)) {
            $localPassword = Get-Setting 'D1_POSTGRES_PASSWORD'
        }
        $env:LOCAL_POSTGRES_PASSWORD = $localPassword
    }
    if ([string]::IsNullOrWhiteSpace($env:D2_DATABASE_URL)) {
        $env:CENTRAL_POSTGRES_HOST = Get-Setting 'CENTRAL_POSTGRES_HOST' (Get-Setting 'D2_HOST' 'localhost')
        $env:CENTRAL_POSTGRES_PORT = Get-Setting 'CENTRAL_POSTGRES_PORT' (Get-Setting 'D2_PORT' '5434')
        $env:CENTRAL_POSTGRES_DB = Get-Setting 'CENTRAL_POSTGRES_DB' (Get-Setting 'D2_POSTGRES_DB' 'nexo_central')
        $env:CENTRAL_POSTGRES_USER = Get-Setting 'CENTRAL_POSTGRES_USER' (Get-Setting 'D2_POSTGRES_USER' 'nexo_central')
        $centralPassword = [Environment]::GetEnvironmentVariable('CENTRAL_POSTGRES_PASSWORD')
        if ([string]::IsNullOrWhiteSpace($centralPassword)) {
            $centralPassword = Get-Setting 'D2_POSTGRES_PASSWORD'
        }
        $env:CENTRAL_POSTGRES_PASSWORD = $centralPassword
    }

    $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    Push-Location $repoRoot
    try {
        & $node.Source --import tsx (Join-Path $PSScriptRoot 'seed.ts') @CliArguments
        if ($LASTEXITCODE -ne 0) {
            throw "Seed failed (exit code $LASTEXITCODE)."
        }
    } finally {
        Pop-Location
    }
} finally {
    foreach ($name in $factoryVariables) {
        [Environment]::SetEnvironmentVariable($name, $previousFactoryValues[$name])
    }
}

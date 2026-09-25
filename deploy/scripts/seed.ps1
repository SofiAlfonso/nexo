[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Get-RequiredEnvironmentVariable([string] $Name, [string] $Default = $null) {
    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value)) {
        $value = $Default
    }
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Required environment variable $Name is not set."
    }
    return $value
}

function ConvertTo-PostgresUrl([hashtable] $Connection) {
    $username = [Uri]::EscapeDataString($Connection.User)
    $password = [Uri]::EscapeDataString($Connection.Password)
    $database = [Uri]::EscapeDataString($Connection.Database)
    $hostName = $Connection.Host
    if ($hostName.Contains(':') -and -not $hostName.StartsWith('[')) {
        $hostName = "[$hostName]"
    }
    return "postgresql://${username}:${password}@$($hostName):$($Connection.Port)/${database}"
}

function Invoke-Migrations([string] $NodePath, [string] $RepoRoot) {
    $previousD1Url = $env:D1_DATABASE_URL
    $previousD2Url = $env:D2_DATABASE_URL
    $env:D1_DATABASE_URL = ConvertTo-PostgresUrl $connections[0]
    $env:D2_DATABASE_URL = ConvertTo-PostgresUrl $connections[1]
    Push-Location $RepoRoot
    try {
        Write-Host 'Applying D1 and D2 migrations...'
        & $NodePath --import tsx --input-type=module -e "import { Pool } from 'pg'; import { migrate as migrateD1 } from './src/local-coordinator/infrastructure/db/migrate.ts'; import { migrate as migrateD2 } from './src/central-core/infrastructure/db/migrate.ts'; const d1 = new Pool({ connectionString: process.env.D1_DATABASE_URL }); const d2 = new Pool({ connectionString: process.env.D2_DATABASE_URL }); try { await Promise.all([migrateD1(d1), migrateD2(d2)]); } finally { await Promise.all([d1.end(), d2.end()]); }"
        if ($LASTEXITCODE -ne 0) {
            throw "Database migration failed (exit code $LASTEXITCODE)."
        }
    } finally {
        Pop-Location
        $env:D1_DATABASE_URL = $previousD1Url
        $env:D2_DATABASE_URL = $previousD2Url
    }
}

function Invoke-Seed(
    [string] $Name,
    [string] $SeedFile,
    [hashtable] $Connection,
    [string] $PasswordHash
) {
    Write-Host "Seeding $Name..."
    $previousPassword = $env:PGPASSWORD
    try {
        $env:PGPASSWORD = $Connection.Password
        & psql `
            --no-psqlrc `
            --single-transaction `
            --set=ON_ERROR_STOP=1 `
            "--set=operator_password_hash=$PasswordHash" `
            --host $Connection.Host `
            --port $Connection.Port `
            --username $Connection.User `
            --dbname $Connection.Database `
            --file $SeedFile
        if ($LASTEXITCODE -ne 0) {
            throw "psql failed while seeding $Name (exit code $LASTEXITCODE)."
        }
    } finally {
        $env:PGPASSWORD = $previousPassword
    }
}

Get-RequiredEnvironmentVariable 'SEED_OPERATOR_PASSWORD' | Out-Null
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$d1Seed = Join-Path $repoRoot 'src\local-coordinator\infrastructure\db\seed\seed.sql'
$d2Seed = Join-Path $repoRoot 'src\central-core\infrastructure\db\seed\seed.sql'

$connections = @(
    @{
        Name = 'D1'
        Host = Get-RequiredEnvironmentVariable 'D1_HOST' 'localhost'
        Port = Get-RequiredEnvironmentVariable 'D1_PORT' '5433'
        Database = Get-RequiredEnvironmentVariable 'D1_POSTGRES_DB' 'nexo_venue'
        User = Get-RequiredEnvironmentVariable 'D1_POSTGRES_USER' 'nexo_venue'
        Password = Get-RequiredEnvironmentVariable 'D1_POSTGRES_PASSWORD'
    },
    @{
        Name = 'D2'
        Host = Get-RequiredEnvironmentVariable 'D2_HOST' 'localhost'
        Port = Get-RequiredEnvironmentVariable 'D2_PORT' '5434'
        Database = Get-RequiredEnvironmentVariable 'D2_POSTGRES_DB' 'nexo_central'
        User = Get-RequiredEnvironmentVariable 'D2_POSTGRES_USER' 'nexo_central'
        Password = Get-RequiredEnvironmentVariable 'D2_POSTGRES_PASSWORD'
    }
)

foreach ($seedFile in @($d1Seed, $d2Seed)) {
    if (-not (Test-Path -LiteralPath $seedFile -PathType Leaf)) {
        throw "Expected seed SQL file is missing: $seedFile"
    }
}

$psqlCommand = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psqlCommand) {
    throw 'PostgreSQL client psql is required on PATH.'
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    throw 'Node.js 24 or newer is required on PATH.'
}

$nodeVersion = & $node.Source --version
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v?(\d+)\.' -or [int]$Matches[1] -lt 24) {
    throw "Node.js 24 or newer is required; found $nodeVersion."
}

Invoke-Migrations $node.Source $repoRoot

$centralCore = Join-Path $repoRoot 'src\central-core'
Push-Location $centralCore
try {
    $passwordHash = & $node.Source --input-type=module -e "import argon2 from 'argon2'; process.stdout.write(await argon2.hash(process.env.SEED_OPERATOR_PASSWORD));"
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($passwordHash)) {
        throw 'Could not generate the argon2 operator password hash.'
    }
} finally {
    Pop-Location
}

Invoke-Seed 'D1' $d1Seed $connections[0] $passwordHash
Invoke-Seed 'D2' $d2Seed $connections[1] $passwordHash
Write-Host 'D1 and D2 seed data applied successfully.'

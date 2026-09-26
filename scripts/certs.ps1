$ErrorActionPreference = 'Stop'

$node = (Get-Command node -ErrorAction Stop).Source
& $node (Join-Path $PSScriptRoot 'certs.mjs') @args
exit $LASTEXITCODE

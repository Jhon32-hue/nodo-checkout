param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('migrate', 'seed')]
    [string]$Operation
)

# Explicit future operation against this demo only; never invoked by Terraform.
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    $settingsJson = terraform output -json maintenance_task
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read deployment outputs.' }
    $settings = $settingsJson | ConvertFrom-Json
    $network = @{ awsvpcConfiguration = @{
        subnets = @($settings.subnets)
        securityGroups = @($settings.security_group)
        assignPublicIp = 'ENABLED'
    } } | ConvertTo-Json -Depth 5 -Compress
    $command = if ($Operation -eq 'migrate') {
        @('node', 'node_modules/typeorm/cli.js', 'migration:run', '-d', 'dist/infrastructure/database/data-source.js')
    } else {
        @('node', 'dist/infrastructure/database/seed.js')
    }
    $overrides = @{ containerOverrides = @(@{ name = 'api'; command = $command }) } |
        ConvertTo-Json -Depth 5 -Compress
    # File arguments contain only commands and network IDs, never secret values.
    $localDirectory = Join-Path $PSScriptRoot '.local'
    New-Item -ItemType Directory -Force -Path $localDirectory | Out-Null
    $networkPath = Join-Path $localDirectory 'maintenance-network.json'
    $overridesPath = Join-Path $localDirectory 'maintenance-overrides.json'
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [IO.File]::WriteAllText($networkPath, $network, $utf8)
    [IO.File]::WriteAllText($overridesPath, $overrides, $utf8)
    $resultJson = aws ecs run-task --region us-east-2 --cluster $settings.cluster `
        --task-definition $settings.task_definition --launch-type FARGATE --platform-version 1.4.0 `
        --count 1 --network-configuration "file://$networkPath" `
        --overrides "file://$overridesPath" --output json --no-cli-pager
    if ($LASTEXITCODE -ne 0) { throw 'Cannot start maintenance task.' }
    $result = $resultJson | ConvertFrom-Json
    if (@($result.failures).Count -gt 0 -or @($result.tasks).Count -ne 1) {
        throw 'AWS did not start exactly one maintenance task.'
    }
    $taskArn = $result.tasks[0].taskArn
    aws ecs wait tasks-stopped --region us-east-2 --cluster $settings.cluster --tasks $taskArn
    if ($LASTEXITCODE -ne 0) { throw 'Maintenance wait failed; inspect task status before continuing.' }
    $statusJson = aws ecs describe-tasks --region us-east-2 --cluster $settings.cluster `
        --tasks $taskArn --output json --no-cli-pager
    if ($LASTEXITCODE -ne 0) { throw 'Cannot read maintenance result.' }
    $status = $statusJson | ConvertFrom-Json
    $container = $status.tasks[0].containers | Where-Object name -EQ 'api'
    if ($null -eq $container -or $container.exitCode -ne 0) {
        throw 'Maintenance failed; inspect sanitized CloudWatch logs. Do not start the service.'
    }
    Write-Output "Completed $Operation successfully. No service task was started."
} finally {
    Pop-Location
}

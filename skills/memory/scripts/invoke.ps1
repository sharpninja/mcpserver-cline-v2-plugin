#Requires -Version 7.0
<#
.SYNOPSIS
    Dispatches memory_* aliases to the plugin's workflow.memory.* REPL methods.
.DESCRIPTION
    Resolves names from memory-descriptor.json workflowMethods and invokes
    lib/repl-invoke.ps1 (or the MCP_PLUGIN_REPL_LOG test seam). Host-registered
    memory_* MCP tools are aliases for the same workflow.memory.* methods.
#>
[CmdletBinding()]
param(
    [string]$Name,
    [string]$Method,
    [string]$ParamsYaml = '',
    [string]$PluginRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$resolvedPluginRoot = if ($PluginRoot) {
    $PluginRoot
} elseif ($env:MCP_PLUGIN_ROOT) {
    $env:MCP_PLUGIN_ROOT
} else {
    (Resolve-Path -LiteralPath (Join-Path $scriptDir '../../..')).ProviderPath
}

$descriptorPath = if ($env:MCP_MEMORY_DESCRIPTOR_PATH) {
    $env:MCP_MEMORY_DESCRIPTOR_PATH
} else {
    Join-Path $resolvedPluginRoot 'memory-descriptor.json'
}

$requested = if ($Method) { $Method } elseif ($Name) { $Name } else {
    throw 'Specify -Name memory_* or -Method workflow.memory.*'
}

function Resolve-McpMemoryWorkflowMethod {
    param(
        [Parameter(Mandatory)][string]$Requested,
        [string]$DescriptorPath
    )

    if ($Requested -match '^workflow\.memory\.[A-Za-z][A-Za-z0-9]*$') {
        return $Requested
    }

    if (Test-Path -LiteralPath $DescriptorPath -PathType Leaf) {
        $descriptor = Get-Content -LiteralPath $DescriptorPath -Raw | ConvertFrom-Json
        $mapped = $descriptor.workflowMethods.$Requested
        if ($mapped) { return [string]$mapped }
    }

    if ($Requested -match '^memory_(.+)$') {
        return "workflow.memory.$($Matches[1])"
    }

    throw "Unsupported memory tool alias: $Requested"
}

$resolvedMethod = Resolve-McpMemoryWorkflowMethod -Requested $requested -DescriptorPath $descriptorPath

if ($env:MCP_PLUGIN_REPL_LOG) {
    $normalizedParams = if ($ParamsYaml) {
        ($ParamsYaml -replace "`r`n", "`n" -replace "`r", "`n") -split "`n" | ForEach-Object { "  $_" }
    } else {
        @()
    }
    $entry = @(
        "method: $resolvedMethod"
        'params: |'
        $normalizedParams
        '---'
    ) -join "`n"
    Add-Content -LiteralPath $env:MCP_PLUGIN_REPL_LOG -Value $entry
    if ($env:MCP_MEMORY_REPL_RESPONSE) { return $env:MCP_MEMORY_REPL_RESPONSE }
    if ($env:MCP_PLUGIN_REPL_RESPONSE) { return $env:MCP_PLUGIN_REPL_RESPONSE }
    return
}

$replInvoke = Join-Path $resolvedPluginRoot 'lib/repl-invoke.ps1'
if (-not (Test-Path -LiteralPath $replInvoke -PathType Leaf)) {
    throw "lib/repl-invoke.ps1 was not found at $replInvoke"
}
& $replInvoke -Method $resolvedMethod -ParamsYaml $ParamsYaml

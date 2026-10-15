#Requires -Version 7.0
# SPDX-License-Identifier: Apache-2.0

# TR-MCP-PLUGININT-001 AC-001 (PLAN-SESSIONTRIAGEFIX-001 E3, triage-report-78b6efa1): this TypeScript plugin's package entry exports the
# plugin factory under createQBrainAiPlugin, the name the integration harness loads, and keeps createMcpServerPlugin for existing callers.
# Mock gate: the export assertion is proven against pinned entry texts and rejects an entry without createQBrainAiPlugin, one where it is only
# in a comment, one that dropped createMcpServerPlugin, and a built entry that predates the source change. Binding: this repository's
# src/index.ts, src/plugin.ts and the dist/index.js its npm build writes (the file the harness imports). Static text checks, no Node run.

BeforeAll {
    $script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).ProviderPath

    # The names an entry text exports: export lists (export { a, b } from ...), and exported functions and constants.
    function Get-ExportedName {
        param([Parameter(Mandatory)][AllowEmptyString()][string]$Text)
        $code = [regex]::Replace($Text, '(?m)^\s*//.*$', '')
        $code = [regex]::Replace($code, '/\*[\s\S]*?\*/', '')
        $names = [System.Collections.Generic.List[string]]::new()
        foreach ($list in [regex]::Matches($code, 'export\s*\{([^}]*)\}')) {
            foreach ($part in ($list.Groups[1].Value -split ',')) {
                $name = ($part.Trim() -split '\s+as\s+')[-1].Trim()
                if ($name) { $names.Add($name) }
            }
        }
        foreach ($declared in [regex]::Matches($code, 'export\s+(?:async\s+)?(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)')) { $names.Add($declared.Groups[1].Value) }
        return $names.ToArray()
    }

    # TR-MCP-PLUGININT-001 AC-001: the entry exports both factory names and the plugin module defines createQBrainAiPlugin; the built entry
    # exports both too.
    function Assert-FactoryExport {
        param([Parameter(Mandatory)][AllowEmptyString()][string]$IndexText, [Parameter(Mandatory)][AllowEmptyString()][string]$PluginText, [Parameter(Mandatory)][AllowEmptyString()][string]$DistText)
        $index = @(Get-ExportedName -Text $IndexText)
        $index | Should -Contain 'createQBrainAiPlugin' -Because 'the package entry exports the name the harness loads'
        $index | Should -Contain 'createMcpServerPlugin' -Because 'existing callers keep the earlier name'
        @(Get-ExportedName -Text $PluginText) | Should -Contain 'createQBrainAiPlugin' -Because 'the plugin module defines the factory under the new name'
        $dist = @(Get-ExportedName -Text $DistText)
        $dist | Should -Contain 'createQBrainAiPlugin' -Because 'the built entry the harness imports carries the export'
        $dist | Should -Contain 'createMcpServerPlugin'
    }
}

Describe 'TR-MCP-PLUGININT-001 AC-001 Node plugin factory export (mock gate)' {
    It 'FactoryExportAssertion_AcceptsBothNamesAndRejectsMissingCommentedDroppedOrStaleBuild' {
        $index = "export { allToolDescriptors, createMcpServerPlugin, createQBrainAiPlugin } from './plugin.js';"
        $plugin = "export function createMcpServerPlugin(config = {}) { return {}; }`nexport const createQBrainAiPlugin = createMcpServerPlugin;"
        $dist = "export { allToolDescriptors, createMcpServerPlugin, createQBrainAiPlugin } from './plugin.js';"
        Assert-FactoryExport -IndexText $index -PluginText $plugin -DistText $dist

        # Negative controls: today's entry, an export only in a comment, the earlier name dropped, the module without the new name, and a stale build.
        $today = "export { allToolDescriptors, createMcpServerPlugin } from './plugin.js';"
        { Assert-FactoryExport -IndexText $today -PluginText $plugin -DistText $dist } | Should -Throw
        { Assert-FactoryExport -IndexText ($today + "`n// export { createQBrainAiPlugin } from './plugin.js';") -PluginText $plugin -DistText $dist } | Should -Throw
        { Assert-FactoryExport -IndexText "export { allToolDescriptors, createQBrainAiPlugin } from './plugin.js';" -PluginText $plugin -DistText $dist } | Should -Throw
        { Assert-FactoryExport -IndexText $index -PluginText 'export function createMcpServerPlugin(config = {}) { return {}; }' -DistText $dist } | Should -Throw
        { Assert-FactoryExport -IndexText $index -PluginText $plugin -DistText $today } | Should -Throw
    }
}

Describe 'TR-MCP-PLUGININT-001 AC-001 Node plugin factory export (binding)' {
    It 'NodePlugin_ThisRepository_ExportsCreateQBrainAiPlugin' {
        $distPath = Join-Path $script:RepoRoot 'dist/index.js'
        Test-Path -LiteralPath $distPath -PathType Leaf | Should -BeTrue -Because 'npm run build writes dist/index.js, the file the harness imports'
        Assert-FactoryExport `
            -IndexText ([System.IO.File]::ReadAllText((Join-Path $script:RepoRoot 'src/index.ts'))) `
            -PluginText ([System.IO.File]::ReadAllText((Join-Path $script:RepoRoot 'src/plugin.ts'))) `
            -DistText ([System.IO.File]::ReadAllText($distPath))
    }
}

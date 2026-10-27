# SPDX-License-Identifier: Apache-2.0
#Requires -Version 7.0
<#
FR-QB-001/TR-QB-PLUGIN-001, TEST-QB-003/006/070: static artifact inventory subset.
FR-QB-001, TEST-QB-071: task-owned fixture/canary subset only.
This test does not synchronize or consume an S candidate. It copies only synthetic
text fixtures and never executes their contents. Runtime paths below are TEST-ONLY
role placeholders, not a proposed production layout/API or accepted runtime pin.
Real compiled offline startup, signatures, architecture and runtime compatibility
remain explicit gates. The same observer/assertion seam accepts an accepted artifact.
#>
[CmdletBinding(SupportsShouldProcess)]
param([Parameter(Mandatory)][string]$ReceiptPath,[scriptblock]$ObservationProvider)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Import-Module powershell-yaml -ErrorAction Stop
. (Join-Path $PSScriptRoot 'QbP1.ArtifactTree.Provider.ps1')

function Test-QbArtifactTree {
    param($Expected,$Observation)
    if($Observation.parseError -or $null -eq $Observation.manifest){throw 'Missing or malformed manifest'}
    if($Observation.manifestDigest -cne $Expected.manifestDigest){throw 'Manifest differs from pinned source bytes'}
    if($Observation.manifest.coreVersion -cne $Expected.version){throw 'Core version mismatch'}
    if($Observation.files.Count -ne $Expected.files.Count){throw 'Artifact inventory differs'}
    if($Observation.manifest.files.Count -ne $Expected.files.Count){throw 'Manifest inventory differs'}
    foreach($path in $Expected.files.Keys) {
        if(-not $Observation.files.Contains($path)){throw "Missing required asset: $path"}
        if(-not $Observation.manifest.files.Contains($path)){throw "Unmanifested required asset: $path"}
        if($Observation.files[$path] -cne $Expected.files[$path]){throw "Changed artifact bytes: $path"}
        if($Observation.manifest.files[$path] -cne $Expected.files[$path]){throw "Wrong manifest digest: $path"}
    }
}

# Independent operation inputs, with the exact existing supported-sync path inventory.
$paths=@(
 'lib/agent-runtime-header.ps1','lib/cache-manager.ps1','lib/classified-error.ps1',
 'lib/ensure-repl.ps1','lib/final-response.ps1','lib/Invoke-McpPlugin.ps1',
 'lib/marker-resolver.ps1','lib/mcp-status.ps1','lib/McpPluginShim.psm1',
 'lib/plan-todo-map.ps1','lib/plugin-env.ps1','lib/plugin-hook.ps1',
 'lib/repl-invoke.ps1','lib/repl-params-transfer.ps1','lib/resolve-cache-dir.ps1',
 'lib/yaml-object-mutation.ps1','skills/handoff/invoke.ps1','skills/handoff/SKILL.md',
 'dist/index.js','memory-descriptor.json','ENFORCEMENT.md','skills/startup/SKILL.md',
 'test-only-runtime/pwsh.fixture','test-only-runtime/PowerShell.MCP.fixture',
 'test-only-runtime/powershell-yaml.fixture'
)
$cases=[Collections.Generic.List[object]]::new()
$cases.Add(@{name='complete synthetic artifact tree';fault='none';path='';reject=$false})
foreach($path in $paths) {
 $cases.Add(@{name="omitted asset $path";fault='omit';path=$path;reject=$true})
 $cases.Add(@{name="changed asset $path";fault='change';path=$path;reject=$true})
}
$cases.Add(@{name='unmanifested extra asset';fault='extra';path='lib/unaccepted.ps1';reject=$true})
$cases.Add(@{name='missing manifest';fault='manifest-omit';path='';reject=$true})
$cases.Add(@{name='malformed manifest';fault='manifest-invalid';path='';reject=$true})
$fixtureRoot=$ReceiptPath+'.fixtures'
$privateRoot='F:/GitHub/cline/docs/receipts/execution/legion2-20261021T213045/attempt-02/P/'
$fullReceipt=[IO.Path]::GetFullPath($ReceiptPath).Replace('\','/')
if(-not $fullReceipt.StartsWith($privateRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Receipt/fixture tree must remain in private P directory'}
if((Test-Path -LiteralPath $ReceiptPath) -or (Test-Path -LiteralPath $fixtureRoot)){throw 'Retain existing receipts and trees: use a new path'}
# Source tree: 25 assets + manifest. Cases: 54 * 26 - 26 omissions + 1 extra.
$fileWrites=$paths.Count+1+($cases.Count*($paths.Count+1))-$paths.Count-1+1+2
if(-not $PSCmdlet.ShouldProcess($fixtureRoot,"Run $($cases.Count) lightweight tree cases; create exactly $fileWrites files including source, case trees, canary and receipt; delete 0; no product sync")){return}
$sourceRoot=Join-Path $fixtureRoot 'source'
New-Item -ItemType Directory -Path $sourceRoot | Out-Null
$sourceFiles=[ordered]@{}
foreach($path in $paths) {
 $target=Join-Path $sourceRoot $path
 New-Item -ItemType Directory -Force (Split-Path -Parent $target)|Out-Null
 $content=if($path -eq 'memory-descriptor.json'){@{scope='test-only';required=@('fixture-guidance')}|ConvertTo-Json}else{"Synthetic task-owned bytes for $path. Never execute."}
 Add-LinesToFile -LiteralPath $target -Content $content|Out-Null
 $sourceFiles[$path]=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
}
$manifest=[ordered]@{coreVersion='test-only-frozen-fixture';files=$sourceFiles}
$sourceManifest=Join-Path $sourceRoot 'CORE-MANIFEST.yaml'
Add-LinesToFile -LiteralPath $sourceManifest -Content ($manifest|ConvertTo-Yaml)|Out-Null
$expected=@{version='test-only-frozen-fixture';files=$sourceFiles;manifestDigest=(Get-FileHash -LiteralPath $sourceManifest -Algorithm SHA256).Hash.ToLowerInvariant()}
$canary=Join-Path $fixtureRoot 'outside-case-root.canary'
Add-LinesToFile -LiteralPath $canary -Content 'P-owned external canary. Must survive every assertion failure.'|Out-Null
$canaryHash=(Get-FileHash -LiteralPath $canary).Hash
$results=[Collections.Generic.List[object]]::new()
$index=0
foreach($case in $cases) {
 $root=Join-Path $fixtureRoot ('case-'+(++$index).ToString('D3'))
 New-Item -ItemType Directory -Path $root|Out-Null
 foreach($path in $paths) {
  if($case.fault -eq 'omit' -and $case.path -ceq $path){continue}
  $target=Join-Path $root $path
  New-Item -ItemType Directory -Force (Split-Path -Parent $target)|Out-Null
  Copy-Item -LiteralPath (Join-Path $sourceRoot $path) -Destination $target
  if($case.fault -eq 'change' -and $case.path -ceq $path){Add-LinesToFile -LiteralPath $target -Content 'incorrect dependency effect'|Out-Null}
 }
 if($case.fault -eq 'extra') {Add-LinesToFile -LiteralPath (Join-Path $root $case.path) -Content 'unaccepted asset'|Out-Null}
 if($case.fault -eq 'manifest-invalid') {Add-LinesToFile -LiteralPath (Join-Path $root 'CORE-MANIFEST.yaml') -Content 'files: [unterminated'|Out-Null}
 elseif($case.fault -ne 'manifest-omit') {Copy-Item -LiteralPath $sourceManifest -Destination (Join-Path $root 'CORE-MANIFEST.yaml')}
 $observation=if($ObservationProvider){& $ObservationProvider $root}else{Get-QbArtifactTreeObservation -Root $root}
 $rejected=$false;$reason=''
 try {Test-QbArtifactTree $expected $observation} catch {$rejected=$true;$reason=$_.Exception.Message}
 $canaryUnchanged=((Get-FileHash -LiteralPath $canary).Hash -ceq $canaryHash)
 $results.Add(@{name=$case.name;expectedRejection=$case.reject;rejected=$rejected;reason=$reason;passed=($rejected -eq $case.reject -and $canaryUnchanged);canaryUnchanged=$canaryUnchanged;root=$root;observation=$observation})
}
$failed=@($results|Where-Object {-not $_.passed}).Count
$actualFiles=@(Get-ChildItem -LiteralPath $fixtureRoot -Recurse -File).Count+1
$report=[ordered]@{
 timestamp=[DateTimeOffset]::Now.ToString('yyyy-MM-ddTHH:mm:sszzz');mode='SyntheticFilesystemArtifactObservation'
 total=$results.Count;passed=$results.Count-$failed;failed=$failed;skipped=0
 positiveCases=1;negativeControls=$cases.Count-1;negativeControlsRejected=@($results|Where-Object {$_.expectedRejection -and $_.rejected}).Count
 plannedFileWrites=$fileWrites;actualFilesIncludingReceipt=$actualFiles;fileWriteCountExact=($fileWrites -eq $actualFiles)
 sourceRoot=$sourceRoot;sourceFiles=$sourceFiles;sourceManifestDigest=$expected.manifestDigest
 canaryPath=$canary;canaryHash=$canaryHash;cases=@($results)
 tests=@('TEST-QB-003','TEST-QB-006','TEST-QB-070','TEST-QB-071');subsetOnly=$true
 productionVerified=$false;runtimeExecuted=$false;supportedSyncExecuted=$false;original49Modified=$false
 testSha256=(Get-FileHash -LiteralPath $PSCommandPath).Hash
 providerSha256=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'QbP1.ArtifactTree.Provider.ps1')).Hash
}
Add-LinesToFile -LiteralPath $ReceiptPath -Content ($report|ConvertTo-Json -Depth 40)|Out-Null
[pscustomobject]@{total=$report.total;passed=$report.passed;failed=$failed;negativeControlsRejected=$report.negativeControlsRejected;fileWriteCountExact=$report.fileWriteCountExact;receipt=$ReceiptPath}
if($failed -or -not $report.fileWriteCountExact){throw 'Artifact fixture suite failed; all trees and receipts retained'}

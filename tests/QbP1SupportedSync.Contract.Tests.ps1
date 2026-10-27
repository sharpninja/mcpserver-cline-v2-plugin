# SPDX-License-Identifier: Apache-2.0
#Requires -Version 7.0
<#
P1, PARENT-P1-SYNC-001. FR-QB-001/002; partial TEST-QB-003/006/070/071.
Same input-driven cases and assertions bind the independent fake and wrapper.
Synthetic bytes only. This is not runtime, release, lifecycle or phase acceptance.
#>
[CmdletBinding(SupportsShouldProcess)]
param([Parameter(Mandatory)][string]$ReceiptPath,[string]$ImplementationPath)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
Import-Module powershell-yaml
. (Join-Path $PSScriptRoot 'QbP1.Sync.Mock.ps1')
function Get-QbSyncTree {
 param([string]$Root)
 $map=[ordered]@{}
 if(Test-Path -LiteralPath $Root){foreach($file in Get-ChildItem -LiteralPath $Root -Recurse -File|Sort-Object FullName){$map[[IO.Path]::GetRelativePath($Root,$file.FullName).Replace('\','/')]=(Get-FileHash -LiteralPath $file.FullName).Hash.ToLowerInvariant()}}
 return ,$map
}
function Test-QbSyncOutcome {
 param($InputData,$BeforeSource,$BeforeTarget,$BeforeCanary,$OutputData)
 if(-not $OutputData.accepted){throw 'Synchronization did not accept'}
 $source=Get-QbSyncTree $InputData.SourceCoreRoot
 if(($source|ConvertTo-Json -Compress) -cne ($BeforeSource|ConvertTo-Json -Compress)){throw 'Source mutation'}
 if((Get-FileHash -LiteralPath $InputData.Canary).Hash -cne $BeforeCanary){throw 'External canary mutation'}
 $stage=Get-QbSyncTree $InputData.StagingRoot
 $target=Get-QbSyncTree $InputData.TargetRoot
 $retained=Get-QbSyncTree $InputData.RetentionRoot
 if($stage.Count -ne $InputData.Inventory.Count+1){throw 'Stage includes omitted/unexpected artifact'}
 $manifest=Get-Content (Join-Path $InputData.StagingRoot 'CORE-MANIFEST.yaml') -Raw|ConvertFrom-Yaml -Ordered
 if($manifest.coreVersion -cne $InputData.RequiredIdentity -or $manifest.files.Count -ne $InputData.Inventory.Count){throw 'Manifest identity/inventory invalid'}
 foreach($path in $InputData.Inventory.Keys) {
  if(-not $stage.Contains($path) -or -not $manifest.files.Contains($path)){throw 'Manifest path missing'}
  if($stage[$path] -cne $InputData.Inventory[$path] -or $manifest.files[$path] -cne $InputData.Inventory[$path]){throw 'Asset digest disagreement'}
 }
 foreach($path in $stage.Keys) {
  if(-not $target.Contains($path) -or $target[$path] -cne $stage[$path]){throw 'Partial promotion'}
  if($BeforeTarget.Contains($path) -and (-not $retained.Contains($path) -or $retained[$path] -cne $BeforeTarget[$path])){throw 'Original not retained byte-exactly'}
 }
 foreach($path in $BeforeTarget.Keys){if(-not $stage.Contains($path) -and $target[$path] -cne $BeforeTarget[$path]){throw 'Unrelated target mutation'}}
 if($InputData.TargetRoot -cne $InputData.IntendedTargetRoot){throw 'Wrong target'}
 if(-not $InputData.SyntheticRehearsal -or $InputData.ReleaseIdentity -cne $InputData.RequiredIdentity){throw 'Unaccepted release'}
}
$files=[ordered]@{'lib/alpha.ps1'='synthetic alpha';'lib/runtime/asset.fixture'='synthetic runtime bytes, never execute';'skills/handoff/SKILL.md'='synthetic guidance';'skills/handoff/invoke.ps1'='synthetic skill bytes, never execute'}
$cases=[Collections.Generic.List[object]]::new()
$cases.Add(@{name='complete nested source and skills';fault='none';path='';reject=$false})
foreach($path in $files.Keys){foreach($fault in @('omit','change')){$cases.Add(@{name="$fault $path";fault=$fault;path=$path;reject=$true})}}
foreach($fault in @('extra','manifest-omit','manifest-invalid','manifest-extra','manifest-digest','manifest-identity','nonempty-stage','outbound-stage','wrong-target','unaccepted-release','wrong-release','wrong-pin','partial-copy','partial-promotion','source-mutation','canary-mutation','source-junction','stage-junction','target-junction','retention-junction')){$cases.Add(@{name=$fault;fault=$fault;path='';reject=$true})}
$root=$ReceiptPath+'.fixtures'
$private='F:/GitHub/cline/docs/receipts/execution/legion2-20261021T213045/attempt-02/P/'
if(-not [IO.Path]::GetFullPath($root).Replace('\','/').StartsWith($private,[StringComparison]::OrdinalIgnoreCase)){throw 'Only private P fixtures allowed'}
if((Test-Path $root) -or (Test-Path $ReceiptPath)){throw 'Preserve prior fixtures/receipts'}
$copier='F:/GitHub/McpServer/plugins/core/sync/sync-plugin-core.ps1'
$copierHash='26F879BF38A1BEBF04853312CBAACD650A0D3C7BE226B8B535F0FBDB9EF59C6A'
if((Get-FileHash $copier).Hash -cne $copierHash){throw 'Pinned copier changed: coordinator disposition requires reconciliation'}
if(-not $PSCmdlet.ShouldProcess($root,"Run $($cases.Count) cases: 1 positive, $($cases.Count-1) rejecting controls; create at most $($cases.Count*23+1) fixture/receipt files, delete at most 11 newly staged fault-fixture files; retain all original source/target bytes")){return}
$results=[Collections.Generic.List[object]]::new()
$oldCeiling=$env:GIT_CEILING_DIRECTORIES
$env:GIT_CEILING_DIRECTORIES=[IO.Path]::GetFullPath((Split-Path $root -Parent))
try {
 $index=0
 foreach($case in $cases) {
  $caseRoot=Join-Path $root ('case-'+(++$index).ToString('D3'))
  $source=Join-Path $caseRoot 'core'
  $target=Join-Path $caseRoot 'target'
  $inventory=[ordered]@{}
  foreach($path in $files.Keys) {
   $relative=if($path.StartsWith('lib/')){'lib-ps/'+$path.Substring(4)}else{$path}
   $destination=Join-Path $source $relative
   New-Item -ItemType Directory -Force (Split-Path $destination -Parent)|Out-Null
   Add-LinesToFile -LiteralPath $destination -Content $files[$path]|Out-Null
   $inventory[$path]=(Get-FileHash $destination).Hash.ToLowerInvariant()
  }
  New-Item -ItemType Directory -Force (Join-Path $source 'sync')|Out-Null
  Copy-Item -LiteralPath $copier -Destination (Join-Path $source 'sync/sync-plugin-core.ps1')
  foreach($path in @('lib/alpha.ps1','skills/handoff/SKILL.md','dist/asset.fixture')) {
   $destination=Join-Path $target $path
   New-Item -ItemType Directory -Force (Split-Path $destination -Parent)|Out-Null
   Add-LinesToFile -LiteralPath $destination -Content "retained original $path"|Out-Null
  }
  $canary=Join-Path $caseRoot 'outside-target.canary'
  Add-LinesToFile -LiteralPath $canary -Content 'owned external canary'|Out-Null
  $inputData=@{BoundaryRoot=$caseRoot;SourceCoreRoot=$source;StagingRoot=(Join-Path $caseRoot 'stage');TargetRoot=$target;IntendedTargetRoot=$target;RetentionRoot=(Join-Path $caseRoot 'retained');Inventory=$inventory;ReleaseIdentity='unknown';RequiredIdentity='unknown';SyntheticRehearsal=$true;CopierSha256=$copierHash;Canary=$canary}
  switch($case.fault) {
   'nonempty-stage' {New-Item -ItemType Directory $inputData.StagingRoot|Out-Null;Add-LinesToFile -LiteralPath (Join-Path $inputData.StagingRoot 'preexisting') -Content 'retain'|Out-Null}
   'outbound-stage' {$inputData.StagingRoot=Join-Path $root 'outside-owned-case'}
   'wrong-target' {$inputData.TargetRoot=Join-Path $caseRoot 'wrong-target'}
   'unaccepted-release' {$inputData.SyntheticRehearsal=$false}
   'wrong-release' {$inputData.ReleaseIdentity='unaccepted'}
   'wrong-pin' {$inputData.Inventory['lib/alpha.ps1']='0'*64}
  }
  if($case.fault.EndsWith('-junction')) {
   $external=Join-Path $caseRoot 'outside-target-tree'
   New-Item -ItemType Directory $external|Out-Null
   $canary=Join-Path $external 'asset.fixture'
   Add-LinesToFile -LiteralPath $canary -Content 'owned junction destination canary'|Out-Null
   $inputData.Canary=$canary
   $junction=switch($case.fault){'source-junction'{Join-Path $source 'lib-ps/escape'};'target-junction'{Join-Path $target 'lib/runtime'};'retention-junction'{Join-Path $inputData.RetentionRoot 'escape'}}
   if($junction){New-Item -ItemType Directory -Force (Split-Path $junction -Parent)|Out-Null;New-Item -ItemType Junction -Path $junction -Target $external|Out-Null}
  }
  $beforeSource=Get-QbSyncTree $source
  $beforeTarget=Get-QbSyncTree $target
  $beforeCanary=(Get-FileHash $canary).Hash
  $effects=[Collections.Generic.List[string]]::new()
  $copyOperation={
   param($data)
   $effects.Add('copy:start')
   New-Item -ItemType Directory -Force $data.StagingRoot|Out-Null
   if($ImplementationPath) {
    & (Join-Path $data.SourceCoreRoot 'sync/sync-plugin-core.ps1') -PluginRoot $data.StagingRoot|Out-Null
   } else {
    $manifestFiles=[ordered]@{}
    foreach($file in Get-ChildItem -LiteralPath (Join-Path $data.SourceCoreRoot 'lib-ps') -Recurse -File) {
     $relative='lib/'+[IO.Path]::GetRelativePath((Join-Path $data.SourceCoreRoot 'lib-ps'),$file.FullName).Replace('\','/')
     $destination=Join-Path $data.StagingRoot $relative
     New-Item -ItemType Directory -Force (Split-Path $destination -Parent)|Out-Null
     Copy-Item -LiteralPath $file.FullName -Destination $destination
     $manifestFiles[$relative]=(Get-FileHash $destination).Hash.ToLowerInvariant()
    }
    foreach($file in Get-ChildItem -LiteralPath (Join-Path $data.SourceCoreRoot 'skills/handoff') -File) {
     $relative='skills/handoff/'+$file.Name
     $destination=Join-Path $data.StagingRoot $relative
     New-Item -ItemType Directory -Force (Split-Path $destination -Parent)|Out-Null
     Copy-Item -LiteralPath $file.FullName -Destination $destination
     $manifestFiles[$relative]=(Get-FileHash $destination).Hash.ToLowerInvariant()
    }
    $manifest=[ordered]@{coreVersion='unknown';files=$manifestFiles}
    Add-LinesToFile -LiteralPath (Join-Path $data.StagingRoot 'CORE-MANIFEST.yaml') -Content ($manifest|ConvertTo-Yaml)|Out-Null
   }
   if($case.fault -eq 'stage-junction'){New-Item -ItemType Junction -Path (Join-Path $data.StagingRoot 'escape') -Target $external|Out-Null}
   $effects.Add('copy:complete')
   $manifestPath=Join-Path $data.StagingRoot 'CORE-MANIFEST.yaml'
   switch($case.fault) {
    'omit' {Remove-Item -LiteralPath (Join-Path $data.StagingRoot $case.path)}
    'change' {Add-LinesToFile -LiteralPath (Join-Path $data.StagingRoot $case.path) -Content 'wrong bytes'|Out-Null}
    'extra' {Add-LinesToFile -LiteralPath (Join-Path $data.StagingRoot 'unexpected.asset') -Content 'extra'|Out-Null}
    'manifest-omit' {Remove-Item -LiteralPath $manifestPath}
    'manifest-invalid' {Remove-Item -LiteralPath $manifestPath;Add-LinesToFile -LiteralPath $manifestPath -Content 'invalid'|Out-Null}
    'partial-copy' {$partialPath=[IO.Path]::GetFullPath((Join-Path $data.StagingRoot 'skills'));if(-not $partialPath.StartsWith([IO.Path]::GetFullPath($caseRoot)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Fault path escapes own fixture'};Remove-Item -LiteralPath $partialPath -Recurse}
    'source-mutation' {Add-LinesToFile -LiteralPath (Join-Path $data.SourceCoreRoot 'lib-ps/alpha.ps1') -Content 'source corruption'|Out-Null}
    'canary-mutation' {Add-LinesToFile -LiteralPath $data.Canary -Content 'canary corruption'|Out-Null}
   }
   if($case.fault -in @('manifest-extra','manifest-digest','manifest-identity')) {
    $manifest=Get-Content $manifestPath -Raw|ConvertFrom-Yaml -Ordered
    switch($case.fault){'manifest-extra'{$manifest.files['extra']='0'*64};'manifest-digest'{$manifest.files['lib/alpha.ps1']='0'*64};'manifest-identity'{$manifest.coreVersion='wrong'}}
    Remove-Item -LiteralPath $manifestPath
    Add-LinesToFile -LiteralPath $manifestPath -Content ($manifest|ConvertTo-Yaml)|Out-Null
   }
  }
  $promoteOperation={
   param($data,$stage)
   $effects.Add('promote:start')
   $number=0
   foreach($path in $stage.Keys) {
    if($case.fault -eq 'partial-promotion' -and (++$number) -gt 1){continue}
    $destination=Join-Path $data.TargetRoot $path
    New-Item -ItemType Directory -Force (Split-Path $destination -Parent)|Out-Null
    Copy-Item -LiteralPath (Join-Path $data.StagingRoot $path) -Destination $destination -Force
    $effects.Add('promote:'+ $path)
   }
  }
  $boundaryRejected=$false;$rejected=$false;$reason='';$outputData=$null
  try {
   try {
   if($ImplementationPath) {
    $invokeArguments=@{InputData=$inputData}
    if($case.fault -ne 'none'){$invokeArguments.CopyOperation=$copyOperation}
    if($case.fault -eq 'partial-promotion'){$invokeArguments.PromoteOperation=$promoteOperation}
    $outputData=& $ImplementationPath @invokeArguments
   } else {$outputData=Invoke-QbSyncMock -InputData $inputData -CopyOperation $copyOperation -PromoteOperation $promoteOperation}
   } catch {$boundaryRejected=$true;throw}
   Test-QbSyncOutcome $inputData $beforeSource $beforeTarget $beforeCanary $outputData
  } catch {$rejected=$true;$reason=$_.Exception.Message}
  $expectedCause=switch($case.fault) {
   'none' {''}
   'omit' {'^Complete (staged )?inventory mismatch$'}
   'change' {'^Invalid staged artifact$|^Staged/manifest digest mismatch:'}
   'extra' {'^Complete (staged )?inventory mismatch$'}
   'manifest-omit' {'^Missing (staged )?manifest$'}
   'manifest-invalid' {'^Invalid staged manifest$'}
   'manifest-extra' {'^Complete (staged )?inventory mismatch$'}
   'manifest-digest' {'^Invalid staged artifact$|^Staged/manifest digest mismatch:'}
   'manifest-identity' {'^Manifest identity mismatch$'}
   'nonempty-stage' {'^Staging must be empty$'}
   'outbound-stage' {'^Path outside owned boundary$'}
   'wrong-target' {'^Wrong target root$'}
   'unaccepted-release' {'^Accepted merged S release absent$|^Production held:'}
   'wrong-release' {'^Release identity mismatch$'}
   'wrong-pin' {'^Invalid staged artifact$|^Staged/manifest digest mismatch:'}
   'partial-copy' {'^Complete (staged )?inventory mismatch$'}
   'partial-promotion' {'^Partial promotion'}
   'source-mutation' {'^Original source changed'}
   'canary-mutation' {'^External canary mutation$'}
   'retention-junction' {'^Retention must be new$|^Nested reparse point'}
   default {if($case.fault.EndsWith('-junction')){'^Nested reparse point'}else{throw 'Unmapped negative cause'}}
  }
  $causeVerified=(-not $case.reject) -or ($boundaryRejected -and $reason -match $expectedCause)
  $postconditions=$true
  try {
   $targetAfter=Get-QbSyncTree $target
   if($case.fault -ne 'source-mutation' -and (($beforeSource|ConvertTo-Json -Compress) -cne ((Get-QbSyncTree $source)|ConvertTo-Json -Compress))){throw 'Unexpected original source mutation'}
   if($case.fault -ne 'canary-mutation' -and (Get-FileHash $canary).Hash -cne $beforeCanary){throw 'Unexpected canary mutation'}
   if($case.fault -notin @('none','partial-promotion') -and (($beforeTarget|ConvertTo-Json -Compress) -cne ($targetAfter|ConvertTo-Json -Compress))){throw 'Rejected input changed original target'}
   if($case.fault -in @('nonempty-stage','outbound-stage','wrong-target','unaccepted-release','wrong-release') -and $effects.Count){throw 'Preflight rejection invoked copy/promotion'}
   if($case.fault -eq 'partial-promotion') {
    $retained=Get-QbSyncTree $inputData.RetentionRoot
    foreach($path in $beforeTarget.Keys){if($targetAfter.Contains($path) -and $targetAfter[$path] -cne $beforeTarget[$path] -and $retained[$path] -cne $beforeTarget[$path]){throw 'Partial promotion lost original bytes'}}
   }
  } catch {$postconditions=$false;$reason+='; postcondition: '+$_.Exception.Message}
  $results.Add([ordered]@{causeVerified=$causeVerified;expectedCause=$expectedCause;boundaryRejected=$boundaryRejected;postconditions=$postconditions;name=$case.name;expectedRejection=$case.reject;rejected=$rejected;passed=($case.reject -eq $rejected -and $postconditions -and $causeVerified);reason=$reason;effects=@($effects);sourceBefore=$beforeSource;sourceAfter=(Get-QbSyncTree $source);targetBefore=$beforeTarget;targetAfter=(Get-QbSyncTree $target);retained=(Get-QbSyncTree $inputData.RetentionRoot);stage=(Get-QbSyncTree $inputData.StagingRoot);root=$caseRoot})
 }
} finally {$env:GIT_CEILING_DIRECTORIES=$oldCeiling}
$failed=@($results|Where-Object {-not $_.passed}).Count
$report=[ordered]@{timestamp=[DateTimeOffset]::Now.ToString('o');mode=$(if($ImplementationPath){'WrapperWithUnchangedCopierSyntheticOnly'}else{'IndependentInputDrivenMock'});total=$results.Count;passed=$results.Count-$failed;failed=$failed;skipped=0;negativeControls=$cases.Count-1;negativeControlsRejected=@($results|Where-Object {$_.expectedRejection -and $_.rejected}).Count;retainedFiles=@(Get-ChildItem $root -Recurse -File).Count;cases=@($results);testSha256=(Get-FileHash $PSCommandPath).Hash;mockSha256=(Get-FileHash (Join-Path $PSScriptRoot 'QbP1.Sync.Mock.ps1')).Hash;copierSha256=$copierHash;implementationSha256=$(if($ImplementationPath){(Get-FileHash $ImplementationPath).Hash}else{$null});tests=@('TEST-QB-003','TEST-QB-006','TEST-QB-070','TEST-QB-071');productAccepted=$false;runtimeAccepted=$false}
Add-LinesToFile -LiteralPath $ReceiptPath -Content ($report|ConvertTo-Json -Depth 50)|Out-Null
[pscustomobject]@{total=$report.total;failed=$failed;rejected=$report.negativeControlsRejected;receipt=$ReceiptPath}
if($failed){throw 'Supported sync contract subset failed; preserve receipt and all fixtures'}

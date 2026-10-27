# SPDX-License-Identifier: Apache-2.0
#Requires -Version 7.0
<#
.SYNOPSIS
PARENT-P1-SYNC-001 bounded wrapper around the unchanged canonical copier.
.DESCRIPTION
Stages and verifies complete synthetic trees before narrow byte promotion.
P1 partial TEST-QB-003/006/070/071 only. Does not establish runtime readiness.
Production consumption is held pending O's exact merged accepted S release.
InputData is a local rehearsal argument object, not a shared-core/wire API.
CopyOperation/PromoteOperation are fault-injection seams, restricted to private
synthetic rehearsals. No application data, installed plugin or generated checkout
can be a rehearsal target. Original source and overwritten target bytes survive.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
 [Parameter(Mandatory)][System.Collections.IDictionary]$InputData,
 [scriptblock]$CopyOperation,
 [scriptblock]$PromoteOperation
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
function Get-QbSyncInventory {
 param([string]$Root)
 $map=[ordered]@{}
 if(Test-Path -LiteralPath $Root) {
  foreach($entry in Get-ChildItem -LiteralPath $Root -Recurse -Force){if($entry.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Nested reparse point rejected'}}
  foreach($file in Get-ChildItem -LiteralPath $Root -Recurse -File|Sort-Object FullName) {
   if($file.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse artifact is not a bounded byte source'}
   $map[[IO.Path]::GetRelativePath($Root,$file.FullName).Replace('\','/')]=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  }
 }
 return ,$map
}
function Assert-QbSyncInventory {
 param($Before,$After,[string]$Message)
 if(($Before|ConvertTo-Json -Compress) -cne ($After|ConvertTo-Json -Compress)){throw $Message}
}
if(-not $InputData.SyntheticRehearsal){throw 'Production held: exact accepted merged S release and artifact contract have not been supplied by O'}
$private='F:/GitHub/cline/docs/receipts/execution/legion2-20261021T213045/attempt-02/P/'
$boundary=[IO.Path]::GetFullPath($InputData.BoundaryRoot).Replace('\','/').TrimEnd('/')+'/'
if(-not $boundary.StartsWith($private,[StringComparison]::OrdinalIgnoreCase)){throw 'Rehearsal boundary must be private P fixtures'}
$roots=@($InputData.SourceCoreRoot,$InputData.StagingRoot,$InputData.TargetRoot,$InputData.RetentionRoot)
$resolved=@($roots|ForEach-Object {[IO.Path]::GetFullPath($_).Replace('\','/').TrimEnd('/')})
foreach($root in $resolved) {
 if(-not $root.StartsWith($boundary,[StringComparison]::OrdinalIgnoreCase)){throw 'Path outside owned boundary'}
 $cursor=$root
 while($cursor -and $cursor.Length -ge $boundary.TrimEnd('/').Length) {
  if((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Reparse directory escapes lexical boundary'}
  $cursor=Split-Path $cursor -Parent
 }
}
foreach($left in $resolved){foreach($right in $resolved){if($left -ne $right -and $left.StartsWith($right+'/',[StringComparison]::OrdinalIgnoreCase)){throw 'Source/stage/target/retention roots must be disjoint'}}}
if(@($resolved|Select-Object -Unique).Count -ne 4){throw 'Source/stage/target/retention roots must be distinct'}
if([IO.Path]::GetFullPath($InputData.TargetRoot) -cne [IO.Path]::GetFullPath($InputData.IntendedTargetRoot)){throw 'Wrong target root'}
if(-not (Test-Path -LiteralPath $InputData.SourceCoreRoot -PathType Container) -or -not (Test-Path -LiteralPath $InputData.TargetRoot -PathType Container)){throw 'Source and intended target must exist'}
if($InputData.ReleaseIdentity -cne $InputData.RequiredIdentity){throw 'Release identity mismatch'}
if((Test-Path -LiteralPath $InputData.StagingRoot) -and @(Get-ChildItem -LiteralPath $InputData.StagingRoot -Force).Count){throw 'Staging must be empty'}
if(Test-Path -LiteralPath $InputData.RetentionRoot){throw 'Retention must be new'}
$copier=Join-Path $InputData.SourceCoreRoot 'sync/sync-plugin-core.ps1'
if((Get-FileHash -LiteralPath $copier).Hash -cne $InputData.CopierSha256){throw 'Canonical copier hash mismatch'}
foreach($path in $InputData.Inventory.Keys) {
 if($path -notmatch '^(lib/|skills/handoff/)' -or $path.Contains('\') -or $path.Split('/') -contains '..' -or $path.Split('/') -contains '.' -or $path.EndsWith('/')){throw 'Invalid supported inventory path'}
 if($InputData.Inventory[$path] -notmatch '^[0-9a-f]{64}$'){throw 'Invalid inventory digest'}
}
$canaryPath=[IO.Path]::GetFullPath($InputData.Canary).Replace('\','/')
if(-not $canaryPath.StartsWith($boundary,[StringComparison]::OrdinalIgnoreCase)){throw 'Canary outside owned boundary'}
foreach($root in $resolved){if($canaryPath.StartsWith($root+'/',[StringComparison]::OrdinalIgnoreCase)){throw 'External canary must be outside mutable trees'}}
$cursor=$canaryPath
while($cursor -and $cursor.Length -ge $boundary.TrimEnd('/').Length){if((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Nested reparse point in canary path'};$cursor=Split-Path $cursor -Parent}
$canaryBefore=(Get-FileHash -LiteralPath $canaryPath).Hash
$sourceBefore=Get-QbSyncInventory $InputData.SourceCoreRoot
$targetBefore=Get-QbSyncInventory $InputData.TargetRoot
$stageCount=$InputData.Inventory.Count+1
$retainCount=@($targetBefore.Keys|Where-Object {$_ -eq 'CORE-MANIFEST.yaml' -or $InputData.Inventory.Contains($_)}).Count
if(-not $PSCmdlet.ShouldProcess($InputData.TargetRoot,"Canonical copy into empty stage: $stageCount files; retain $retainCount original files; promote $stageCount verified byte copies; delete 0 originals")){return}
New-Item -ItemType Directory -Force $InputData.StagingRoot|Out-Null
if($CopyOperation){& $CopyOperation $InputData}else{& $copier -PluginRoot $InputData.StagingRoot|Out-Null}
if((Get-FileHash -LiteralPath $canaryPath).Hash -cne $canaryBefore){throw 'External canary mutation'}
if(Test-Path -LiteralPath $InputData.RetentionRoot){throw 'Retention must be new'}
$stage=Get-QbSyncInventory $InputData.StagingRoot
$manifestPath=Join-Path $InputData.StagingRoot 'CORE-MANIFEST.yaml'
if(-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)){throw 'Missing staged manifest'}
Import-Module powershell-yaml -ErrorAction Stop
$manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Yaml -Ordered
if($manifest -isnot [Collections.IDictionary] -or $manifest.files -isnot [Collections.IDictionary]){throw 'Invalid staged manifest'}
if($manifest.coreVersion -cne $InputData.RequiredIdentity){throw 'Manifest identity mismatch'}
if($manifest.files.Count -ne $InputData.Inventory.Count -or $stage.Count -ne $stageCount){throw 'Complete staged inventory mismatch'}
foreach($path in $InputData.Inventory.Keys) {
 if(-not $stage.Contains($path) -or -not $manifest.files.Contains($path)){throw "Missing staged/manifest asset: $path"}
 if($stage[$path] -cne $InputData.Inventory[$path] -or $manifest.files[$path] -cne $InputData.Inventory[$path]){throw "Staged/manifest digest mismatch: $path"}
}
Assert-QbSyncInventory $sourceBefore (Get-QbSyncInventory $InputData.SourceCoreRoot) 'Original source changed during staging'
Assert-QbSyncInventory $targetBefore (Get-QbSyncInventory $InputData.TargetRoot) 'Original target changed before retention'
New-Item -ItemType Directory $InputData.RetentionRoot|Out-Null
foreach($path in $stage.Keys) {
 if($targetBefore.Contains($path)) {
  $destination=Join-Path $InputData.RetentionRoot $path
  New-Item -ItemType Directory -Force (Split-Path $destination -Parent)|Out-Null
  Copy-Item -LiteralPath (Join-Path $InputData.TargetRoot $path) -Destination $destination
  if((Get-FileHash -LiteralPath $destination).Hash.ToLowerInvariant() -cne $targetBefore[$path]){throw 'Original retention digest mismatch'}
 }
}
if($PromoteOperation){& $PromoteOperation $InputData $stage}else{
 foreach($path in $stage.Keys) {
  $destination=Join-Path $InputData.TargetRoot $path
  New-Item -ItemType Directory -Force (Split-Path $destination -Parent)|Out-Null
  Copy-Item -LiteralPath (Join-Path $InputData.StagingRoot $path) -Destination $destination -Force
 }
}
$targetAfter=Get-QbSyncInventory $InputData.TargetRoot
foreach($path in $stage.Keys){if(-not $targetAfter.Contains($path) -or $targetAfter[$path] -cne $stage[$path]){throw "Partial promotion: $path"}}
foreach($path in $targetBefore.Keys){if(-not $stage.Contains($path) -and $targetAfter[$path] -cne $targetBefore[$path]){throw "Unrelated target changed: $path"}}
Assert-QbSyncInventory $sourceBefore (Get-QbSyncInventory $InputData.SourceCoreRoot) 'Original source changed during promotion'
if((Get-FileHash -LiteralPath $canaryPath).Hash -cne $canaryBefore){throw 'External canary mutation'}
[pscustomobject]@{accepted=$true;files=$stage.Count;retainedOriginals=$retainCount;syntheticOnly=$true;productionAccepted=$false;runtimeAccepted=$false}

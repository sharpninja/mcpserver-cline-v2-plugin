# SPDX-License-Identifier: Apache-2.0
# Independent input-driven filesystem fake for PARENT-P1-SYNC-001.
function Invoke-QbSyncMock {
 [CmdletBinding()]
 param([System.Collections.IDictionary]$InputData,[scriptblock]$CopyOperation,[scriptblock]$PromoteOperation)
 $ErrorActionPreference='Stop'
 $boundary=[IO.Path]::GetFullPath($InputData.BoundaryRoot).TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar
 foreach($root in @($InputData.SourceCoreRoot,$InputData.StagingRoot,$InputData.TargetRoot,$InputData.RetentionRoot)) {
  if(-not [IO.Path]::GetFullPath($root).StartsWith($boundary,[StringComparison]::OrdinalIgnoreCase)){throw 'Path outside owned boundary'}
 }
 if($InputData.TargetRoot -cne $InputData.IntendedTargetRoot){throw 'Wrong target root'}
 if(-not $InputData.SyntheticRehearsal){throw 'Accepted merged S release absent'}
 if($InputData.ReleaseIdentity -cne $InputData.RequiredIdentity){throw 'Release identity mismatch'}
 if((Test-Path $InputData.StagingRoot) -and @(Get-ChildItem $InputData.StagingRoot -Force).Count){throw 'Staging must be empty'}
 if(Test-Path $InputData.RetentionRoot){throw 'Retention must be new'}
 foreach($root in @($InputData.SourceCoreRoot,$InputData.StagingRoot,$InputData.TargetRoot,$InputData.RetentionRoot)) {
  if(Test-Path -LiteralPath $root){foreach($entry in Get-ChildItem -LiteralPath $root -Recurse -Force){if($entry.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Nested reparse point rejected'}}}
 }
 $canaryBefore=(Get-FileHash -LiteralPath $InputData.Canary).Hash
 $sourceBefore=Get-QbSyncTree $InputData.SourceCoreRoot
 $targetBefore=Get-QbSyncTree $InputData.TargetRoot
 & $CopyOperation $InputData
 foreach($root in @($InputData.SourceCoreRoot,$InputData.StagingRoot,$InputData.TargetRoot,$InputData.RetentionRoot)) {
  if(Test-Path -LiteralPath $root){foreach($entry in Get-ChildItem -LiteralPath $root -Recurse -Force){if($entry.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Nested reparse point rejected'}}}
 }
 if((Get-FileHash -LiteralPath $InputData.Canary).Hash -cne $canaryBefore){throw 'External canary mutation'}
 $stage=Get-QbSyncTree $InputData.StagingRoot
 $manifestPath=Join-Path $InputData.StagingRoot 'CORE-MANIFEST.yaml'
 if(-not (Test-Path $manifestPath)){throw 'Missing manifest'}
 $manifest=Get-Content $manifestPath -Raw|ConvertFrom-Yaml -Ordered
 if($manifest -isnot [Collections.IDictionary] -or $manifest.files -isnot [Collections.IDictionary]){throw 'Invalid staged manifest'}
 if($manifest.coreVersion -cne $InputData.ReleaseIdentity){throw 'Manifest identity mismatch'}
 if($manifest.files.Count -ne $InputData.Inventory.Count -or $stage.Count -ne $InputData.Inventory.Count+1){throw 'Complete inventory mismatch'}
 foreach($path in $InputData.Inventory.Keys) {
  if(-not $stage.Contains($path) -or $stage[$path] -cne $InputData.Inventory[$path] -or $manifest.files[$path] -cne $InputData.Inventory[$path]){throw 'Invalid staged artifact'}
 }
 if(($sourceBefore|ConvertTo-Json -Compress) -cne ((Get-QbSyncTree $InputData.SourceCoreRoot)|ConvertTo-Json -Compress)){throw 'Original source changed'}
 New-Item -ItemType Directory $InputData.RetentionRoot|Out-Null
 foreach($path in $stage.Keys) {
  if($targetBefore.Contains($path)) {
   $retain=Join-Path $InputData.RetentionRoot $path
   New-Item -ItemType Directory -Force (Split-Path $retain -Parent)|Out-Null
   Copy-Item -LiteralPath (Join-Path $InputData.TargetRoot $path) -Destination $retain
   if((Get-FileHash $retain).Hash.ToLowerInvariant() -cne $targetBefore[$path]){throw 'Original retention mismatch'}
  }
 }
 & $PromoteOperation $InputData $stage
 $targetAfter=Get-QbSyncTree $InputData.TargetRoot
 foreach($path in $stage.Keys){if($targetAfter[$path] -cne $stage[$path]){throw 'Partial promotion'}}
 foreach($path in $targetBefore.Keys){if(-not $stage.Contains($path) -and $targetAfter[$path] -cne $targetBefore[$path]){throw 'Unrelated target changed'}}
 if(($sourceBefore|ConvertTo-Json -Compress) -cne ((Get-QbSyncTree $InputData.SourceCoreRoot)|ConvertTo-Json -Compress)){throw 'Original source changed during promotion'}
 [pscustomobject]@{accepted=$true;files=$stage.Count}
}

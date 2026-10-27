# SPDX-License-Identifier: Apache-2.0
# Test dependency: observes actual task-owned artifact files. No expected values enter here.
function Get-QbArtifactTreeObservation {
    param([Parameter(Mandatory)][string]$Root)
    $manifestPath=Join-Path $Root 'CORE-MANIFEST.yaml'
    $manifest=$null;$parseError='';$manifestDigest=''
    if(Test-Path -LiteralPath $manifestPath -PathType Leaf) {
        $manifestDigest=(Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
        try {$manifest=ConvertFrom-Yaml -Yaml ([IO.File]::ReadAllText($manifestPath)) -Ordered -ErrorAction Stop}
        catch {$parseError=$_.Exception.Message}
    }
    $files=[ordered]@{}
    foreach($file in Get-ChildItem -LiteralPath $Root -Recurse -File | Sort-Object FullName) {
        $relative=[IO.Path]::GetRelativePath($Root,$file.FullName).Replace('\','/')
        if($relative -cne 'CORE-MANIFEST.yaml') {
            $files[$relative]=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    return @{manifest=$manifest;manifestDigest=$manifestDigest;parseError=$parseError;files=$files;root=$Root}
}

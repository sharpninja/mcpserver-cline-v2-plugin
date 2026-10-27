# SPDX-License-Identifier: Apache-2.0
#Requires -Version 7.0
<#
Test-only interaction scenarios for the frozen QB P1 observable contract. These are not a
transport, lifecycle implementation, wire protocol or accepted host API.
FR-QB-003/TR-QB-AUDIT-001: AC/TEST-QB-008,009,069.
FR-QB-001/TR-QB-PLUGIN-001: AC/TEST-QB-003,070 (integrity subset only).
A later real adapter substitutes the provider in the SAME runner with the SAME
assertions. Mock results cannot certify production, complete an AC, or release
an accepted dependency pin. Runtime availability/launch is outside this suite.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)][string]$ReceiptPath,
    [scriptblock]$ProviderFactory
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-TextDigest {
    param([string]$Text)
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Text))).ToLowerInvariant()
}

function Test-OrdinalValue {
    param($Expected, $Actual, [string]$Field)
    if ($Expected -is [string]) {
        if ($Actual -isnot [string] -or -not [string]::Equals($Expected, $Actual, [StringComparison]::Ordinal)) {
            throw "Mismatch: $Field"
        }
    } elseif ($Expected -cne $Actual) { throw "Mismatch: $Field" }
}

function Test-AuditObservation {
    param([System.Collections.IDictionary]$Expected, [System.Collections.IDictionary]$Actual)
    foreach ($field in @('workspaceId','agentIdentity','mcpSessionId','requestId','eventId','order','method','payloadHash')) {
        if (-not $Actual.receipt.Contains($field)) { throw "Missing receipt: $field" }
        Test-OrdinalValue $Expected.receipt[$field] $Actual.receipt[$field] $field
    }
    if ($Actual.receipt.code -notin @('persisted','unchanged')) { throw 'Mandatory event is not confirmed' }
    if ($Actual.receipt.serverRevision -isnot [long] -and $Actual.receipt.serverRevision -isnot [int]) { throw 'Revision must be a committed integer' }
    if ($Actual.receipt.serverRevision -le 0) { throw 'No committed revision' }
    if ($Actual.receipt.code -eq 'unchanged' -and -not $Actual.readbackMatched) { throw 'Unchanged requires matching persisted readback' }
    if ($Actual.receipt.at -isnot [string] -or [string]::IsNullOrWhiteSpace($Actual.receipt.at)) { throw 'Receipt timestamp omitted' }
    Test-OrdinalValue $Expected.payloadJson $Actual.payloadJson 'immutable payloadJson'
    Test-OrdinalValue $Expected.requestText $Actual.requestText 'complete request text'
    Test-OrdinalValue $Expected.responseText $Actual.responseText 'complete final response text'
    if ($Actual.storedEventIds.Count -ne $Expected.storedEventIds.Count) { throw 'Incomplete expected event coverage' }
    for ($i=0; $i -lt $Expected.storedEventIds.Count; $i++) {
        Test-OrdinalValue $Expected.storedEventIds[$i] $Actual.storedEventIds[$i] 'stored event order/identity'
    }
    if ($Actual.decisionTriple.Count -ne 3) { throw 'Incomplete explicit decision triple' }
    foreach ($item in $Actual.decisionTriple) {
        Test-OrdinalValue 'decision-1' $item.eventId 'decision event identity'
        Test-OrdinalValue 'Keep captured attribution.' $item.conclusion 'decision conclusion'
    }
    Test-OrdinalValue 'designDecisions' $Actual.decisionTriple[0].kind 'decision field'
    Test-OrdinalValue 'decision' $Actual.decisionTriple[1].kind 'decision dialog'
    Test-OrdinalValue 'design_decision' $Actual.decisionTriple[2].kind 'decision action'
}

function Test-SyncObservation {
    param([System.Collections.IDictionary]$Expected, [System.Collections.IDictionary]$Actual)
    if ($Expected.Count -ne $Actual.Count) { throw 'Sync inventory differs' }
    foreach ($path in $Expected.Keys) {
        if (-not $Actual.Contains($path)) { throw "Missing synced file: $path" }
        Test-OrdinalValue $Expected[$path] $Actual[$path] "synced digest: $path"
    }
}

function Copy-TestValue {
    param($Value)
    # Clone fixtures without JSON date coercion or shared nested references.
    if ($Value -is [System.Collections.IDictionary]) {
        $copy = [ordered]@{}
        foreach ($key in $Value.Keys) { $copy[$key] = Copy-TestValue $Value[$key] }
        return $copy
    }
    if ($Value -is [array]) {
        $copy = @($Value | ForEach-Object { Copy-TestValue $_ })
        return ,$copy
    }
    return $Value
}

$rawRequest = "Full request`n  keep whitespace, Markdown **and Unicode** $([char]0x03bb).`n"
$rawResponse = "Result $([char]0x2013) exact $([char]0x2014) text`n`n  trailing spaces  `n"
$normalizedResponse = $rawResponse.Replace([char]0x2013,[char]0x002d).Replace([char]0x2014,[char]0x002d)
$payloadObject = [ordered]@{request=$rawRequest;response=$normalizedResponse;scoreText='98.0000000000000000000000000000'}
$payloadJson = $payloadObject | ConvertTo-Json -Depth 10 -Compress
$expectedAudit = [ordered]@{
    receipt=[ordered]@{workspaceId='test-workspace-p';agentIdentity='ClineQb';mcpSessionId='test-session-p';requestId='test-request-p';eventId='event-2';order=2;method='test-supported-audit';payloadHash=(Get-TextDigest $payloadJson);code='persisted';serverRevision=7;at='2026-10-21T22:00:00-05:00'}
    payloadJson=$payloadJson
    requestText=$rawRequest
    responseText=$normalizedResponse
    storedEventIds=@('event-1','event-2')
    readbackMatched=$true
    decisionTriple=@(
        @{kind='designDecisions';eventId='decision-1';conclusion='Keep captured attribution.'},
        @{kind='decision';eventId='decision-1';conclusion='Keep captured attribution.'},
        @{kind='design_decision';eventId='decision-1';conclusion='Keep captured attribution.'}
    )
}
$expectedSync=[ordered]@{
    'lib/test-core.ps1'=(Get-TextDigest 'test core bytes')
    'skills/handoff/SKILL.md'=(Get-TextDigest 'test skill bytes')
}
. (Join-Path $PSScriptRoot 'QbP1.ScriptedProvider.ps1')

# Operation inputs are created from request/result/decision and source bytes.
# They are not observations. Neither provider receives $expectedAudit/$expectedSync.
$operationEvents=@()
foreach($operationEvent in @(@{id='event-1';order=1;body=([ordered]@{request=$rawRequest}|ConvertTo-Json -Compress);response=''},@{id='event-2';order=2;body=$payloadJson;response=$normalizedResponse})) {
    $operationEvents+=,[ordered]@{
        workspaceId='test-workspace-p';agentIdentity='ClineQb';mcpSessionId='test-session-p';requestId='test-request-p'
        eventId=$operationEvent.id;order=$operationEvent.order;method='test-supported-audit';payloadJson=$operationEvent.body
        requestText=$rawRequest;responseText=$operationEvent.response
        decisionTriple=@()
    }
}
$operationEvents[1].decisionTriple=@(
    @{kind='designDecisions';eventId='decision-1';conclusion='Keep captured attribution.'},
    @{kind='decision';eventId='decision-1';conclusion='Keep captured attribution.'},
    @{kind='design_decision';eventId='decision-1';conclusion='Keep captured attribution.'}
)
$operationSources=@(
    @{path='lib/test-core.ps1';content='test core bytes'},
    @{path='skills/handoff/SKILL.md';content='test skill bytes'}
)

function Get-QbFault {
    param([string]$Stage,[string]$Action,[object[]]$Path,$Value)
    return @{stage=$Stage;action=$Action;path=$Path;value=$Value}
}

function Invoke-QbCapturedOperation {
    param($Provider,[Collections.Generic.List[object]]$Effects,[string]$Operation,[System.Collections.IDictionary]$OperationInput)
    $invoke=$Provider.Invoke
    $reply=& $invoke $Provider.State $Operation (Copy-TestValue $OperationInput)
    $Effects.Add(@{operation=$Operation;input=(Copy-TestValue $OperationInput);reply=(Copy-TestValue $reply)})
    return $reply
}

function Invoke-QbScenario {
    param([string]$Kind,[object[]]$Faults,[bool]$Replay,[object[]]$Events,[object[]]$Sources,[scriptblock]$Factory)
    $provider=if($Factory){& $Factory (Copy-TestValue $Faults)}else{Get-QbScriptedProvider $Faults}
    $effects=[Collections.Generic.List[object]]::new()
    if($Kind -eq 'audit') {
        foreach($operationEvent in $Events) { [void](Invoke-QbCapturedOperation $provider $effects 'submit' $operationEvent) }
        if($Replay){[void](Invoke-QbCapturedOperation $provider $effects 'submit' $Events[-1])}
        [void](Invoke-QbCapturedOperation $provider $effects 'read' @{workspaceId=$Events[0].workspaceId;requestId=$Events[0].requestId})
    } else {
        foreach($source in $Sources) {[void](Invoke-QbCapturedOperation $provider $effects 'syncWrite' $source)}
        [void](Invoke-QbCapturedOperation $provider $effects 'syncRead' @{})
    }
    return @{effects=@($effects);kind=$Kind;replay=$Replay}
}

function Test-QbScenarioInteraction {
    param($Run,[object[]]$Events,[object[]]$Sources)
    $operations=if($Run.kind -eq 'audit'){@('submit','submit')+$(if($Run.replay){@('submit')}else{@()})+@('read')}else{@('syncWrite','syncWrite','syncRead')}
    if($Run.effects.Count -ne $operations.Count){throw 'Dependency operation coverage differs'}
    for($index=0;$index -lt $operations.Count;$index++) {
        Test-OrdinalValue $operations[$index] $Run.effects[$index].operation 'dependency operation order'
        if($null -eq $Run.effects[$index].reply){throw "Missing dependency reply: $($operations[$index])"}
    }
    if($Run.kind -eq 'audit') {
        for($index=0;$index -lt $Events.Count;$index++) {
            Test-OrdinalValue $Events[$index].payloadJson $Run.effects[$index].input.payloadJson 'submitted immutable input'
            Test-OrdinalValue $Events[$index].eventId $Run.effects[$index].input.eventId 'submitted event identity'
        }
    } else {
        for($index=0;$index -lt $Sources.Count;$index++) {
            Test-OrdinalValue $Sources[$index].path $Run.effects[$index].reply.written 'sync write acknowledgment'
            Test-OrdinalValue $Sources[$index].content $Run.effects[$index].input.content 'sync source bytes'
        }
    }
}

function Get-QbScenarioObservation {
    param($Run,[object[]]$Events)
    if($Run.kind -eq 'sync') {
        $digests=[ordered]@{}
        foreach($path in $Run.effects[-1].reply.Keys) {$digests[$path]=Get-TextDigest $Run.effects[-1].reply[$path]}
        return $digests
    }
    $stored=@($Run.effects[-1].reply.events)
    $ingress=@($stored | Where-Object eventId -CEQ 'event-1')
    $final=@($stored | Where-Object eventId -CEQ 'event-2')
    $finalEvent=if($final.Count -gt 0){$final[-1]}else{@{payloadJson='';responseText='';decisionTriple=@()}}
    $request=if($ingress.Count -gt 0){$ingress[0].requestText}else{''}
    return [ordered]@{
        receipt=$Run.effects[-2].reply
        payloadJson=$finalEvent.payloadJson;requestText=$request;responseText=$finalEvent.responseText
        storedEventIds=@($stored | ForEach-Object eventId)
        readbackMatched=($finalEvent.payloadJson -ceq $Events[-1].payloadJson)
        decisionTriple=$finalEvent.decisionTriple
    }
}

$cases=[Collections.Generic.List[object]]::new()
$cases.Add(@{name='confirmed receipt and exact normalized request/result';kind='audit';expected=$expectedAudit;faults=@();replay=$false;reject=$false})
$cases.Add(@{name='unchanged with matching persisted readback';kind='audit';expected=$expectedAudit;faults=@();replay=$true;reject=$false})
foreach ($field in @('workspaceId','agentIdentity','mcpSessionId','requestId','eventId','order','method','payloadHash')) {
    $value=if($field -eq 'order'){3}else{'wrong-'+$field}
    $cases.Add(@{name="wrong receipt $field";kind='audit';expected=$expectedAudit;faults=@(Get-QbFault 'submitReply' 'set' @($field) $value);replay=$false;reject=$true})
    $cases.Add(@{name="omitted receipt $field";kind='audit';expected=$expectedAudit;faults=@(Get-QbFault 'submitReply' 'remove' @($field));replay=$false;reject=$true})
}
foreach ($code in @('queued','rejected','lost','skipped_duplicate','created','merged')) {
    $cases.Add(@{name="turn outcome or unconfirmed code $code cannot confirm event";kind='audit';expected=$expectedAudit;faults=@(Get-QbFault 'submitReply' 'set' @('code') $code);replay=$false;reject=$true})
}
foreach ($revision in @(0,-1,'7',7.5)) {
    $cases.Add(@{name="invalid revision $revision ($($revision.GetType().Name))";kind='audit';expected=$expectedAudit;faults=@(Get-QbFault 'submitReply' 'set' @('serverRevision') $revision);replay=$false;reject=$true})
}
# Corrupt stored effects/replies, rather than precomputed observation fields.
$mutations=[ordered]@{
    'unchanged without readback'=@((Get-QbFault 'submitReply' 'set' @('code') 'unchanged'),(Get-QbFault 'storedEffects' 'append' @('events',1,'payloadJson') ' '))
    'omitted receipt timestamp'=@(Get-QbFault 'submitReply' 'remove' @('at'))
    'changed immutable payload bytes'=@(Get-QbFault 'storedEffects' 'append' @('events',1,'payloadJson') ' ')
    'summarized request'=@(Get-QbFault 'storedEffects' 'set' @('events',0,'requestText') 'Full request')
    'summarized response'=@(Get-QbFault 'storedEffects' 'set' @('events',1,'responseText') 'Result summary')
    'trimmed final response'=@(Get-QbFault 'storedEffects' 'trim' @('events',1,'responseText'))
    'prohibited dash retained'=@(Get-QbFault 'storedEffects' 'set' @('events',1,'responseText') $rawResponse)
    'reordered stored events'=@(Get-QbFault 'storedEffects' 'reverse' @('events'))
    'omitted ingress event'=@(Get-QbFault 'storedEffects' 'set' @('events') @((Copy-TestValue $operationEvents[1])))
    'same count wrong event'=@(Get-QbFault 'storedEffects' 'set' @('events',0,'eventId') 'foreign')
    'duplicate event'=@(Get-QbFault 'storedEffects' 'set' @('events',0,'eventId') 'event-2')
    'omitted decision dialog'=@(Get-QbFault 'storedEffects' 'set' @('events',1,'decisionTriple') @($operationEvents[1].decisionTriple[0],$operationEvents[1].decisionTriple[2]))
    'wrong decision conclusion'=@(Get-QbFault 'storedEffects' 'set' @('events',1,'decisionTriple',1,'conclusion') 'Tool activity')
    'wrong decision identity'=@(Get-QbFault 'storedEffects' 'set' @('events',1,'decisionTriple',2,'eventId') 'foreign')
    'tool action as decision'=@(Get-QbFault 'storedEffects' 'set' @('events',1,'decisionTriple',2,'kind') 'tool_execution')
}
foreach($name in $mutations.Keys) {
    $cases.Add(@{name=$name;kind='audit';expected=$expectedAudit;faults=$mutations[$name];replay=$false;reject=$true})
}
$cases.Add(@{name='byte-identical synced inventory';kind='sync';expected=$expectedSync;faults=@();replay=$false;reject=$false})
$syncMutations=[ordered]@{
    omitted=@(Get-QbFault 'syncEffects' 'remove' @('files','skills/handoff/SKILL.md'))
    changed=@(Get-QbFault 'syncEffects' 'set' @('files','lib/test-core.ps1') 'edited generated copy')
    extra=@(Get-QbFault 'syncEffects' 'set' @('files','lib/untracked-core.ps1') 'unapproved copy')
}
foreach($name in $syncMutations.Keys) {
    $cases.Add(@{name="$name synced inventory";kind='sync';expected=$expectedSync;faults=$syncMutations[$name];replay=$false;reject=$true})
}
# Missing replies exercise the same common runner and assertion block as originals.
foreach($stage in @('submitReply','readReply')) {
    $cases.Add(@{name="missing $stage dependency reply";kind='audit';expected=$expectedAudit;faults=@(Get-QbFault $stage 'null' @());replay=$false;reject=$true})
}
if (-not $PSCmdlet.ShouldProcess($ReceiptPath,"Run $($cases.Count) isolated interaction cases (original 47 plus 2 missing replies); create exactly 1 receipt file")) { return }
if(Test-Path -LiteralPath $ReceiptPath) { throw 'Preserve prior receipts: select a new ReceiptPath.' }
$results=[Collections.Generic.List[object]]::new()
foreach($case in $cases) {
    $rejected=$false;$reason='';$executionError='';$run=$null
    try {
        $run=Invoke-QbScenario $case.kind $case.faults $case.replay $operationEvents $operationSources $ProviderFactory
    } catch {$executionError=$_.Exception.Message}
    if(-not $executionError) {
        try {
            Test-QbScenarioInteraction $run $operationEvents $operationSources
            $observation=Get-QbScenarioObservation $run $operationEvents
            if($case.kind -eq 'audit'){Test-AuditObservation $case.expected $observation}else{Test-SyncObservation $case.expected $observation}
        } catch {$rejected=$true;$reason=$_.Exception.Message}
    }
    $results.Add([ordered]@{name=$case.name;kind=$case.kind;expectedRejection=$case.reject;rejected=$rejected;passed=(-not $executionError -and ($rejected -eq $case.reject));reason=$reason;executionError=$executionError;faults=$case.faults;interaction=$run})
}
$failed=@($results | Where-Object {-not $_.passed}).Count
$report=[ordered]@{
    timestamp=[DateTimeOffset]::Now.ToString('yyyy-MM-ddTHH:mm:sszzz')
    mode=$(if($ProviderFactory){'ExternalProviderCommonScenarioRunner'}else{'ScriptedDependencyInteractions'})
    total=$results.Count;passed=$results.Count-$failed;failed=$failed;skipped=0
    originalVectors=47;additionalMissingReplyControls=2
    positiveCases=@($results | Where-Object {-not $_.expectedRejection}).Count
    expectedNegativeControls=@($results | Where-Object expectedRejection).Count
    expectedNegativeControlsRejected=@($results | Where-Object {$_.expectedRejection -and $_.rejected}).Count
    executionErrors=@($results | Where-Object executionError).Count
    productionVerified=$false;phaseAccepted=$false;productComplete=$false
    testSha256=(Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash
    providerSha256=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'QbP1.ScriptedProvider.ps1') -Algorithm SHA256).Hash
    tests=@($results)
}
$receiptContent=$report | ConvertTo-Json -Depth 60
Add-LinesToFile -LiteralPath $ReceiptPath -Content $receiptContent | Out-Null
[pscustomobject]$report
if($failed -ne 0){throw "$failed contract cases failed; retained receipt $ReceiptPath"}



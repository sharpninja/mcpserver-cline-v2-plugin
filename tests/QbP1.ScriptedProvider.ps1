# SPDX-License-Identifier: Apache-2.0
#Requires -Version 7.0
<#
Test-only in-memory dependency. No production API, lifecycle, transport or sync
implementation is defined here. Receives operation inputs and fault edits only,
never assertions, expected observations or case names. State changes precede
read replies. The common runner captures every invocation and reply separately.
#>
function Copy-QbDependencyValue {
    param($Value)
    if ($Value -is [System.Collections.IDictionary]) {
        $copy=[ordered]@{}
        foreach($key in $Value.Keys){$copy[$key]=Copy-QbDependencyValue $Value[$key]}
        return $copy
    }
    if ($Value -is [array]) { return ,@($Value | ForEach-Object {Copy-QbDependencyValue $_}) }
    return $Value
}

function Invoke-QbDependencyFault {
    param([System.Collections.IDictionary]$State,[string]$Stage,$Value)
    foreach($edit in @($State.faults | Where-Object {$_.stage -ceq $Stage})) {
        if($edit.action -eq 'null'){return $null}
        $target=$Value
        for($index=0;$index -lt $edit.path.Count-1;$index++) {$target=$target[$edit.path[$index]]}
        $leaf=$edit.path[-1]
        switch($edit.action) {
            'set' {$target[$leaf]=Copy-QbDependencyValue $edit.value}
            'remove' {[void]$target.Remove($leaf)}
            'append' {$target[$leaf]+=$edit.value}
            'trim' {$target[$leaf]=$target[$leaf].Trim()}
            'reverse' {$values=@($target[$leaf]);[array]::Reverse($values);$target[$leaf]=$values}
            default {throw "Invalid scripted dependency edit: $($edit.action)"}
        }
    }
    return $Value
}

function Invoke-QbScriptedOperation {
    param([System.Collections.IDictionary]$State,[string]$Operation,[System.Collections.IDictionary]$OperationInput)
    $State.calls+=,$Operation
    switch($Operation) {
        'submit' {
            $existing=@($State.events | Where-Object eventId -CEQ $OperationInput.eventId)
            if($existing.Count -gt 0) {
                if($existing[0].payloadJson -cne $OperationInput.payloadJson){throw 'Scripted duplicate differs'}
                $code='unchanged'
            } else {
                $State.events+=,(Copy-QbDependencyValue $OperationInput)
                $State.revision++
                $code='persisted'
            }
            $receipt=[ordered]@{}
            foreach($key in @('workspaceId','agentIdentity','mcpSessionId','requestId','eventId','order','method')) {
                $receipt[$key]=$OperationInput[$key]
            }
            $receipt.payloadHash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($OperationInput.payloadJson))).ToLowerInvariant()
            $receipt.code=$code
            $receipt.serverRevision=$State.revision
            $receipt.at=$State.clock
            if($OperationInput.order -eq 2) {
                [void](Invoke-QbDependencyFault $State 'storedEffects' $State)
                return Invoke-QbDependencyFault $State 'submitReply' $receipt
            }
            return $receipt
        }
        'read' {
            $reply=[ordered]@{events=(Copy-QbDependencyValue $State.events)}
            return Invoke-QbDependencyFault $State 'readReply' $reply
        }
        'syncWrite' {
            $State.files[$OperationInput.path]=$OperationInput.content
            return @{written=$OperationInput.path}
        }
        'syncRead' {
            [void](Invoke-QbDependencyFault $State 'syncEffects' $State)
            return Copy-QbDependencyValue $State.files
        }
        default {throw "Unsupported scripted operation: $Operation"}
    }
}

function Get-QbScriptedProvider {
    param([object[]]$Faults)
    return @{
        Invoke=${function:Invoke-QbScriptedOperation}
        State=[ordered]@{
            faults=(Copy-QbDependencyValue $Faults)
            events=@();files=[ordered]@{};calls=@();revision=5
            clock='2026-10-21T22:00:00-05:00'
        }
    }
}



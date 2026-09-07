[CmdletBinding()]
param(
    [ValidateSet("chatgpt", "stealthwriter")]
    [string]$Tool = "chatgpt"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 3.0

function Write-ProgressEvent {
    param([string]$Stage)
    [ordered]@{ result = "PROGRESS"; tool = $Tool; stage = $Stage } |
        ConvertTo-Json -Compress | Write-Output
}

function Test-AllowedHost {
    param([string]$Candidate, [string[]]$AllowedHosts)
    $hostName = ([string]$Candidate).Trim().TrimStart(".").ToLowerInvariant()
    foreach ($allowed in $AllowedHosts) {
        if ($hostName -eq $allowed -or $hostName.EndsWith("." + $allowed)) { return $true }
    }
    return $false
}

function Open-CdpSocket {
    param([string]$WebSocketUrl)
    $socket = New-Object System.Net.WebSockets.ClientWebSocket
    $socket.Options.SetRequestHeader("Origin", "http://127.0.0.1")
    $uri = [System.Uri]::new($WebSocketUrl)
    $socket.ConnectAsync($uri, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    return $socket
}

function Invoke-Cdp {
    param(
        [System.Net.WebSockets.ClientWebSocket]$Socket,
        [int]$Id,
        [string]$Method,
        [hashtable]$Params = @{}
    )
    $message = @{ id = $Id; method = $Method; params = $Params } |
        ConvertTo-Json -Compress -Depth 20
    $bytes = [Text.Encoding]::UTF8.GetBytes($message)
    $segment = New-Object System.ArraySegment[byte] -ArgumentList (, $bytes)
    $Socket.SendAsync(
        $segment,
        [Net.WebSockets.WebSocketMessageType]::Text,
        $true,
        [Threading.CancellationToken]::None
    ).GetAwaiter().GetResult()

    while ($true) {
        $stream = New-Object IO.MemoryStream
        try {
            do {
                $buffer = New-Object byte[] 65536
                $receiveSegment = New-Object System.ArraySegment[byte] -ArgumentList (, $buffer)
                $result = $Socket.ReceiveAsync(
                    $receiveSegment,
                    [Threading.CancellationToken]::None
                ).GetAwaiter().GetResult()
                if ($result.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close) {
                    throw "Chrome closed the private DevTools connection."
                }
                $stream.Write($buffer, 0, $result.Count)
            } while (-not $result.EndOfMessage)
            $payload = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
        }
        finally { $stream.Dispose() }

        if ($payload.PSObject.Properties.Name -contains "id" -and [int]$payload.id -eq $Id) {
            if ($payload.PSObject.Properties.Name -contains "error") {
                throw "Chrome could not complete the private state capture."
            }
            return $payload.result
        }
    }
}

function Get-ChromePath {
    $programFilesX86 = [Environment]::GetEnvironmentVariable("PROGRAMFILES(X86)")
    $candidates = @(
        (Join-Path $env:PROGRAMFILES "Google\Chrome\Application\chrome.exe"),
        (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
    )
    if ($programFilesX86) {
        $candidates += Join-Path $programFilesX86 "Google\Chrome\Application\chrome.exe"
    }
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
    }
    throw "Google Chrome was not found. Install normal desktop Chrome before running this helper."
}

function Get-PythonPath {
    $python = Get-ChildItem `
        (Join-Path $env:LOCALAPPDATA "Programs\Python\Python*\python.exe") `
        -File -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending |
        Select-Object -First 1 -ExpandProperty FullName
    if (-not $python) { throw "A top-level Python installation was not found." }
    return $python
}

function Import-DotEnv {
    param([string]$Path)
    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $name, $value = $line -split "=", 2
            [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), "Process")
        }
    }
}

$profiles = @{
    chatgpt = @{
        StartUrl = "https://chatgpt.com/"
        AllowedHosts = @("chatgpt.com", "openai.com")
    }
    stealthwriter = @{
        StartUrl = "https://stealthwriter.ai/dashboard"
        AllowedHosts = @("stealthwriter.ai")
    }
}
$profile = $profiles[$Tool]
$repoRoot = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $repoRoot ".env"
if (-not (Test-Path -LiteralPath $environmentFile -PathType Leaf)) {
    throw "The repository .env file is missing."
}

$tempRoot = Join-Path $env:TEMP ("toprated-phase10-desktop-" + [Guid]::NewGuid().ToString("N"))
$chromeProfile = Join-Path $tempRoot "chrome-profile"
$stateFile = Join-Path $tempRoot "authorized-state.json"
$chrome = $null
$browserSocket = $null
$pageSocket = $null
$previousTool = $env:PHASE10_LIVE_TOOL
$previousStateFile = $env:PHASE10_DESKTOP_STATE_FILE

try {
    Write-ProgressEvent "PREPARE_PRIVATE_DESKTOP_PROFILE"
    [void][IO.Directory]::CreateDirectory($chromeProfile)

    $directoryInfo = [IO.DirectoryInfo]::new($tempRoot)
    $security = New-Object Security.AccessControl.DirectorySecurity
    $security.SetAccessRuleProtection($true, $false)
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
        $identity,
        [Security.AccessControl.FileSystemRights]::FullControl,
        [Security.AccessControl.InheritanceFlags]"ContainerInherit, ObjectInherit",
        [Security.AccessControl.PropagationFlags]::None,
        [Security.AccessControl.AccessControlType]::Allow
    )
    [void]$security.AddAccessRule($rule)
    $directoryInfo.SetAccessControl($security)

    Import-DotEnv $environmentFile
    $chromePath = Get-ChromePath
    $pythonPath = Get-PythonPath
    $arguments = @(
        "--user-data-dir=`"$chromeProfile`"",
        "--remote-debugging-port=0",
        "--remote-allow-origins=http://127.0.0.1",
        "--no-first-run",
        "--no-default-browser-check",
        $profile.StartUrl
    )
    $chrome = Start-Process -FilePath $chromePath -ArgumentList $arguments -PassThru

    $activePortFile = Join-Path $chromeProfile "DevToolsActivePort"
    $deadline = (Get-Date).AddSeconds(30)
    while (-not (Test-Path -LiteralPath $activePortFile -PathType Leaf)) {
        if ((Get-Date) -ge $deadline -or $chrome.HasExited) {
            throw "Normal desktop Chrome did not expose its private local capture channel."
        }
        Start-Sleep -Milliseconds 250
    }
    $activePort = Get-Content -LiteralPath $activePortFile
    if ($activePort.Count -lt 2 -or [int]$activePort[0] -le 0) {
        throw "Chrome returned an invalid private capture endpoint."
    }
    $port = [int]$activePort[0]
    $browserWebSocket = "ws://127.0.0.1:$port" + [string]$activePort[1]

    Write-Host ""
    Write-Host "A dedicated normal Chrome window is open for $Tool."
    Write-Host "Complete the legitimate account login and provider verification in that window."
    Write-Host "Return here only after the authenticated account page is visible."
    [void](Read-Host "Press Enter to capture allowlisted state and run the fresh-browser proof")

    Write-ProgressEvent "CAPTURE_ALLOWLISTED_DESKTOP_STATE"
    $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -Method Get
    $page = $targets |
        Where-Object {
            $_.type -eq "page" -and $_.webSocketDebuggerUrl -and
            (Test-AllowedHost ([Uri]$_.url).Host $profile.AllowedHosts)
        } |
        Select-Object -First 1
    if (-not $page) { throw "Chrome is not showing an allowlisted authenticated tool page." }

    $browserSocket = Open-CdpSocket $browserWebSocket
    $cookieResult = Invoke-Cdp -Socket $browserSocket -Id 1 -Method "Storage.getCookies"
    $capturedCookies = @()
    foreach ($cookie in @($cookieResult.cookies)) {
        if (-not (Test-AllowedHost ([string]$cookie.domain) $profile.AllowedHosts)) { continue }
        $normalized = [ordered]@{
            name = [string]$cookie.name
            value = [string]$cookie.value
            domain = [string]$cookie.domain
            path = [string]$cookie.path
            expires = [double]$cookie.expires
            secure = [bool]$cookie.secure
            httpOnly = [bool]$cookie.httpOnly
        }
        if ($cookie.PSObject.Properties.Name -contains "sameSite" -and
            $cookie.sameSite -in @("Strict", "Lax", "None")) {
            $normalized.sameSite = [string]$cookie.sameSite
        }
        $capturedCookies += $normalized
    }

    $pageSocket = Open-CdpSocket ([string]$page.webSocketDebuggerUrl)
    $expression = @'
(() => {
  const read = (store) => {
    const result = {};
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key !== null) result[key] = store.getItem(key);
    }
    return result;
  };
  return JSON.stringify({
    url: String(location.href || ""),
    localStorage: read(localStorage),
    sessionStorage: read(sessionStorage)
  });
})()
'@
    $storageResult = Invoke-Cdp -Socket $pageSocket -Id 2 -Method "Runtime.evaluate" -Params @{
        expression = $expression
        returnByValue = $true
    }
    $storage = [string]$storageResult.result.value | ConvertFrom-Json
    if (-not (Test-AllowedHost ([Uri]$storage.url).Host $profile.AllowedHosts)) {
        throw "Captured browser storage is outside the configured tool hosts."
    }
    if ($capturedCookies.Count -eq 0 -and
        $storage.localStorage.PSObject.Properties.Count -eq 0 -and
        $storage.sessionStorage.PSObject.Properties.Count -eq 0) {
        throw "The authenticated desktop page did not expose reusable browser state."
    }

    $state = [ordered]@{
        authenticated_cookies = $capturedCookies
        session_tokens = [ordered]@{
            captured_at = (Get-Date).ToUniversalTime().ToString("o")
            storage = [ordered]@{
                localStorage = $storage.localStorage
                sessionStorage = $storage.sessionStorage
            }
        }
        auth_headers = @{}
    }
    $json = $state | ConvertTo-Json -Compress -Depth 30
    [IO.File]::WriteAllText($stateFile, $json, [Text.UTF8Encoding]::new($false))
    $state = $null
    $json = $null

    try { [void](Invoke-Cdp -Socket $browserSocket -Id 3 -Method "Browser.close") } catch {}
    if ($pageSocket) { $pageSocket.Dispose(); $pageSocket = $null }
    if ($browserSocket) { $browserSocket.Dispose(); $browserSocket = $null }

    $env:PHASE10_LIVE_TOOL = $Tool
    $env:PHASE10_DESKTOP_STATE_FILE = $stateFile
    Write-ProgressEvent "RUN_FRESH_CONTAINER_PROOF"
    & $pythonPath (Join-Path $PSScriptRoot "phase10-live-account-validation.py")
    if ($LASTEXITCODE -ne 0) { throw "Fresh-container authenticated-state proof failed." }
}
catch {
    [ordered]@{
        result = "FAIL"
        tool = $Tool
        reason = $_.Exception.Message
        credentialsPrinted = $false
        rawStatePrinted = $false
    } | ConvertTo-Json -Compress | Write-Error
    exit 1
}
finally {
    if ($pageSocket) { $pageSocket.Dispose() }
    if ($browserSocket) { $browserSocket.Dispose() }
    if ($chrome -and -not $chrome.HasExited) {
        & taskkill.exe /PID $chrome.Id /T /F 2>$null | Out-Null
        [void]$chrome.WaitForExit(5000)
    }
    $env:PHASE10_LIVE_TOOL = $previousTool
    $env:PHASE10_DESKTOP_STATE_FILE = $previousStateFile

    $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
    $resolvedBase = [IO.Path]::GetFullPath($env:TEMP).TrimEnd("\") + "\"
    if ($resolvedTemp.StartsWith($resolvedBase, [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $resolvedTemp).StartsWith("toprated-phase10-desktop-")) {
        Remove-Item -LiteralPath $resolvedTemp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

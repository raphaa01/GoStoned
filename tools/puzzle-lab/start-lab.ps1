$ErrorActionPreference = 'Stop'
$puzzleRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$puzzleUrl = 'http://127.0.0.1:4184'
$puzzleNode = (Get-Command node -ErrorAction Stop).Source
$puzzleServer = Join-Path $PSScriptRoot 'server.mjs'
$puzzleData = Join-Path $puzzleRoot '.cache/puzzle-lab'
New-Item -ItemType Directory -Path $puzzleData -Force | Out-Null
try {
    $puzzleExisting = Invoke-RestMethod -Uri "$puzzleUrl/api/bootstrap" -TimeoutSec 2
    if ($puzzleExisting.version -eq 'gostone-local-puzzle-lab/1' -and $puzzleExisting.root -eq $puzzleData) {
        Start-Process $puzzleUrl
        exit 0
    }
    throw 'Port 4184 is already used by another service.'
} catch {
    if ($_.Exception.Message -eq 'Port 4184 is already used by another service.') { throw }
}
$puzzleProcess = Start-Process -FilePath $puzzleNode -ArgumentList @('"' + $puzzleServer + '"', '--no-browser') -WorkingDirectory $puzzleRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $puzzleData 'lab.log') -RedirectStandardError (Join-Path $puzzleData 'lab-error.log')
for ($puzzleAttempt = 0; $puzzleAttempt -lt 30; $puzzleAttempt++) {
    Start-Sleep -Milliseconds 300
    try {
        $puzzleReady = Invoke-RestMethod -Uri "$puzzleUrl/api/bootstrap" -TimeoutSec 2
        if ($puzzleReady.version -eq 'gostone-local-puzzle-lab/1' -and $puzzleReady.root -eq $puzzleData) {
            Start-Process $puzzleUrl
            exit 0
        }
    } catch { }
    if ($puzzleProcess.HasExited) { break }
}
throw "Puzzle Lab could not start. See $puzzleData/lab-error.log; alternatively run npm run puzzles:lab in $puzzleRoot."

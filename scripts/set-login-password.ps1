[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

function Read-PlainPassword {
    param([string]$Prompt)

    $secureValue = Read-Host -Prompt $Prompt -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

Write-Host ""
Write-Host "Paper Graph 배포 사이트 비밀번호 설정" -ForegroundColor Cyan
Write-Host "채팅에 공개한 비밀번호는 재사용하지 마세요."
Write-Host "새 비밀번호는 14~256자로 입력해야 하며, 입력 문자는 화면에 표시되지 않습니다."
Write-Host ""

while ($true) {
    $password = Read-PlainPassword "새 비밀번호"
    if ($password.Length -lt 14 -or $password.Length -gt 256) {
        Write-Host "비밀번호는 14~256자여야 합니다. 다시 입력하세요." -ForegroundColor Red
        $password = $null
        continue
    }

    $confirmation = Read-PlainPassword "새 비밀번호 확인"
    if ($password -cne $confirmation) {
        Write-Host "두 입력이 일치하지 않습니다. 다시 입력하세요." -ForegroundColor Red
        $password = $null
        $confirmation = $null
        continue
    }
    $confirmation = $null
    break
}

$startInfo = [Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $env:ComSpec
$startInfo.Arguments = '/d /s /c "npx.cmd wrangler secret put INITIAL_GUEST_PASSWORD"'
$startInfo.WorkingDirectory = Split-Path -Parent $PSScriptRoot
$startInfo.UseShellExecute = $false
$startInfo.RedirectStandardInput = $true

$process = [Diagnostics.Process]::new()
$process.StartInfo = $startInfo

try {
    if (-not $process.Start()) {
        throw "wrangler를 시작하지 못했습니다."
    }
    $process.StandardInput.WriteLine($password)
    $process.StandardInput.Close()
    $password = $null
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw "Cloudflare secret 저장이 실패했습니다 (exit code $($process.ExitCode))."
    }
}
finally {
    $password = $null
    $confirmation = $null
    $process.Dispose()
}

Write-Host ""
Write-Host "Cloudflare에 새 비밀번호를 안전하게 등록했습니다." -ForegroundColor Green
Write-Host "배포 사이트를 새로고침한 뒤 새 비밀번호로 로그인하세요."
Write-Host ""

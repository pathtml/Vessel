<# 
Installs/checks the Windows prerequisites needed to run and build Ai Usage Dock.

Usage:
  powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
  powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1 -SkipNativeBuildTools
  powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1 -BuildInstaller

Notes:
  - Uses winget where possible.
  - Visual Studio Build Tools may require administrator approval and a reboot.
  - API keys are not handled by this script.
#>

[CmdletBinding()]
param(
  [switch]$SkipNativeBuildTools,
  [switch]$BuildInstaller,
  [switch]$NoNpmInstall
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok {
  param([string]$Message)
  Write-Host "OK  $Message" -ForegroundColor Green
}

function Write-Warn {
  param([string]$Message)
  Write-Host "WARN $Message" -ForegroundColor Yellow
}

function Test-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Add-PathIfExists {
  param([string]$PathToAdd)
  if ((Test-Path $PathToAdd) -and (($env:Path -split ";") -notcontains $PathToAdd)) {
    $env:Path = "$PathToAdd;$env:Path"
  }
}

function Add-CommonToolPaths {
  Add-PathIfExists "$env:USERPROFILE\.cargo\bin"
  Add-PathIfExists "$env:ProgramFiles\nodejs"
  Add-PathIfExists "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer"
}

function Require-Winget {
  if (-not (Test-Command "winget")) {
    throw "winget is required. Install App Installer from Microsoft Store, then rerun this script."
  }
}

function Test-WingetPackageInstalled {
  param([string]$Id)
  Require-Winget
  $output = & winget list --id $Id --exact --accept-source-agreements 2>$null
  return ($LASTEXITCODE -eq 0) -and (($output -join "`n") -match [regex]::Escape($Id))
}

function Install-WingetPackage {
  param(
    [string]$Id,
    [string]$Name,
    [string[]]$ExtraArgs = @(),
    [switch]$Force
  )

  Require-Winget
  if ((-not $Force) -and (Test-WingetPackageInstalled -Id $Id)) {
    Write-Ok "$Name is already installed according to winget."
    return
  }

  Write-Step "Installing $Name"
  $args = @(
    "install",
    "--id", $Id,
    "--exact",
    "--accept-package-agreements",
    "--accept-source-agreements"
  ) + $ExtraArgs

  & winget @args
  if ($LASTEXITCODE -ne 0) {
    if (Test-WingetPackageInstalled -Id $Id) {
      Write-Warn "winget returned exit code $LASTEXITCODE, but $Name is installed. Continuing."
      return
    }
    throw "winget failed while installing $Name."
  }
  Add-CommonToolPaths
}

function Ensure-Node {
  Write-Step "Checking Node.js"
  Add-CommonToolPaths
  if (Test-Command "node" -and Test-Command "npm") {
    Write-Ok "Node $(node --version) and npm $(npm --version) are available."
    return
  }

  Install-WingetPackage -Id "OpenJS.NodeJS.LTS" -Name "Node.js LTS"
  Write-Warn "If node/npm are still unavailable, close and reopen PowerShell, then rerun this script."
}

function Ensure-Rust {
  Write-Step "Checking Rust toolchain"
  Add-CommonToolPaths
  if ((Test-Command "rustc") -and (Test-Command "cargo") -and (Test-Command "rustup")) {
    Write-Ok "Rust $(rustc --version) and Cargo $(cargo --version) are available."
    return
  }

  Install-WingetPackage -Id "Rustlang.Rustup" -Name "rustup"
  Add-CommonToolPaths
  Write-Step "Installing stable Rust toolchain"
  if (Test-Command "rustup") {
    & rustup default stable
    if ($LASTEXITCODE -ne 0) {
      throw "rustup failed to install the stable toolchain."
    }
    Write-Ok "Rust stable toolchain installed."
  } else {
    Write-Warn "rustup was installed but is not on PATH yet. Reopen PowerShell and rerun this script."
  }
}

function Ensure-VisualStudioBuildTools {
  if ($SkipNativeBuildTools) {
    Write-Warn "Skipping Visual Studio Build Tools because -SkipNativeBuildTools was provided."
    return
  }

  Write-Step "Checking Visual Studio Build Tools"
  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  $installer = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vs_installer.exe"
  if (Test-Path $vswhere) {
    $install = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($install) {
      Write-Ok "Visual Studio Build Tools with MSVC detected."
      if (Test-WindowsSdkLibraries) {
        return
      }
    }

    $buildToolsInstall = & $vswhere -latest -products Microsoft.VisualStudio.Product.BuildTools -property installationPath
    if ($buildToolsInstall -and (Test-Path $installer)) {
      Write-Step "Adding MSVC and Windows SDK components to existing Visual Studio Build Tools"
      & $installer modify `
        --installPath $buildToolsInstall `
        --quiet `
        --wait `
        --norestart `
        --add Microsoft.VisualStudio.Workload.VCTools `
        --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        --includeRecommended
      if ($LASTEXITCODE -ne 0) {
        throw "Visual Studio Installer failed while adding MSVC/Windows SDK components."
      }
      if (Test-WindowsSdkLibraries) {
        Write-Ok "Visual Studio Build Tools has the required Windows SDK libraries."
        return
      }
      Write-Warn "Visual Studio Build Tools did not add kernel32.lib. Trying Windows 11 SDK component repair."
      Ensure-WindowsSdkLibraries
      return
    }
  }

  $override = '--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --includeRecommended'
  Install-WingetPackage `
    -Id "Microsoft.VisualStudio.2022.BuildTools" `
    -Name "Visual Studio 2022 Build Tools with MSVC and Windows SDK" `
    -ExtraArgs @("--override", $override) `
    -Force

  if (-not (Test-WindowsSdkLibraries)) {
    Ensure-WindowsSdkLibraries
  }

  Write-Warn "Visual Studio Build Tools may require a reboot before Tauri native builds work."
}

function Test-WindowsSdkLibraries {
  $sdkLib = Get-WindowsSdkLibrary

  if ($sdkLib) {
    Write-Ok "Latest compatible Windows SDK detected: $($sdkLib.Version)."
    Write-Ok "kernel32.lib: $($sdkLib.Kernel32Lib)."
    return $true
  }

  Write-Warn "No compatible x64 Windows SDK was found."
  return $false
}

function Get-WindowsSdkLibrary {
  $roots = @("${env:ProgramFiles(x86)}\Windows Kits", "$env:ProgramFiles\Windows Kits") |
    Where-Object { Test-Path $_ }

  $sdkLibs = foreach ($root in $roots) {
    Get-ChildItem $root -Filter "kernel32.lib" -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match "\\Lib\\(?<Version>10\.0\.\d+\.0)\\um\\x64\\kernel32\.lib$" } |
      ForEach-Object {
        $version = [version]$Matches.Version
        $versionText = $version.ToString()
        $versionDir = $_.Directory.Parent.Parent
        $libDir = $versionDir.Parent
        $sdkRoot = $libDir.Parent
        $requiredPaths = @(
          (Join-Path $sdkRoot.FullName "Lib\$versionText\um\x64\kernel32.lib"),
          (Join-Path $sdkRoot.FullName "Lib\$versionText\ucrt\x64"),
          (Join-Path $sdkRoot.FullName "Include\$versionText\um"),
          (Join-Path $sdkRoot.FullName "Include\$versionText\ucrt"),
          (Join-Path $sdkRoot.FullName "Include\$versionText\shared")
        )

        if (($requiredPaths | Where-Object { -not (Test-Path $_) }).Count -eq 0) {
          [pscustomobject]@{
            Version = $version
            SdkRoot = $sdkRoot.FullName
            Kernel32Lib = $_.FullName
          }
        }
      }
  }

  $sdkLibs | Sort-Object Version -Descending | Select-Object -First 1
}

function Ensure-WindowsSdkLibraries {
  Write-Step "Installing Windows SDK libraries"
  if (Test-WindowsSdkLibraries) {
    return
  }

  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  $installer = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vs_installer.exe"
  if ((Test-Path $vswhere) -and (Test-Path $installer)) {
    $buildToolsInstall = & $vswhere -latest -products Microsoft.VisualStudio.Product.BuildTools -property installationPath
    if (-not $buildToolsInstall) {
      $buildToolsInstall = & $vswhere -latest -products * -property installationPath
    }

    if ($buildToolsInstall) {
      Write-Warn "Repairing Visual Studio C++ build tools. The script will use the latest compatible installed Windows SDK."
      & $installer modify `
        --installPath $buildToolsInstall `
        --quiet `
        --wait `
        --norestart `
        --add Microsoft.VisualStudio.Workload.VCTools `
        --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64
      if ($LASTEXITCODE -ne 0) {
        throw "Visual Studio Installer failed while repairing C++ build tools."
      }
    }
  }

  if (-not (Test-WindowsSdkLibraries)) {
    throw "No compatible x64 Windows SDK was found. Install the latest Windows SDK from Visual Studio Installer Individual components, then rerun this script."
  }
}

function Get-WindowsSdkCmdEnvironment {
  $sdk = Get-WindowsSdkLibrary
  if (-not $sdk) {
    throw "No compatible x64 Windows SDK was found."
  }

  $versionText = $sdk.Version.ToString()
  return "set `"WindowsSDKVersion=$versionText\`""
}

function Test-MsvcLinker {
  Add-CommonToolPaths
  if (Test-Command "link.exe") {
    Write-Ok "MSVC linker detected at $((Get-Command link.exe).Source)."
    return $true
  }

  $link = Get-ChildItem "${env:ProgramFiles}\Microsoft Visual Studio", "${env:ProgramFiles(x86)}\Microsoft Visual Studio" `
    -Filter "link.exe" `
    -Recurse `
    -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\VC\\Tools\\MSVC\\.+\\bin\\Hostx64\\x64\\link.exe$" } |
    Sort-Object FullName -Descending |
    Select-Object -First 1

  if ($link) {
    Add-PathIfExists $link.DirectoryName
    Write-Ok "MSVC linker detected at $($link.FullName)."
    return $true
  }

  Write-Warn "MSVC linker link.exe is not available yet."
  return $false
}

function Get-VcVars64Path {
  $vcvars = Get-ChildItem "${env:ProgramFiles(x86)}\Microsoft Visual Studio", "$env:ProgramFiles\Microsoft Visual Studio" `
    -Filter "vcvars64.bat" `
    -Recurse `
    -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Select-Object -First 1

  if (-not $vcvars) {
    throw "vcvars64.bat was not found. Repair Visual Studio Build Tools with the C++ workload."
  }

  return $vcvars.FullName
}

function Invoke-WithVcVars64 {
  param([string]$Command)
  $vcvars = Get-VcVars64Path
  $sdkEnv = Get-WindowsSdkCmdEnvironment
  & cmd.exe /d /c "$sdkEnv && `"$vcvars`" && $Command"
  return $LASTEXITCODE
}

function Ensure-WebView2 {
  Write-Step "Checking Microsoft Edge WebView2 Runtime"
  $webviewPaths = @(
    "${env:ProgramFiles(x86)}\Microsoft\EdgeWebView\Application",
    "$env:ProgramFiles\Microsoft\EdgeWebView\Application"
  )

  if ($webviewPaths | Where-Object { Test-Path $_ }) {
    Write-Ok "WebView2 Runtime detected."
    return
  }

  Install-WingetPackage -Id "Microsoft.EdgeWebView2Runtime" -Name "Microsoft Edge WebView2 Runtime"
}

function Install-ProjectDependencies {
  if ($NoNpmInstall) {
    Write-Warn "Skipping npm install because -NoNpmInstall was provided."
    return
  }

  Write-Step "Installing project npm dependencies"
  & npm.cmd install
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed."
  }
}

function Run-ProjectChecks {
  Write-Step "Running frontend checks"
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed." }

  & npm.cmd run lint
  if ($LASTEXITCODE -ne 0) { throw "npm run lint failed." }

  & npm.cmd run test
  if ($LASTEXITCODE -ne 0) { throw "npm run test failed." }
}

function Show-TauriInfo {
  Write-Step "Checking Tauri environment"
  & npm.cmd run tauri -- info
  if ($LASTEXITCODE -ne 0) {
    Write-Warn "Tauri info reported issues. Review the output above."
  }
}

function Build-NativeInstaller {
  if (-not $BuildInstaller) {
    return
  }

  if (-not (Test-MsvcLinker)) {
    throw "MSVC linker link.exe is missing. Install Visual Studio Build Tools with the C++ workload, then rerun this script."
  }
  if (-not (Test-WindowsSdkLibraries)) {
    throw "Windows SDK library kernel32.lib is missing. Install Visual Studio Build Tools Windows SDK components, then rerun this script."
  }

  Write-Step "Building native Tauri installer"
  $tauriBuildLog = Join-Path (Resolve-Path ".") "src-tauri\target\release\tauri-build.log"
  $exitCode = Invoke-WithVcVars64 -Command "`"$env:ProgramFiles\nodejs\npm.cmd`" run tauri:build -- --bundles msi 1> `"$tauriBuildLog`" 2>&1"
  if ($exitCode -ne 0) {
    Write-Warn "Tauri MSI build failed. Trying WiX fallback with ICE validation suppressed."
    Write-Warn "Original Tauri build log: $tauriBuildLog"
    if (-not (Build-WixMsiWithoutIceValidation)) {
      throw "Tauri installer build failed."
    }
  }
  Write-Ok "Installer build finished. Check src-tauri\target\release\bundle."
}

function Build-WixMsiWithoutIceValidation {
  $repoRoot = if ($PSScriptRoot) {
    Resolve-Path (Join-Path $PSScriptRoot "..")
  } else {
    Resolve-Path "."
  }
  $config = Get-Content (Join-Path $repoRoot "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
  $productName = $config.productName
  $version = $config.version
  $wixDir = Join-Path $repoRoot "src-tauri\target\release\wix\x64"
  $bundleDir = Join-Path $repoRoot "src-tauri\target\release\bundle\msi"
  $light = Join-Path $env:LOCALAPPDATA "tauri\WixTools314\light.exe"
  $wixUi = Join-Path $env:LOCALAPPDATA "tauri\WixTools314\WixUIExtension.dll"
  $wixUtil = Join-Path $env:LOCALAPPDATA "tauri\WixTools314\WixUtilExtension.dll"
  $locale = Join-Path $wixDir "locale.wxl"
  $output = Join-Path $wixDir "output.msi"

  if (-not (Test-Path $light) -or -not (Test-Path $wixDir) -or -not (Test-Path $locale)) {
    Write-Warn "WiX fallback cannot run because generated WiX files or tools are missing."
    return $false
  }

  New-Item -ItemType Directory -Force -Path $bundleDir | Out-Null
  Push-Location $wixDir
  try {
    & $light -sval -ext $wixUi -ext $wixUtil -o $output -cultures:en-us -loc $locale *.wixobj
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $output)) {
      return $false
    }
  } finally {
    Pop-Location
  }

  Copy-Item -Force -Path $output -Destination (Join-Path $bundleDir "$productName`_$version`_x64_en-US.msi")
  return $true
}

function Main {
  $repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
  Set-Location $repoRoot
  Add-CommonToolPaths

  Write-Host "Ai Usage Dock Windows Setup" -ForegroundColor White
  Write-Host "Project: $repoRoot"

  Ensure-Node
  Ensure-WebView2
  Ensure-Rust
  Ensure-VisualStudioBuildTools
  if (-not $SkipNativeBuildTools) {
    Test-MsvcLinker | Out-Null
    Test-WindowsSdkLibraries | Out-Null
  }
  Install-ProjectDependencies
  Run-ProjectChecks
  Show-TauriInfo
  Build-NativeInstaller

  Write-Host ""
  Write-Host "Setup complete." -ForegroundColor Green
  Write-Host "Run the app in dev mode with: npm run tauri:dev"
  Write-Host "Build the installer with: powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1 -BuildInstaller"
}

Main

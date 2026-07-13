# package-zxp.ps1 — empacota e assina a extensão como ZXP (issue #11).
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File tools\package-zxp.ps1 -CertPassword "senha"
#
# O que faz:
#   1. Baixa o ZXPSignCmd oficial da Adobe (uma vez) se não estiver em tools\.
#   2. Copia SÓ os arquivos de runtime do painel para dist\staging\.
#   3. Cria um certificado auto-assinado (dist\cert.p12) se não existir.
#      (Auto-assinado é suficiente para CEP — não há aprovação da Adobe.)
#   4. Assina: dist\inserir-titulos-<versão>.zxp (com timestamp; se o servidor
#      de timestamp estiver fora, assina sem e avisa).
#   5. Verifica a assinatura.
#
# O editor instala o .zxp com o ZXP/UXP Installer (aescripts) — sem
# PlayerDebugMode. O cert.p12 e o .zxp ficam fora do git (.gitignore);
# guarde a senha para re-assinar versões futuras com o MESMO certificado
# (trocar de certificado exige desinstalar/reinstalar no editor).

param(
  [Parameter(Mandatory = $true)][string]$CertPassword
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # raiz do repo (tools\..)
$toolsDir = Join-Path $root 'tools'
$distDir = Join-Path $root 'dist'
$staging = Join-Path $distDir 'staging'
$signCmd = Join-Path $toolsDir 'ZXPSignCmd.exe'
$cert = Join-Path $distDir 'cert.p12'

# versão vem do manifesto (fonte única)
$manifest = Get-Content (Join-Path $root 'CSXS\manifest.xml') -Raw
if ($manifest -notmatch 'ExtensionBundleVersion="([^"]+)"') { throw 'ExtensionBundleVersion não encontrado no manifest.xml' }
$version = $Matches[1]
$zxp = Join-Path $distDir "inserir-titulos-$version.zxp"

# 1. ZXPSignCmd (download único, oficial Adobe-CEP/CEP-Resources 4.1.3 x64)
if (-not (Test-Path $signCmd)) {
  Write-Host 'Baixando ZXPSignCmd 4.1.3 (Adobe-CEP/CEP-Resources)...'
  Invoke-WebRequest -Uri 'https://github.com/Adobe-CEP/CEP-Resources/raw/master/ZXPSignCMD/4.1.3/x64/ZXPSignCmd.exe' -OutFile $signCmd
}

# 2. staging: só o runtime do painel (nada de test/, tools/, docs/, .git, .mogrt)
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Force $staging | Out-Null
foreach ($item in @('CSXS', 'css', 'js', 'jsx', 'index.html', 'template.csv')) {
  $src = Join-Path $root $item
  if (Test-Path $src -PathType Container) {
    Copy-Item $src (Join-Path $staging $item) -Recurse
  } else {
    Copy-Item $src $staging
  }
}

# 3. certificado auto-assinado (só na primeira vez)
if (-not (Test-Path $cert)) {
  Write-Host 'Criando certificado auto-assinado (dist\cert.p12)...'
  & $signCmd -selfSignedCert BR SP 'TD' 'TD Premiere Titulos' $CertPassword $cert -validityDays 3650
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar o certificado.' }
}

# 4. assinar (com timestamp; fallback sem timestamp se o TSA estiver fora)
if (Test-Path $zxp) { Remove-Item -Force $zxp }
Write-Host "Assinando $zxp ..."
& $signCmd -sign $staging $zxp $cert $CertPassword -tsa 'http://timestamp.digicert.com'
if ($LASTEXITCODE -ne 0) {
  Write-Warning 'Timestamp falhou (servidor fora?) — assinando sem timestamp.'
  & $signCmd -sign $staging $zxp $cert $CertPassword
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao assinar o ZXP.' }
}

# 5. verificar
& $signCmd -verify $zxp
if ($LASTEXITCODE -ne 0) { throw 'Assinatura do ZXP não verificou.' }

Write-Host ''
Write-Host "OK: $zxp"
Write-Host 'Instalação no editor: abrir o .zxp com o ZXP/UXP Installer (https://aescripts.com/learn/zxp-installer/).'

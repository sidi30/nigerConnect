# Atelier d'animation NigerConnect — lanceur de la tâche planifiée Windows.
#
# Tourne sur le poste du propriétaire, donc sur son abonnement Claude : aucune
# API payante. Le poste ne fait que PRODUIRE ; le cron du serveur publie 24/7,
# machine allumée ou non. Une session manquée n'interrompt donc rien.
#
# Installation (PowerShell en admin, une seule fois) :
#
#   $a = New-ScheduledTaskAction -Execute "powershell.exe" `
#          -Argument "-NoProfile -ExecutionPolicy Bypass -File C:\Users\ramzi\Desktop\devs\nigerConnect\scripts\animation-atelier.ps1"
#   $t = New-ScheduledTaskTrigger -Daily -At 9:10am
#   $s = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable
#   Register-ScheduledTask -TaskName "NigerConnect-Atelier" -Action $a -Trigger $t -Settings $s
#
# -StartWhenAvailable est le réglage qui compte : si le PC était éteint à
# l'heure prévue, la session se rattrape au démarrage suivant.

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

# Secrets hors dépôt : jeton admin + URL de l'API. Voir .env.atelier.example.
$envFile = Join-Path $env:USERPROFILE '.secrets\nigerconnect-atelier.env'
if (-not (Test-Path $envFile)) {
  Write-Error "Fichier de configuration absent : $envFile (voir scripts/animation-atelier.md)"
}
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.+?)\s*$') {
    Set-Item -Path "env:$($matches[1])" -Value $matches[2]
  }
}

# Norton intercepte le TLS : sans ce CA, tout appel réseau de Node échoue en
# SELF_SIGNED_CERT_IN_CHAIN.
$env:NODE_EXTRA_CA_CERTS = 'C:\Users\ramzi\.certs\norton-root.pem'

$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
$log = Join-Path $logDir "atelier-$stamp.log"

Set-Location $repo
$prompt = Get-Content (Join-Path $PSScriptRoot 'animation-atelier.md') -Raw

# Mode non interactif : Claude Code exécute le prompt et rend la main.
claude -p $prompt 2>&1 | Tee-Object -FilePath $log

# On garde deux semaines de journaux, pas plus.
Get-ChildItem $logDir -Filter 'atelier-*.log' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
  Remove-Item -Force

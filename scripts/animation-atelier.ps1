# Atelier d'animation NigerConnect — lanceur de la tâche planifiée Windows.
#
# Tourne sur le poste du propriétaire, donc sur son abonnement Claude : aucune
# API payante. Le poste ne fait que PRODUIRE les textes ; le cron du serveur
# publie 24/7, machine allumée ou non. Une session manquée ne coupe donc rien —
# elle laisse seulement des réponses sans brouillon, que le filet côté serveur
# rattrape au bout de 45 minutes.
#
# Installation (PowerShell en administrateur, une seule fois) :
#
#   $ps1 = "C:\Users\ramzi\Desktop\devs\nigerConnect\scripts\animation-atelier.ps1"
#   $a = New-ScheduledTaskAction -Execute "powershell.exe" `
#          -Argument "-NoProfile -ExecutionPolicy Bypass -File $ps1"
#   # Toutes les 30 min, indéfiniment, à partir du prochain quart d'heure.
#   $t1 = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
#          -RepetitionInterval (New-TimeSpan -Minutes 30)
#   # …et une reprise immédiate à l'ouverture de session : c'est ce qui fait
#   # repartir l'atelier quand le PC était éteint.
#   $t2 = New-ScheduledTaskTrigger -AtLogOn
#   $s = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable `
#          -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
#   Register-ScheduledTask -TaskName "NigerConnect-Atelier" -Action $a `
#          -Trigger $t1,$t2 -Settings $s -Force
#
# -StartWhenAvailable et le déclencheur -AtLogOn sont les deux réglages qui
# comptent : PC éteint à l'heure prévue = rattrapage au démarrage suivant.
# -MultipleInstances IgnoreNew évite que deux ateliers rédigent le même lot.

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

# Journal AVANT toute chose qui peut échouer. La panne du 19/08/2026 est passée
# inaperçue vingt-quatre heures précisément parce que le script mourait avant
# d'ouvrir son journal : plus aucune trace, donc plus rien à regarder.
$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$log = Join-Path $logDir ("atelier-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd_HHmm'))
$health = Join-Path $logDir 'atelier-derniere-execution.txt'

function Write-Log([string]$msg) {
  $line = "{0}  {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg
  Write-Output $line
  Add-Content -Path $log -Value $line -Encoding utf8
}

Write-Log "Atelier démarré (repo : $repo)"

try {
  # Norton intercepte le TLS : sans ce CA, tout appel réseau de Node échoue en
  # SELF_SIGNED_CERT_IN_CHAIN.
  $ca = 'C:\Users\ramzi\.certs\norton-root.pem'
  if (Test-Path $ca) { $env:NODE_EXTRA_CA_CERTS = $ca }
  else { Write-Log "AVERTISSEMENT : CA Norton absent ($ca) — les appels réseau de Node peuvent échouer" }

  # Aucun jeton, aucun secret : l'atelier parle au serveur par SSH et le CLI du
  # conteneur. Le compte administrateur ayant le TOTP, il n'existe pas de jeton
  # d'API à faire circuler — c'est la raison de ce chemin.
  Write-Log "Vérification de l'accès SSH au VPS"
  $probe = & ssh -o BatchMode=yes -o ConnectTimeout=15 root@46.224.193.109 'echo ok' 2>&1
  if ($LASTEXITCODE -ne 0 -or $probe -notmatch 'ok') {
    throw "SSH injoignable : $probe"
  }

  if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    throw "La commande 'claude' est introuvable dans le PATH de la tâche planifiée."
  }

  Set-Location $repo
  $prompt = Get-Content (Join-Path $PSScriptRoot 'animation-atelier.md') -Raw

  Write-Log "Lancement de Claude Code (mode non interactif)"
  & claude -p $prompt 2>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { throw "claude a rendu le code $LASTEXITCODE" }

  Write-Log 'Atelier terminé sans erreur'
  Set-Content -Path $health -Value ("OK {0}" -f (Get-Date -Format 'o')) -Encoding utf8
}
catch {
  # On journalise ET on laisse une trace lisible d'un coup d'œil, puis on rend
  # un code non nul pour que l'échec remonte dans l'historique de la tâche.
  Write-Log "ÉCHEC : $($_.Exception.Message)"
  Set-Content -Path $health -Value ("ECHEC {0} — {1}" -f (Get-Date -Format 'o'), $_.Exception.Message) -Encoding utf8
  exit 1
}
finally {
  # On garde deux semaines de journaux, pas plus.
  Get-ChildItem $logDir -Filter 'atelier-*.log' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
    Remove-Item -Force -ErrorAction SilentlyContinue
}

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

# Écrire l'état ne doit JAMAIS faire échouer un atelier qui a bien travaillé.
# Le 22/08/2026, une session complète et réussie s'est déclarée en échec parce
# que ce seul fichier était momentanément verrouillé — et la tâche planifiée a
# donc rapporté un échec, ce qui envoie le diagnostic suivant sur une fausse
# piste. On réessaie brièvement, puis on renonce en silence.
function Write-Health([string]$text) {
  for ($i = 0; $i -lt 5; $i++) {
    try {
      Set-Content -Path $health -Value $text -Encoding utf8 -ErrorAction Stop
      return
    } catch {
      Start-Sleep -Milliseconds 300
    }
  }
  Write-Log "AVERTISSEMENT : impossible d'écrire $health (verrouillé) — sans conséquence sur le travail effectué"
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
  # Le prompt passe par l'ENTRÉE STANDARD, jamais en argument. PowerShell
  # redécoupe un argument multi-ligne avant de le remettre au shim `claude.ps1`,
  # et la première ligne du prompt qui commence par « -- » est alors comprise
  # comme une option du CLI. C'est la panne du 22/08/2026 :
  # « error: unknown option '--list-work' ».
  # Marque la descendance : le hook SessionStart (scripts/atelier-au-demarrage.ps1)
  # verra cette variable dans la session Claude lancée ci-dessous et s'abstiendra
  # de relancer un atelier. Sans elle, l'atelier se rappellerait lui-même.
  $env:NIGERCONNECT_ATELIER_ENFANT = '1'
  $prompt | & claude -p 2>&1 | Tee-Object -FilePath $log -Append
  if ($LASTEXITCODE -ne 0) { throw "claude a rendu le code $LASTEXITCODE" }

  Write-Log 'Atelier terminé sans erreur'
  Write-Health ("OK {0}" -f (Get-Date -Format 'o'))
}
catch {
  # On journalise ET on laisse une trace lisible d'un coup d'œil, puis on rend
  # un code non nul pour que l'échec remonte dans l'historique de la tâche.
  Write-Log "ÉCHEC : $($_.Exception.Message)"
  Write-Health ("ECHEC {0} — {1}" -f (Get-Date -Format 'o'), $_.Exception.Message)
  exit 1
}
finally {
  # On garde deux semaines de journaux, pas plus.
  Get-ChildItem $logDir -Filter 'atelier-*.log' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
    Remove-Item -Force -ErrorAction SilentlyContinue
}

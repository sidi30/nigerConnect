#Requires -Version 5.1
<#
  Réveille l'atelier d'animation à l'ouverture d'une session Claude Code.

  Branché sur le hook SessionStart (.claude/settings.local.json). Il ne rédige
  rien lui-même : il demande simplement à la tâche planifiée de partir
  maintenant, puis rend la main tout de suite. Ouvrir Claude ne doit jamais
  attendre l'atelier.

  Deux gardes, et les deux sont nécessaires :

  1. ANTI-RÉCURSION. L'atelier lance lui-même `claude -p`, dont la session
     déclenche ce hook à son tour. Sans garde, ouvrir Claude une fois lancerait
     une chaîne d'ateliers. L'atelier pose NIGERCONNECT_ATELIER_ENFANT=1 dans
     l'environnement qu'il transmet à Claude ; on sort immédiatement quand on
     la voit.

  2. ANTI-RAFALE. Une session Claude s'ouvre et se ferme souvent plusieurs fois
     dans la même heure. Sans délai de garde, chaque ouverture relancerait un
     lot de rédaction. On ne repart que si la dernière exécution date de plus
     de 25 minutes — juste en dessous des 30 minutes de la tâche planifiée,
     pour que le hook comble les trous sans doubler le rythme.

  Le recouvrement de deux ateliers reste de toute façon impossible : la tâche
  est enregistrée avec -MultipleInstances IgnoreNew, donc un second départ est
  refusé par Windows tant que le premier tourne.

  Le hook reçoit du JSON sur l'entrée standard ; on ne s'en sert pas.
#>

$ErrorActionPreference = 'SilentlyContinue'

$cooldownMinutes = 25
$taskName = 'NigerConnect-Atelier'
$repo = Split-Path -Parent $PSScriptRoot
$health = Join-Path $repo 'logs\atelier-derniere-execution.txt'

# 1. Garde anti-récursion.
if ($env:NIGERCONNECT_ATELIER_ENFANT -eq '1') { exit 0 }

# 2. Garde anti-rafale — sur la date du FICHIER, pas sur son contenu : il est
#    réécrit à chaque fin d'exécution, réussie ou non, donc sa date de
#    modification est la trace la plus fiable du dernier passage.
if (Test-Path $health) {
  $age = (Get-Date) - (Get-Item $health).LastWriteTime
  if ($age.TotalMinutes -lt $cooldownMinutes) { exit 0 }
}

# La tâche existe-t-elle ? Si elle n'a jamais été enregistrée, on se tait :
# un hook qui hurle à chaque ouverture de session est un hook qu'on désactive.
if (-not (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) { exit 0 }

# Départ immédiat, sans attendre la fin.
Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

exit 0

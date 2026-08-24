# Enregistre (ou réenregistre) la tâche planifiée de l'atelier d'animation.
#
# À lancer UNE FOIS, dans une console PowerShell ADMINISTRATEUR :
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-atelier-task.ps1
#
# Pourquoi un script séparé : `Register-ScheduledTask` exige l'élévation, que
# les sessions non administrateur n'ont pas. Le reste de l'atelier n'en a jamais
# besoin — seule cette inscription initiale.
#
# Ce que la tâche fait : toutes les 30 minutes, et à chaque ouverture de session,
# elle lance `animation-atelier.ps1`, qui rédige les réponses et les
# publications en attente. Le serveur publie de son côté, poste allumé ou non.

#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$ps1 = Join-Path $PSScriptRoot 'animation-atelier.ps1'
if (-not (Test-Path $ps1)) { throw "Lanceur introuvable : $ps1" }

$taskName = 'NigerConnect-Atelier'

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$ps1`"" `
  -WorkingDirectory $repo

# Deux déclencheurs, et les deux comptent :
#   - toutes les 30 min tant que le poste tourne ;
#   - à l'ouverture de session, pour repartir immédiatement après une extinction
#     plutôt que d'attendre le prochain créneau.
$every30 = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
  -RepetitionInterval (New-TimeSpan -Minutes 30)
$atLogon = New-ScheduledTaskTrigger -AtLogOn

# -StartWhenAvailable : un créneau manqué (poste éteint) est rattrapé au
#   démarrage suivant, au lieu d'être perdu.
# -MultipleInstances IgnoreNew : deux ateliers simultanés rédigeraient le même
#   lot ; le second est simplement ignoré.
# -ExecutionTimeLimit : une session bloquée est tuée plutôt que de bloquer
#   toutes les suivantes.
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RunOnlyIfNetworkAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 20) `
  -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries

Register-ScheduledTask -TaskName $taskName -Action $action `
  -Trigger $every30, $atLogon -Settings $settings -Force | Out-Null

# ── Répétition INFINIE, et vérifiée ────────────────────────────────────────
# `-RepetitionInterval` sans `-RepetitionDuration` ne donne PAS toujours une
# répétition sans fin : selon la build, le Planificateur y met une durée d'un
# jour. La tâche tournerait aujourd'hui et s'arrêterait demain sans le dire —
# précisément le genre de panne muette qui a déjà coûté trois jours de silence
# aux comptes d'animation. On force la durée à vide (= indéfiniment), puis on
# relit ce que le Planificateur a réellement retenu.
$task = Get-ScheduledTask -TaskName $taskName
$repeating = $task.Triggers | Where-Object { $_.Repetition -and $_.Repetition.Interval }
if (-not $repeating) { throw "Aucun déclencheur répétitif enregistré — la tâche ne tournerait qu'une fois." }
if ($repeating.Repetition.Duration) {
  $repeating.Repetition.Duration = ''
  Set-ScheduledTask -TaskName $taskName -Trigger $task.Triggers | Out-Null
}

# Contrôle final : on n'annonce « enregistrée » que si c'est vrai.
$check = (Get-ScheduledTask -TaskName $taskName).Triggers |
  Where-Object { $_.Repetition -and $_.Repetition.Interval } | Select-Object -First 1
if ($check.Repetition.Interval -ne 'PT30M') {
  throw "Intervalle inattendu : $($check.Repetition.Interval) au lieu de PT30M."
}
if ($check.Repetition.Duration) {
  throw "Répétition bornée à $($check.Repetition.Duration) : elle s'arrêtera toute seule. Corriger dans le Planificateur (onglet Déclencheurs → « indéfiniment »)."
}

Write-Output "Tâche « $taskName » enregistrée — répétition toutes les 30 min, sans fin."
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State | Format-List
Get-ScheduledTaskInfo -TaskName $taskName |
  Select-Object LastRunTime, LastTaskResult, NextRunTime | Format-List

Write-Output ''
Write-Output 'Vérifier après la prochaine exécution :'
Write-Output "  Get-Content '$repo\logs\atelier-derniere-execution.txt'"
Write-Output '  → « OK <date> » attendu. « ECHEC … » signale la cause.'

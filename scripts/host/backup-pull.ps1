<#
    backup-pull.ps1 — rapatrie sur ce PC les sauvegardes chiffrées du VPS.

    C'est le PC qui TIRE. Le serveur ne connaît pas ce poste, n'y a aucun accès,
    et ne détient que la clé PUBLIQUE age : il fabrique des archives qu'il est
    lui-même incapable de relire. Si le serveur tombe entre de mauvaises mains,
    les copies présentes ici restent hors d'atteinte.

    Déroulé d'une passe :
      1. lance /opt/ops/backup-prepare.sh sur le VPS
      2. rapatrie le dossier produit
      3. vérifie chaque empreinte SHA-256 AVANT de toucher au serveur
      4. efface la copie distante seulement une fois l'intégrité prouvée
      5. applique la rétention locale et note la réussite

    Restauration : voir RESTAURATION.md. La clé privée est dans
    C:\Users\ramzi\.secrets\vps-backup-age.key — sans elle, rien n'est lisible.
#>

[CmdletBinding()]
param(
    [string]$Destination = 'C:\Backups\vps',
    [string]$VpsHost     = 'root@46.224.193.109',
    # Clé PUBLIQUE age : elle ne chiffre que dans un sens, sa divulgation est
    # sans conséquence. La clé privée correspondante n'est jamais lue ici.
    [string]$Recipient   = 'age1ac6v2ud6mnh452p9u77zaqlxs3yv29j8s4n50kzzp6m0vtruy48qs2wage',
    # Au-delà, une bannière apparaît sur le Bureau. Une sauvegarde silencieuse
    # qui ne tourne plus est pire que pas de sauvegarde du tout : elle rassure.
    [int]$AlerteApresHeures = 48,
    [switch]$SansRetention
)

$ErrorActionPreference = 'Stop'

$LogFile     = Join-Path $Destination 'backup.log'
$SuccessFile = Join-Path $Destination 'DERNIERE-REUSSITE.txt'
$LockFile    = Join-Path $Destination '.lock'
$AlertFile   = Join-Path ([Environment]::GetFolderPath('Desktop')) 'SAUVEGARDE-VPS-EN-RETARD.txt'

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = '{0}  {1,-5} {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Write-Host $line
    try { Add-Content -Path $LogFile -Value $line -Encoding utf8 } catch { }
}

function Invoke-Retention {
    <#
        Rotation grand-pere / pere / fils. Tout garder est simple mais finit par
        saturer ; ne garder que les recentes prive du recul necessaire quand une
        corruption passe inapercue plusieurs semaines.

          - moins de 14 jours  : tout
          - 14 jours a 8 sem.  : la plus recente de chaque semaine
          - 8 sem. a 12 mois   : la plus recente de chaque mois
          - au-dela            : suppression

        Environ 34 instantanes, soit quelques Go pour 181 Mo par passe.
    #>
    param([string]$Racine)

    $maintenant = Get-Date
    $dossiers = Get-ChildItem $Racine -Directory |
        Where-Object { $_.Name -match '^\d{8}-\d{6}$' } |
        ForEach-Object {
            $d = [datetime]::ParseExact($_.Name, 'yyyyMMdd-HHmmss', $null)
            [pscustomobject]@{ Dossier = $_; Date = $d; Age = ($maintenant - $d).TotalDays }
        } | Sort-Object Date -Descending

    $aGarder = New-Object System.Collections.Generic.HashSet[string]
    $cal = [System.Globalization.CultureInfo]::InvariantCulture.Calendar

    foreach ($f in $dossiers) { if ($f.Age -lt 14) { [void]$aGarder.Add($f.Dossier.Name) } }

    # Une entree par semaine, puis une par mois : la liste etant triee du plus
    # recent au plus ancien, la premiere vue de chaque periode est la bonne.
    $semainesVues = @{}
    foreach ($f in $dossiers | Where-Object { $_.Age -ge 14 -and $_.Age -lt 56 }) {
        $cle = '{0}-{1}' -f $f.Date.Year, $cal.GetWeekOfYear($f.Date, 'FirstFourDayWeek', 'Monday')
        if (-not $semainesVues.ContainsKey($cle)) {
            $semainesVues[$cle] = $true
            [void]$aGarder.Add($f.Dossier.Name)
        }
    }
    $moisVus = @{}
    foreach ($f in $dossiers | Where-Object { $_.Age -ge 56 -and $_.Age -lt 365 }) {
        $cle = '{0}-{1:D2}' -f $f.Date.Year, $f.Date.Month
        if (-not $moisVus.ContainsKey($cle)) {
            $moisVus[$cle] = $true
            [void]$aGarder.Add($f.Dossier.Name)
        }
    }

    $supprimes = 0
    foreach ($f in $dossiers) {
        if ($aGarder.Contains($f.Dossier.Name)) { continue }
        Remove-Item $f.Dossier.FullName -Recurse -Force
        $supprimes++
    }
    Write-Log ('Retention : {0} instantane(s) conserve(s), {1} supprime(s)' -f $aGarder.Count, $supprimes)
}

if (-not (Test-Path $Destination)) { New-Item -ItemType Directory -Path $Destination -Force | Out-Null }

# Le journal tourne tout seul : personne ne va purger un fichier qu'il ne
# regarde jamais.
if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 5MB)) {
    Move-Item $LogFile "$LogFile.1" -Force
}

# Verrou : le rattrapage au démarrage et l'horaire quotidien peuvent se
# déclencher coup sur coup.
if (Test-Path $LockFile) {
    $age = (Get-Date) - (Get-Item $LockFile).LastWriteTime
    if ($age.TotalHours -lt 6) {
        Write-Log "Une passe est deja en cours (verrou de $([int]$age.TotalMinutes) min) - abandon" 'WARN'
        exit 0
    }
    Write-Log "Verrou perime de $([int]$age.TotalHours) h - ignore" 'WARN'
}
Set-Content -Path $LockFile -Value $PID -Encoding utf8

$snapshotDir = $null
$incomplet   = $false

try {
    Write-Log '=========================================================='
    Write-Log 'Sauvegarde VPS - debut'

    # --- 1. fabrication cote serveur -------------------------------------
    Write-Log 'Preparation des archives chiffrees sur le VPS...'
    $sortie = & ssh -o BatchMode=yes -o ConnectTimeout=20 $VpsHost "/opt/ops/backup-prepare.sh $Recipient"
    $codePrepare = $LASTEXITCODE
    if ($null -eq $sortie -or $sortie.Count -eq 0) {
        throw "Le VPS n'a rien renvoye (ssh injoignable ou script absent)"
    }
    # Le script n'ecrit que le chemin sur stdout, ses traces vont sur stderr.
    $remoteDir = ($sortie | Select-Object -Last 1).Trim()
    if ($remoteDir -notmatch '^/opt/backups/outbox/\d{8}-\d{6}$') {
        throw "Chemin distant inattendu : '$remoteDir'"
    }
    if ($codePrepare -ne 0) {
        # On rapatrie quand meme : une sauvegarde partielle vaut mieux que rien,
        # mais elle ne comptera pas comme une reussite.
        $incomplet = $true
        Write-Log "Le VPS signale des echecs (code $codePrepare) - rapatriement en mode INCOMPLET" 'WARN'
    }
    $stamp = Split-Path $remoteDir -Leaf
    Write-Log "Archives pretes : $remoteDir"

    # --- 2. rapatriement --------------------------------------------------
    $snapshotDir = Join-Path $Destination $stamp
    if (Test-Path $snapshotDir) { Remove-Item $snapshotDir -Recurse -Force }
    Write-Log "Transfert vers $snapshotDir ..."
    & scp -r -q -o BatchMode=yes -o ConnectTimeout=20 "${VpsHost}:$remoteDir" $Destination
    if ($LASTEXITCODE -ne 0) { throw "Echec du transfert scp (code $LASTEXITCODE)" }
    if (-not (Test-Path $snapshotDir)) { throw "Dossier absent apres transfert : $snapshotDir" }

    # --- 3. verification d'integrite --------------------------------------
    # Avant d'effacer quoi que ce soit sur le serveur. C'est le seul moment ou
    # les deux copies coexistent : autant s'en servir.
    $sumsFile = Join-Path $snapshotDir 'SHA256SUMS'
    if (-not (Test-Path $sumsFile)) { throw 'Manifeste SHA256SUMS absent' }

    $verifies = 0
    foreach ($ligne in Get-Content $sumsFile) {
        if ($ligne -notmatch '^([0-9a-f]{64})\s+\.?/?(.+)$') { continue }
        $attendu = $Matches[1]
        $fichier = Join-Path $snapshotDir $Matches[2].Trim()
        if (-not (Test-Path $fichier)) { throw "Fichier manquant apres transfert : $($Matches[2])" }
        $obtenu = (Get-FileHash -Path $fichier -Algorithm SHA256).Hash.ToLower()
        if ($obtenu -ne $attendu) { throw "Empreinte incorrecte : $($Matches[2])" }
        $verifies++
    }
    if ($verifies -eq 0) { throw 'Aucun fichier verifie - manifeste vide' }

    $taille = (Get-ChildItem $snapshotDir -File | Measure-Object -Property Length -Sum).Sum
    Write-Log ('Integrite confirmee : {0} archives, {1:N1} Mo' -f $verifies, ($taille / 1MB))

    # --- 4. effacement de la copie distante -------------------------------
    & ssh -o BatchMode=yes $VpsHost "rm -rf '$remoteDir'"
    if ($LASTEXITCODE -eq 0) { Write-Log 'Copie distante effacee' }
    else { Write-Log 'Copie distante non effacee (sans gravite, purge auto a 2 jours)' 'WARN' }

    # --- 5. retention -----------------------------------------------------
    if (-not $SansRetention) { Invoke-Retention -Racine $Destination }

    if ($incomplet) {
        New-Item -ItemType File -Path (Join-Path $snapshotDir 'INCOMPLET') -Force | Out-Null
        Write-Log 'Passe terminee en mode INCOMPLET - la date de reussite reste inchangee' 'WARN'
    }
    else {
        Set-Content -Path $SuccessFile -Value (Get-Date -Format 'o') -Encoding utf8
        if (Test-Path $AlertFile) { Remove-Item $AlertFile -Force }
        Write-Log 'Sauvegarde reussie'
    }
}
catch {
    Write-Log "ECHEC : $($_.Exception.Message)" 'ERROR'
    if ($null -ne $snapshotDir -and (Test-Path $snapshotDir)) {
        # Un dossier a moitie transfere ressemble a une sauvegarde valide. On
        # le marque plutot que de le laisser mentir.
        New-Item -ItemType File -Path (Join-Path $snapshotDir 'ECHEC') -Force | Out-Null
    }
}
finally {
    if (Test-Path $LockFile) { Remove-Item $LockFile -Force }

    # Banniere sur le Bureau si la derniere REUSSITE date trop. Le test est ici,
    # dans le finally, pour qu'il se declenche aussi quand la passe a echoue.
    $derniere = $null
    if (Test-Path $SuccessFile) {
        try { $derniere = [datetime]::Parse((Get-Content $SuccessFile -Raw).Trim()) } catch { }
    }
    $retard = $null -eq $derniere -or ((Get-Date) - $derniere).TotalHours -gt $AlerteApresHeures
    if ($retard) {
        $quand = if ($null -eq $derniere) { 'jamais' } else { $derniere.ToString('yyyy-MM-dd HH:mm') }
        $texte = @(
            'SAUVEGARDE DU VPS EN RETARD',
            '',
            "Derniere sauvegarde reussie : $quand",
            "Seuil d'alerte : $AlerteApresHeures heures",
            '',
            "Journal : $LogFile",
            'Relancer a la main :',
            "  powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`"",
            '',
            'Ce fichier disparait tout seul des qu''une sauvegarde reussit.'
        ) -join [Environment]::NewLine
        Set-Content -Path $AlertFile -Value $texte -Encoding utf8
        Write-Log "Derniere reussite : $quand - banniere posee sur le Bureau" 'WARN'
    }
    Write-Log 'Sauvegarde VPS - fin'
}

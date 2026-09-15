param(
    [Parameter(Mandatory=$true)]
    [string]$ProjectRoot
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem

[System.Windows.Forms.Application]::EnableVisualStyles()

function Show-Error([string]$Message) {
    [System.Windows.Forms.MessageBox]::Show(
        $Message,
        'BU International Center - Template Manager',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
}

function Show-Warning([string]$Message) {
    [System.Windows.Forms.MessageBox]::Show(
        $Message,
        'BU International Center - Template Manager',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    ) | Out-Null
}

function Get-FullPathSafe([string]$PathValue) {
    return [System.IO.Path]::GetFullPath($PathValue)
}

function Test-Docx([string]$PathValue) {
    if (-not (Test-Path -LiteralPath $PathValue -PathType Leaf)) {
        throw 'The selected file does not exist.'
    }
    if ([System.IO.Path]::GetExtension($PathValue).ToLowerInvariant() -ne '.docx') {
        throw 'Please select a Microsoft Word .docx file.'
    }
    if ((Get-Item -LiteralPath $PathValue).Length -lt 1024) {
        throw 'The selected DOCX file is unexpectedly small and may be damaged.'
    }

    $archive = $null
    try {
        $archive = [System.IO.Compression.ZipFile]::OpenRead($PathValue)
        $names = @($archive.Entries | ForEach-Object { $_.FullName })
        if ($names -notcontains '[Content_Types].xml' -or $names -notcontains 'word/document.xml') {
            throw 'The selected file is not a valid Word DOCX package.'
        }
    }
    catch {
        throw ('The selected DOCX could not be opened: ' + $_.Exception.Message)
    }
    finally {
        if ($null -ne $archive) { $archive.Dispose() }
    }
}

$root = Get-FullPathSafe $ProjectRoot
$templatesDir = Join-Path $root 'templates'
$jsPath = Join-Path $root 'data\letter-templates.js'

if (-not (Test-Path -LiteralPath $templatesDir -PathType Container) -or -not (Test-Path -LiteralPath $jsPath -PathType Leaf)) {
    Show-Error "The workspace structure is incomplete.`n`nExpected:`n$templatesDir`n$jsPath`n`nPlease extract the complete workspace package and try again."
    exit 1
}

$slots = @(
    [PSCustomObject]@{ Label='Bachelor Degree No IEN'; Key='bachelor_no_ien'; File='Letter_Bachelor_Degree_No_IEN.docx' },
    [PSCustomObject]@{ Label='Bachelor Degree';        Key='bachelor';        File='Letter_Bachelor_Degree.docx' },
    [PSCustomObject]@{ Label='Current No IEN';          Key='current_no_ien';  File='Letter_Current_No_IEN.docx' },
    [PSCustomObject]@{ Label='Exchange Bachelor';      Key='exchange';        File='Letter_Exchange_Bachelor.docx' },
    [PSCustomObject]@{ Label='Master Degree';           Key='master';          File='Letter_Master_Degree.docx' },
    [PSCustomObject]@{ Label='Doctor Degree';           Key='doctor';          File='Letter_Doctor_Degree.docx' }
)

# Keep all file-system paths in an object attached to the Replace button.
# WinForms event handlers can execute in a different PowerShell scope, so relying
# on ordinary local variables here can make a valid path appear empty at click time.
$context = [PSCustomObject]@{
    Root = $root
    TemplatesDir = $templatesDir
    JsPath = $jsPath
    Slots = $slots
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'BU International Center - Word Template Manager'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(690, 405)
$form.MinimumSize = New-Object System.Drawing.Size(690, 405)
$form.MaximizeBox = $false
$form.FormBorderStyle = 'FixedDialog'
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)

$title = New-Object System.Windows.Forms.Label
$title.Text = 'Replace a Word template'
$title.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 17)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(26, 22)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = 'Choose which template slot to replace, then select your updated .docx file.'
$subtitle.AutoSize = $true
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(85,85,85)
$subtitle.Location = New-Object System.Drawing.Point(29, 59)
$form.Controls.Add($subtitle)

$slotLabel = New-Object System.Windows.Forms.Label
$slotLabel.Text = 'Template to replace'
$slotLabel.AutoSize = $true
$slotLabel.Location = New-Object System.Drawing.Point(29, 101)
$form.Controls.Add($slotLabel)

$slotCombo = New-Object System.Windows.Forms.ComboBox
$slotCombo.DropDownStyle = 'DropDownList'
$slotCombo.Location = New-Object System.Drawing.Point(32, 125)
$slotCombo.Size = New-Object System.Drawing.Size(615, 30)
foreach ($slot in $slots) { [void]$slotCombo.Items.Add($slot.Label) }
$slotCombo.SelectedIndex = 1
$form.Controls.Add($slotCombo)

$fileLabel = New-Object System.Windows.Forms.Label
$fileLabel.Text = 'Updated Word file'
$fileLabel.AutoSize = $true
$fileLabel.Location = New-Object System.Drawing.Point(29, 174)
$form.Controls.Add($fileLabel)

$fileText = New-Object System.Windows.Forms.TextBox
$fileText.Location = New-Object System.Drawing.Point(32, 198)
$fileText.Size = New-Object System.Drawing.Size(505, 29)
$fileText.ReadOnly = $true
$form.Controls.Add($fileText)

$browseButton = New-Object System.Windows.Forms.Button
$browseButton.Text = 'Browse...'
$browseButton.Location = New-Object System.Drawing.Point(548, 196)
$browseButton.Size = New-Object System.Drawing.Size(99, 33)
$form.Controls.Add($browseButton)

$infoBox = New-Object System.Windows.Forms.Label
$infoBox.Text = "Safety: the current DOCX and letter-templates.js are backed up automatically before replacement.`nThe tool then updates both the /templates file and the embedded template used by the website."
$infoBox.Location = New-Object System.Drawing.Point(32, 246)
$infoBox.Size = New-Object System.Drawing.Size(615, 55)
$infoBox.ForeColor = [System.Drawing.Color]::FromArgb(75,75,75)
$form.Controls.Add($infoBox)

$cancelButton = New-Object System.Windows.Forms.Button
$cancelButton.Text = 'Cancel'
$cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$cancelButton.Location = New-Object System.Drawing.Point(438, 317)
$cancelButton.Size = New-Object System.Drawing.Size(95, 36)
$form.Controls.Add($cancelButton)
$form.CancelButton = $cancelButton

$replaceButton = New-Object System.Windows.Forms.Button
$replaceButton.Text = 'Replace Template'
$replaceButton.Location = New-Object System.Drawing.Point(542, 317)
$replaceButton.Size = New-Object System.Drawing.Size(105, 36)
$replaceButton.Enabled = $false
$replaceButton.Tag = $context
$form.Controls.Add($replaceButton)
$form.AcceptButton = $replaceButton

$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Select updated Word template'
$dialog.Filter = 'Word documents (*.docx)|*.docx'
$dialog.Multiselect = $false
$dialog.CheckFileExists = $true

$browseButton.Add_Click({
    if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {
        $fileText.Text = $dialog.FileName
        $replaceButton.Enabled = $true
    }
})

$replaceButton.Add_Click({
    param($sender, $eventArgs)

    $ctx = $sender.Tag
    if ($null -eq $ctx -or [string]::IsNullOrWhiteSpace([string]$ctx.Root) -or [string]::IsNullOrWhiteSpace([string]$ctx.JsPath)) {
        Show-Error 'Template Manager lost its workspace path information. Please close this window and run Update Word Template.bat again.'
        return
    }

    $rootNow = [string]$ctx.Root
    $templatesDirNow = [string]$ctx.TemplatesDir
    $jsPathNow = [string]$ctx.JsPath
    $slotsNow = @($ctx.Slots)

    $source = $fileText.Text
    if ([string]::IsNullOrWhiteSpace($source)) {
        Show-Warning 'Please select an updated .docx file first.'
        return
    }

    try {
        Test-Docx $source
    }
    catch {
        Show-Error $_.Exception.Message
        return
    }

    $slot = $slotsNow[$slotCombo.SelectedIndex]
    $target = Join-Path $templatesDirNow $slot.File

    $confirm = [System.Windows.Forms.MessageBox]::Show(
        "Replace:`n$($slot.Label)`n`nWith:`n$source`n`nA backup of the current template will be created automatically.",
        'Confirm template replacement',
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Question
    )
    if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) { return }

    $timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    $backupDir = Join-Path $rootNow ("template-backups\" + $timestamp)
    $docxBackup = Join-Path $backupDir $slot.File
    $jsBackup = Join-Path $backupDir 'letter-templates.js'

    try {
        if (-not (Test-Path -LiteralPath $jsPathNow -PathType Leaf)) { throw "Embedded template file was not found: $jsPathNow" }
        $jsText = [System.IO.File]::ReadAllText($jsPathNow)

        $escapedKey = [regex]::Escape($slot.Key)
        $escapedLabel = [regex]::Escape($slot.Label)
        $escapedFile = [regex]::Escape($slot.File)
        $pattern = '(?s)(?<prefix>"' + $escapedKey + '"\s*:\s*\{\s*label:\s*"' + $escapedLabel + '"\s*,\s*filename:\s*"' + $escapedFile + '"\s*,\s*base64:\s*")(?<data>[^"]*)(?<suffix>"\s*\})'
        $match = [regex]::Match($jsText, $pattern)
        if (-not $match.Success) {
            throw "Could not find the '$($slot.Label)' entry inside data\letter-templates.js. No files were changed."
        }

        New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
        if (Test-Path -LiteralPath $target) {
            Copy-Item -LiteralPath $target -Destination $docxBackup -Force
        }
        Copy-Item -LiteralPath $jsPathNow -Destination $jsBackup -Force

        $sourceFull = Get-FullPathSafe $source
        $targetFull = Get-FullPathSafe $target
        if (-not [string]::Equals($sourceFull, $targetFull, [System.StringComparison]::OrdinalIgnoreCase)) {
            Copy-Item -LiteralPath $source -Destination $target -Force
        }

        $newBytes = [System.IO.File]::ReadAllBytes($target)
        $newBase64 = [System.Convert]::ToBase64String($newBytes)
        $dataGroup = $match.Groups['data']
        $newJsText = $jsText.Substring(0, $dataGroup.Index) + $newBase64 + $jsText.Substring($dataGroup.Index + $dataGroup.Length)
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($jsPathNow, $newJsText, $utf8NoBom)

        # Verify the embedded template decodes to the exact same bytes as the DOCX in /templates.
        $verifyText = [System.IO.File]::ReadAllText($jsPathNow)
        $verifyMatch = [regex]::Match($verifyText, $pattern)
        if (-not $verifyMatch.Success) { throw 'Verification failed: the updated template entry could not be read.' }
        $embeddedBytes = [System.Convert]::FromBase64String($verifyMatch.Groups['data'].Value)
        if ($embeddedBytes.Length -ne $newBytes.Length) { throw 'Verification failed: embedded template size does not match the selected DOCX.' }
        for ($i=0; $i -lt $newBytes.Length; $i++) {
            if ($embeddedBytes[$i] -ne $newBytes[$i]) { throw 'Verification failed: embedded template bytes do not match the selected DOCX.' }
        }

        [System.Windows.Forms.MessageBox]::Show(
            "Template replaced successfully.`n`nUpdated: $($slot.Label)`nBackup: $backupDir`n`nIf the workspace is already open in Chrome or Edge, refresh the page before generating the next document.",
            'Template updated',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null

        $fileText.Clear()
        $replaceButton.Enabled = $false
    }
    catch {
        # Best-effort rollback if a backup was already created.
        try {
            if (Test-Path -LiteralPath $docxBackup) { Copy-Item -LiteralPath $docxBackup -Destination $target -Force }
            if (Test-Path -LiteralPath $jsBackup) { Copy-Item -LiteralPath $jsBackup -Destination $jsPathNow -Force }
        } catch {}
        Show-Error ("Template replacement failed. The previous files were restored when possible.`n`n" + $_.Exception.Message)
    }
})

[void]$form.ShowDialog()

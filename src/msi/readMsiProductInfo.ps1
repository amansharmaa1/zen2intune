# Reads selected rows of an MSI file's Property table READ-ONLY via the
# Windows Installer automation interface and prints them as one JSON object
# on stdout. Invoked by src/msi/readMsiProductInfo.js - not meant to be run
# by hand. The MSI path is passed via the ZEN2INTUNE_MSI_PATH environment
# variable (not argv) to avoid any quoting/injection handling here.
#
# API verified against Microsoft Learn on 2026-07-05 (not recalled from memory):
#   Installer.OpenDatabase, msiOpenDatabaseModeReadOnly = 0:
#     https://learn.microsoft.com/windows/win32/msi/installer-opendatabase
#   Database.OpenView:
#     https://learn.microsoft.com/windows/win32/msi/database-openview
#   View.Execute / View.Fetch (Fetch returns null when no rows remain):
#     https://learn.microsoft.com/windows/win32/msi/view-execute
#     https://learn.microsoft.com/windows/win32/msi/view-fetch
#   Record.StringData:
#     https://learn.microsoft.com/windows/win32/msi/record-stringdata

$ErrorActionPreference = 'Stop'

$msiPath = $env:ZEN2INTUNE_MSI_PATH
if (-not $msiPath) {
  [Console]::Error.WriteLine('ZEN2INTUNE_MSI_PATH environment variable is not set')
  exit 2
}
if (-not (Test-Path -LiteralPath $msiPath)) {
  [Console]::Error.WriteLine("MSI file not found: $msiPath")
  exit 3
}

try {
  $installer = New-Object -ComObject WindowsInstaller.Installer
} catch {
  [Console]::Error.WriteLine('WindowsInstaller.Installer COM object unavailable: ' + $_.Exception.Message)
  exit 4
}

try {
  # 0 = msiOpenDatabaseModeReadOnly - opens the database read-only, no
  # persistent changes (see doc URL in the header).
  $db = $installer.GetType().InvokeMember('OpenDatabase', 'InvokeMethod', $null, $installer, @($msiPath, 0))
  $view = $db.GetType().InvokeMember('OpenView', 'InvokeMethod', $null, $db, @('SELECT Property, Value FROM Property'))
  $view.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $view, $null) | Out-Null

  $props = @{}
  while ($true) {
    $record = $view.GetType().InvokeMember('Fetch', 'InvokeMethod', $null, $view, $null)
    if ($null -eq $record) { break }
    $name = $record.GetType().InvokeMember('StringData', 'GetProperty', $null, $record, 1)
    $value = $record.GetType().InvokeMember('StringData', 'GetProperty', $null, $record, 2)
    $props[$name] = $value
  }
  $view.GetType().InvokeMember('Close', 'InvokeMethod', $null, $view, $null) | Out-Null

  $out = [ordered]@{
    productCode    = $props['ProductCode']
    productVersion = $props['ProductVersion']
    productName    = $props['ProductName']
    manufacturer   = $props['Manufacturer']
    upgradeCode    = $props['UpgradeCode']
    allUsers       = $props['ALLUSERS']
  }
  $out | ConvertTo-Json -Compress
  exit 0
} catch {
  [Console]::Error.WriteLine('Failed reading MSI Property table: ' + $_.Exception.Message)
  exit 5
}

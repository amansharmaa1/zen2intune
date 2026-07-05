# TEST HELPER - creates a minimal, entirely SYNTHETIC .msi database containing
# only a Property table with fake values, so tests never need a real installer
# binary. Invoked by test files; the output path arrives via the
# ZEN2INTUNE_TEST_MSI_PATH environment variable, and the property rows to
# insert arrive as a JSON object via ZEN2INTUNE_TEST_MSI_PROPS.
#
# API verified against Microsoft Learn on 2026-07-05:
#   Installer.OpenDatabase, msiOpenDatabaseModeCreate = 3 (and the requirement
#   to call Database.Commit before release):
#     https://learn.microsoft.com/windows/win32/msi/installer-opendatabase
#   Database.OpenView / View.Execute:
#     https://learn.microsoft.com/windows/win32/msi/database-openview
#     https://learn.microsoft.com/windows/win32/msi/view-execute

$ErrorActionPreference = 'Stop'

$msiPath = $env:ZEN2INTUNE_TEST_MSI_PATH
if (-not $msiPath) {
  [Console]::Error.WriteLine('ZEN2INTUNE_TEST_MSI_PATH environment variable is not set')
  exit 2
}
$propsJson = $env:ZEN2INTUNE_TEST_MSI_PROPS
if (-not $propsJson) {
  [Console]::Error.WriteLine('ZEN2INTUNE_TEST_MSI_PROPS environment variable is not set')
  exit 2
}
$props = $propsJson | ConvertFrom-Json

function Invoke-MsiSql {
  param($Database, [string]$Sql)
  $view = $Database.GetType().InvokeMember('OpenView', 'InvokeMethod', $null, $Database, @($Sql))
  $view.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $view, $null) | Out-Null
  $view.GetType().InvokeMember('Close', 'InvokeMethod', $null, $view, $null) | Out-Null
}

try {
  $installer = New-Object -ComObject WindowsInstaller.Installer
} catch {
  [Console]::Error.WriteLine('WindowsInstaller.Installer COM object unavailable: ' + $_.Exception.Message)
  exit 4
}

try {
  # 3 = msiOpenDatabaseModeCreate (see doc URL in header)
  $db = $installer.GetType().InvokeMember('OpenDatabase', 'InvokeMethod', $null, $installer, @($msiPath, 3))

  Invoke-MsiSql $db 'CREATE TABLE `Property` (`Property` CHAR(72) NOT NULL, `Value` LONGCHAR NOT NULL LOCALIZABLE PRIMARY KEY `Property`)'

  foreach ($entry in $props.PSObject.Properties) {
    $name = $entry.Name -replace "'", ''
    $value = [string]$entry.Value -replace "'", ''
    Invoke-MsiSql $db ("INSERT INTO ``Property`` (``Property``, ``Value``) VALUES ('" + $name + "', '" + $value + "')")
  }

  $db.GetType().InvokeMember('Commit', 'InvokeMethod', $null, $db, $null) | Out-Null
  Write-Output 'OK'
  exit 0
} catch {
  [Console]::Error.WriteLine('Failed creating synthetic MSI: ' + $_.Exception.Message)
  exit 5
}

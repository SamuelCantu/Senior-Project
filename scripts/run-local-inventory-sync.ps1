# ListNexus local worker v2: import eBay paid orders before outbound eBay stock sync.
# Runs only while Next.js dev server and this terminal remain on.
# Replaces the v1 launcher we previously created; does not change teammate eBay code.
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envPath = Join-Path $projectRoot '.env.local'
if (-not (Test-Path $envPath)) { throw 'Missing .env.local' }
$secretLines = @(Get-Content $envPath | Where-Object { $_ -match '^\s*INVENTORY_SYNC_WORKER_SECRET\s*=' })
if ($secretLines.Count -ne 1) { throw 'Expected exactly one INVENTORY_SYNC_WORKER_SECRET in .env.local' }
$secret = (($secretLines[0] -split '=', 2)[1]).Trim().Trim('"').Trim("'")
if ($secret.Length -lt 32) { throw 'INVENTORY_SYNC_WORKER_SECRET must have at least 32 characters' }
Write-Host 'ListNexus eBay Production order + inventory worker started. Ctrl+C to stop.'
while ($true) {
  try {
    # IMPORTANT: Never run outbound stock correction when order ingestion failed.
    $orders = Invoke-RestMethod -Uri 'http://127.0.0.1:4000/api/ebay/production/orders-sync' `
      -Method Post -Headers @{ 'x-listnexus-sync-secret' = $secret } `
      -ContentType 'application/json' -Body '{}'
    Write-Host "$(Get-Date -Format 'HH:mm:ss') eBay orders:" $orders.action
    if ($orders.success -eq $true) {
      $stock = Invoke-RestMethod -Uri 'http://127.0.0.1:4000/api/inventory/sync/worker' `
        -Method Post -Headers @{ 'x-listnexus-sync-secret' = $secret } `
        -ContentType 'application/json' -Body '{}'
      Write-Host "$(Get-Date -Format 'HH:mm:ss') eBay quantity:" $stock.action
    } else {
      Write-Warning 'Order import not confirmed; outbound sync skipped.'
    }
  } catch {
    Write-Warning "$(Get-Date -Format 'HH:mm:ss') Order import or outbound worker unavailable/blocked; outbound sync skipped. Check Next.js terminal."
  }
  Start-Sleep -Seconds 60
}



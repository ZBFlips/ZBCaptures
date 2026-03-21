param(
  [int]$Port = 8080
)

$root = (Get-Location).Path
$listener = [System.Net.HttpListener]::new()
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)

try {
  $listener.Start()
} catch {
  Write-Error "Could not start the local server on $prefix. Try running PowerShell as a different user or choose another port."
  throw
}

Write-Host "Serving $root at $prefix"
Write-Host "Press Ctrl+C to stop."

function Get-ContentType([string]$path) {
  switch ([System.IO.Path]::GetExtension($path).ToLowerInvariant()) {
    ".html" { "text/html; charset=utf-8" }
    ".css" { "text/css; charset=utf-8" }
    ".js" { "text/javascript; charset=utf-8" }
    ".json" { "application/json; charset=utf-8" }
    ".png" { "image/png" }
    ".avif" { "image/avif" }
    ".jpg" { "image/jpeg" }
    ".jpeg" { "image/jpeg" }
    ".webp" { "image/webp" }
    ".gif" { "image/gif" }
    ".svg" { "image/svg+xml" }
    ".mp4" { "video/mp4" }
    ".mov" { "video/quicktime" }
    ".webm" { "video/webm" }
    default { "application/octet-stream" }
  }
}

function Read-RequestBody([System.Net.HttpListenerRequest]$request) {
  $reader = [System.IO.StreamReader]::new($request.InputStream, $request.ContentEncoding)
  try {
    return $reader.ReadToEnd()
  } finally {
    $reader.Dispose()
  }
}

function Send-JsonResponse([System.Net.HttpListenerContext]$context, [int]$statusCode, $payload) {
  $json = $payload | ConvertTo-Json -Depth 32
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $context.Response.ContentType = "application/json; charset=utf-8"
  $context.Response.StatusCode = $statusCode
  $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Get-UploadExtension($item) {
  $name = [string]$item.name
  if ($name -match '\.([a-z0-9]+)$') {
    return $matches[1].ToLowerInvariant()
  }

  $type = [string]$item.type
  if ($type -like "*jpeg*") { return "jpg" }
  if ($type -like "*png*") { return "png" }
  if ($type -like "*avif*") { return "avif" }
  if ($type -like "*webp*") { return "webp" }
  if ($type -like "*gif*") { return "gif" }
  if ($type -like "*mp4*") { return "mp4" }
  if ($type -like "*quicktime*") { return "mov" }
  if ($type -like "*webm*") { return "webm" }

  return "bin"
}

function Normalize-RelativePath([string]$path) {
  if ([string]::IsNullOrWhiteSpace($path)) {
    return ""
  }

  return ($path -replace '^[./\\]+', '').Replace('\', '/')
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $requestPath = $context.Request.Url.AbsolutePath.TrimStart("/")

    if ($requestPath -eq "__admin/save" -and $context.Request.HttpMethod -eq "POST") {
      try {
        $rawBody = Read-RequestBody $context.Request
        $payload = $rawBody | ConvertFrom-Json -Depth 32
        $writtenCount = 0

        foreach ($item in @($payload.media)) {
          if (-not $item) {
            continue
          }

          if ($item.generatedFiles) {
            foreach ($generated in @($item.generatedFiles)) {
              if (-not $generated -or [string]::IsNullOrWhiteSpace([string]$generated.path) -or [string]::IsNullOrWhiteSpace([string]$generated.data)) {
                continue
              }

              $generatedPath = Normalize-RelativePath ([string]$generated.path)
              $generatedAbsolutePath = Join-Path $root $generatedPath
              $generatedDirectory = Split-Path $generatedAbsolutePath -Parent
              if ($generatedDirectory -and -not (Test-Path $generatedDirectory)) {
                New-Item -ItemType Directory -Path $generatedDirectory -Force | Out-Null
              }

              $generatedBytes = [Convert]::FromBase64String([string]$generated.data)
              [System.IO.File]::WriteAllBytes($generatedAbsolutePath, $generatedBytes)
              $writtenCount += 1
            }

            continue
          }

          $extension = Get-UploadExtension $item
          $relativePath = Normalize-RelativePath ([string]$item.src)
          if ([string]::IsNullOrWhiteSpace($relativePath)) {
            $relativePath = "assets/uploads/$($item.id).$extension"
          }

          $absolutePath = Join-Path $root $relativePath
          $directory = Split-Path $absolutePath -Parent
          if ($directory -and -not (Test-Path $directory)) {
            New-Item -ItemType Directory -Path $directory -Force | Out-Null
          }

          if ($item.data) {
            $bytes = [Convert]::FromBase64String([string]$item.data)
            [System.IO.File]::WriteAllBytes($absolutePath, $bytes)
            $writtenCount += 1
          }
        }

        $siteData = [ordered]@{
          settings = $payload.settings
          services = $payload.services
          clientPortals = @($payload.clientPortals)
          media = @($payload.publicMedia)
          savedAt = (Get-Date).ToString("o")
        }

        $siteJson = $siteData | ConvertTo-Json -Depth 32
        $sitePath = Join-Path $root "content/site-data.json"
        $siteDirectory = Split-Path $sitePath -Parent
        if ($siteDirectory -and -not (Test-Path $siteDirectory)) {
          New-Item -ItemType Directory -Path $siteDirectory -Force | Out-Null
        }

        [System.IO.File]::WriteAllText(
          $sitePath,
          $siteJson,
          [System.Text.UTF8Encoding]::new($false)
        )

        Send-JsonResponse $context 200 @{
          ok = $true
          message = "Saved site files."
          mediaCount = $writtenCount
          savedAt = $siteData.savedAt
        }
      } catch {
        Send-JsonResponse $context 500 @{
          ok = $false
          error = $_.Exception.Message
        }
      } finally {
        $context.Response.OutputStream.Close()
      }

      continue
    }

    if ([string]::IsNullOrWhiteSpace($requestPath)) {
      $requestPath = "index.html"
    }

    $localPath = Join-Path $root $requestPath

    if (Test-Path $localPath -PathType Leaf) {
      $bytes = [System.IO.File]::ReadAllBytes($localPath)
      $context.Response.ContentType = Get-ContentType $localPath
      $context.Response.StatusCode = 200
      $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } elseif (Test-Path (Join-Path $root $requestPath) -PathType Container) {
      $indexPath = Join-Path $root (Join-Path $requestPath "index.html")
      if (Test-Path $indexPath) {
        $bytes = [System.IO.File]::ReadAllBytes($indexPath)
        $context.Response.ContentType = "text/html; charset=utf-8"
        $context.Response.StatusCode = 200
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $context.Response.StatusCode = 404
      }
    } else {
      $context.Response.StatusCode = 404
      $notFound = [System.Text.Encoding]::UTF8.GetBytes("Not found")
      $context.Response.OutputStream.Write($notFound, 0, $notFound.Length)
    }

    $context.Response.OutputStream.Close()
  }
} finally {
  $listener.Stop()
  $listener.Close()
}

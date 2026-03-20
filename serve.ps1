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

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $requestPath = $context.Request.Url.AbsolutePath.TrimStart("/")

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

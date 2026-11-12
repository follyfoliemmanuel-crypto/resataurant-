# Génère la voix off française du film Savora.
# Source de vérité du texte : scripts/motion/voiceover.json
# Sorties : motion/audio/voix-<id>.wav + motion/timing.json
#
# Usage : powershell -ExecutionPolicy Bypass -File scripts/motion/generate-voiceover.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
[System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::InvariantCulture

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$configPath = Join-Path $PSScriptRoot 'voiceover.json'
$outDir = Join-Path $root 'motion\audio'
$timingPath = Join-Path $root 'motion\timing.json'

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$config = Get-Content -Raw -Encoding UTF8 $configPath | ConvertFrom-Json

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Name -eq $config.voice }
if (-not $voice) {
  $voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'fr-FR' } | Select-Object -First 1
}
if (-not $voice) { throw "Aucune voix française installée sur cette machine." }
$synth.SelectVoice($voice.VoiceInfo.Name)

$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(44100, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

function ConvertTo-Ssml([string]$text, [int]$rate) {
  $escaped = [System.Security.SecurityElement]::Escape($text)
  $escaped = $escaped -replace '\|\|', '<break time="420ms"/>'
  return @"
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="fr-FR">
  <prosody rate="$rate">$escaped</prosody>
</speak>
"@
}

function Get-WavDuration([string]$path) {
  $bytes = [System.IO.File]::ReadAllBytes($path)
  $byteRate = [BitConverter]::ToInt32($bytes, 28)
  $offset = 12
  while ($offset -lt $bytes.Length - 8) {
    $chunkId = [System.Text.Encoding]::ASCII.GetString($bytes, $offset, 4)
    $chunkSize = [BitConverter]::ToInt32($bytes, $offset + 4)
    if ($chunkId -eq 'data') { return [math]::Round($chunkSize / $byteRate, 3) }
    $offset += 8 + $chunkSize + ($chunkSize % 2)
  }
  return 0
}

$breath = 0.75
$entries = @()
$cursor = 0.0
foreach ($scene in $config.scenes) {
  $file = Join-Path $outDir ("voix-{0}.wav" -f $scene.id)
  $synth.SetOutputToWaveFile($file, $format)
  $synth.SpeakSsml((ConvertTo-Ssml $scene.text $config.rate))
  $synth.SetOutputToNull()

  $duration = Get-WavDuration $file
  $entries += [pscustomobject]@{
    id = $scene.id
    voice = $duration
    start = [math]::Round($cursor, 3)
    scene = [math]::Round($duration + $breath, 3)
  }
  $cursor += $duration + $breath
  Write-Host ("  voix-{0}.wav  {1:0.00}s" -f $scene.id, $duration)
}

$payload = [pscustomobject]@{
  voice = $voice.VoiceInfo.Name
  generated = (Get-Date).ToString('yyyy-MM-dd')
  breath = $breath
  total = [math]::Round($cursor, 3)
  scenes = $entries
}

$json = $payload | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($timingPath, $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ("`nDurée totale voix off + respirations : {0:0.0}s" -f $cursor)
Write-Host "Timeline : motion/timing.json"

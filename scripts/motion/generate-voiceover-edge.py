"""Voix off du film Savora avec les voix neuronales Microsoft (edge-tts).

Bien plus naturel que la synthèse locale de Windows. Nécessite :
    py -m pip install --user edge-tts
et ffmpeg dans le PATH (ou FFMPEG_PATH).

Sorties : motion/audio/voix-<id>.wav + motion/timing.json

Usage :
    py scripts/motion/generate-voiceover-edge.py
    py scripts/motion/generate-voiceover-edge.py --voice fr-FR-DeniseNeural --rate=-4%
"""

import argparse
import asyncio
import json
import os
import shutil
import subprocess
import tempfile
import wave
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parents[2]
CONFIG = Path(__file__).with_name("voiceover.json")
AUDIO_DIR = ROOT / "motion" / "audio"
TIMING = ROOT / "motion" / "timing.json"
BREATH = 0.75


def find_ffmpeg() -> str:
    configured = os.environ.get("FFMPEG_PATH")
    if configured and Path(configured).exists():
        return configured
    found = shutil.which("ffmpeg")
    if found:
        return found
    packages = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
    if packages.exists():
        for candidate in packages.rglob("ffmpeg.exe"):
            return str(candidate)
    raise SystemExit("ffmpeg introuvable : ajoutez-le au PATH ou définissez FFMPEG_PATH.")


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as handle:
        return round(handle.getnframes() / handle.getframerate(), 3)


async def synthesize(scene: dict, voice: str, rate: str, ffmpeg: str) -> None:
    text = scene["text"].replace("||", " ").strip()
    mp3 = Path(tempfile.gettempdir()) / f"savora-voix-{scene['id']}.mp3"
    communicate = edge_tts.Communicate(text, voice=voice, rate=rate)
    await communicate.save(str(mp3))

    out = AUDIO_DIR / f"voix-{scene['id']}.wav"
    subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(mp3), "-ar", "44100", "-ac", "1", str(out)],
        check=True,
    )
    mp3.unlink(missing_ok=True)


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice", default="fr-FR-HenriNeural")
    parser.add_argument("--rate", default="-4%")
    args = parser.parse_args()

    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    ffmpeg = find_ffmpeg()

    entries = []
    cursor = 0.0
    for scene in config["scenes"]:
        await synthesize(scene, args.voice, args.rate, ffmpeg)
        duration = wav_duration(AUDIO_DIR / f"voix-{scene['id']}.wav")
        entries.append(
            {
                "id": scene["id"],
                "voice": duration,
                "start": round(cursor, 3),
                "scene": round(duration + BREATH, 3),
            }
        )
        cursor += duration + BREATH
        print(f"  voix-{scene['id']}.wav  {duration:.2f}s")

    payload = {
        "voice": args.voice,
        "generated": __import__("datetime").date.today().isoformat(),
        "breath": BREATH,
        "total": round(cursor, 3),
        "scenes": entries,
    }
    TIMING.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nDurée totale voix off + respirations : {cursor:.1f}s")
    print("Timeline : motion/timing.json")


if __name__ == "__main__":
    asyncio.run(main())

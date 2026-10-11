#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["simfile==2.1.1", "pydantic==2.11.3", "setuptools==75.8.0"]
# ///
# How to run:
#   uv run scripts/test-ssc-parser.py /absolute/path/to/music.wav
"""Compare real CLI exports with an independent SSC note and timing parser."""

from __future__ import annotations

import hashlib
import math
import os
import subprocess
import sys
from fractions import Fraction
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import ClassVar, Final

import simfile
from pydantic import BaseModel, ConfigDict
from simfile.notes import NoteData, NoteType
from simfile.timing import Beat, TimingData
from simfile.timing.engine import TimingEngine

ROOT: Final = Path(__file__).resolve().parent.parent
BINARY_OVERRIDE: Final = os.environ.get("PUMP_BINARY")
BINARY: Final = (
    Path(BINARY_OVERRIDE)
    if BINARY_OVERRIDE is not None
    else ROOT / "dist" / ("pump.exe" if sys.platform == "win32" else "pump")
).resolve()
SEED: Final = "00" * 32
TITLE: Final = r"Parser \ # : ; title"


class Model(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True)


class Note(Model):
    tick: int
    panel_mask: int
    hold_ticks: int


class Chart(Model):
    ticks_per_beat: int
    span_ticks: int
    notes: tuple[Note, ...]


class Generated(Model):
    candidate_id: tuple[int, ...]
    chart: Chart


class Ratio(Model):
    numerator: int
    denominator: int


class SignedRatio(Model):
    negative: bool
    magnitude: Ratio


class Frame(Model):
    tick: int
    song_time: SignedRatio


class Explanation(Model):
    generated: Generated
    schedule: tuple[Frame, ...]


def run(*arguments: str) -> str:
    """Drive the public CLI; failures preserve stderr in the raised exception."""
    return subprocess.run(
        [str(BINARY), "chart", *arguments, "--format", "json"],
        check=True,
        capture_output=True,
        text=True,
        timeout=120,
    ).stdout


def compare_export(export: Path, explanation: Explanation) -> None:
    """Compare parsed notes and elapsed times against the selected source chart."""
    song = simfile.open(str(export / "chart.ssc"), strict=True)
    assert song["TITLE"] == TITLE
    assert song["MUSIC"] == "music.wav"
    assert len(song.charts) == 1
    parsed_chart = song.charts[0]
    assert parsed_chart["STEPSTYPE"] == "pump-double"
    assert parsed_chart["DIFFICULTY"] == "Edit"
    chart = explanation.generated.chart
    expected: list[tuple[Fraction, int, NoteType]] = []
    for note in chart.notes:
        for panel in range(10):
            if note.panel_mask & (1 << panel):
                kind = NoteType.HOLD_HEAD if note.hold_ticks else NoteType.TAP
                expected.append((Fraction(note.tick, chart.ticks_per_beat), panel, kind))
                if note.hold_ticks:
                    end = Fraction(note.tick + note.hold_ticks, chart.ticks_per_beat)
                    expected.append((end, panel, NoteType.TAIL))
    actual = [(Fraction(note.beat), note.column, note.note_type) for note in NoteData(parsed_chart)]
    assert sorted(actual) == sorted(expected), (actual, expected)
    engine = TimingEngine(TimingData(song, parsed_chart))
    for frame in explanation.schedule:
        magnitude = frame.song_time.magnitude
        seconds = Fraction(magnitude.numerator, magnitude.denominator * 1_000_000)
        if frame.song_time.negative:
            seconds = -seconds
        parsed_time = engine.time_at(Beat(frame.tick, chart.ticks_per_beat))
        assert math.isclose(float(parsed_time), float(seconds), abs_tol=1e-9, rel_tol=0)


def main() -> None:
    """Export both history-conditioned candidates and reject invalid user input."""
    audio = Path(sys.argv[1]).resolve()
    with TemporaryDirectory(prefix="pump-ssc-parser-") as temporary:
        work = Path(temporary)
        bundle = str(work / "bundle")
        _ = run(
            "compile", str(ROOT / "dist/chart-author.component.wasm"),
            "--runtime", str(ROOT / "dist/chart-runtime.component.wasm"),
            "--music", str(ROOT / "dist/feedback/music.json"),
            "--contract", str(ROOT / "dist/feedback/contract.json"),
            "--audio", str(audio), "--out", bundle,
        )
        history: list[str] = []
        selected: set[str] = set()
        for index in range(2):
            explanation = Explanation.model_validate_json(
                run("explain", bundle, "--seed", SEED, *history),
            )
            candidate = bytes(explanation.generated.candidate_id).hex()
            selected.add(candidate)
            export = work / f"export-{index}"
            _ = run(
                "export-ssc", bundle, "--seed", SEED, *history,
                "--audio", str(audio), "--out", str(export),
                "--title", TITLE, "--artist", "Independent parser QA",
            )
            compare_export(export, explanation)
            assert (export / "music.wav").read_bytes() == audio.read_bytes()
            history = ["--history", candidate]
        assert len(selected) == 2
        rejected = work / "rejected"
        failure = subprocess.run(
            [str(BINARY), "chart", "export-ssc", bundle, "--seed", "bad",
             "--audio", str(audio), "--out", str(rejected), "--title", TITLE,
             "--artist", "QA"],
            check=False, capture_output=True, text=True, timeout=120,
        )
        assert failure.returncode != 0
        assert "seed" in failure.stderr
        assert not rejected.exists()
        print("Independent simfile 2.1.1: two candidates, hold endpoints, lanes, "
              + "tempo/offset times, metadata, audio and bad-input rejection passed.")
        print(f"Bound audio SHA-256: {hashlib.sha256(audio.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    main()

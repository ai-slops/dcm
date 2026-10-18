use std::fs;
use std::path::{Path, PathBuf};

use pump_chart::{Chart, Fraction, Music, Note, TempoSegment};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::chart_cli::ChartExportEditedSscArgs;

struct Fixture {
    _root: tempfile::TempDir,
    chart: PathBuf,
    music: PathBuf,
    audio: PathBuf,
    out: PathBuf,
}

fn fixture(chart: &Chart) -> anyhow::Result<Fixture> {
    let root = tempfile::tempdir()?;
    let chart_path = root.path().join("chart.json");
    let music_path = root.path().join("music.json");
    let audio_path = root.path().join("SOURCE.WAV");
    let out = root.path().join("export");
    let audio = b"edited chart audio";
    let music = Music {
        duration_ticks: chart.span_ticks,
        ticks_per_beat: chart.ticks_per_beat,
        offset_micros: 100_000,
        tempo: vec![TempoSegment {
            start_tick: 0,
            micros_per_beat: Fraction::new(500_000, 1)?,
        }],
        audio_sha256: Sha256::digest(audio).into(),
        reference_accents: Vec::new(),
    };
    fs::write(&chart_path, serde_json::to_vec(chart)?)?;
    fs::write(&music_path, serde_json::to_vec(&music)?)?;
    fs::write(&audio_path, audio)?;
    Ok(Fixture {
        _root: root,
        chart: chart_path,
        music: music_path,
        audio: audio_path,
        out,
    })
}

fn args(fixture: &Fixture) -> ChartExportEditedSscArgs {
    ChartExportEditedSscArgs {
        chart: fixture.chart.clone(),
        music: fixture.music.clone(),
        audio: fixture.audio.clone(),
        out: fixture.out.clone(),
        title: "Edited Title".to_owned(),
        artist: "Edited Artist".to_owned(),
    }
}

fn chart(notes: Vec<Note>) -> Chart {
    Chart {
        ticks_per_beat: 4,
        span_ticks: 32,
        notes,
    }
}

#[test]
fn export_normalizes_edited_notes_and_writes_uncertified_artifacts() -> anyhow::Result<()> {
    let fixture = fixture(&chart(vec![
        Note {
            tick: 4,
            panel_mask: 1 << 3,
            hold_ticks: 0,
        },
        Note {
            tick: 0,
            panel_mask: 1 << 1,
            hold_ticks: 16,
        },
        Note {
            tick: 4,
            panel_mask: 1 << 2,
            hold_ticks: 0,
        },
        Note {
            tick: 0,
            panel_mask: 1,
            hold_ticks: 16,
        },
    ]))?;

    let result = crate::newchart_edited_export::export(&args(&fixture))?;

    let mut names = fs::read_dir(&fixture.out)?
        .map(|entry| Ok(entry?.file_name()))
        .collect::<std::io::Result<Vec<_>>>()?;
    names.sort();
    assert_eq!(names, ["chart.ssc", "edited-export.json", "music.wav"]);
    assert_eq!(
        fs::read(fixture.out.join("music.wav"))?,
        b"edited chart audio"
    );
    let ssc_bytes = fs::read(fixture.out.join("chart.ssc"))?;
    let ssc = std::str::from_utf8(&ssc_bytes)?;
    assert!(ssc.contains("2200000000\n"));
    assert!(ssc.contains("0011000000\n"));
    assert!(ssc.contains(",\n3300000000\n"));
    let metadata: Value =
        serde_json::from_slice(&fs::read(fixture.out.join("edited-export.json"))?)?;
    let music: Music = serde_json::from_slice(&fs::read(&fixture.music)?)?;
    let expected = serde_json::json!({
        "schema_version": 1,
        "source": "user_edited",
        "certification": {
            "status": "none",
            "reason": "not_generated_from_a_verified_bundle"
        },
        "chart": chart(vec![
            Note { tick: 0, panel_mask: 3, hold_ticks: 16 },
            Note { tick: 4, panel_mask: 12, hold_ticks: 0 },
        ]),
        "music": music,
        "artifacts": {
            "ssc_file": "chart.ssc",
            "ssc_sha256": hex::encode(Sha256::digest(&ssc_bytes)),
            "audio_file": "music.wav",
            "audio_sha256": hex::encode(Sha256::digest(b"edited chart audio")),
        }
    });
    assert_eq!(metadata, expected);
    let output = serde_json::to_value(result)?;
    assert_eq!(output["directory"], fixture.out.to_string_lossy().as_ref());
    assert_eq!(output["edited_export"], metadata);
    Ok(())
}

#[test]
fn export_rejects_audio_hash_mismatch_without_creating_destination() -> anyhow::Result<()> {
    let fixture = fixture(&chart(Vec::new()))?;
    fs::write(&fixture.audio, b"changed after metadata")?;

    let error = crate::newchart_edited_export::export(&args(&fixture))
        .expect_err("audio binding must be enforced");

    assert!(error.to_string().contains("audio SHA-256"));
    assert!(fs::symlink_metadata(&fixture.out).is_err());
    Ok(())
}

#[test]
fn export_rejects_hold_tail_onset_collision_without_creating_destination() -> anyhow::Result<()> {
    let fixture = fixture(&chart(vec![
        Note {
            tick: 0,
            panel_mask: 1,
            hold_ticks: 4,
        },
        Note {
            tick: 4,
            panel_mask: 1,
            hold_ticks: 0,
        },
    ]))?;

    let error = crate::newchart_edited_export::export(&args(&fixture))
        .expect_err("SSC cell collision must be rejected");

    assert!(error.to_string().contains("hold tail"));
    assert!(fs::symlink_metadata(&fixture.out).is_err());
    Ok(())
}

#[test]
fn export_rejects_unrepresentable_grid_without_creating_destination() -> anyhow::Result<()> {
    let fixture = fixture(&Chart {
        ticks_per_beat: 7,
        span_ticks: 14,
        notes: vec![Note {
            tick: 1,
            panel_mask: 1,
            hold_ticks: 0,
        }],
    })?;

    let error =
        crate::newchart_edited_export::export(&args(&fixture)).expect_err("SSC grid must be exact");

    assert!(error.to_string().contains("192-row grid"));
    assert!(fs::symlink_metadata(&fixture.out).is_err());
    Ok(())
}

#[test]
fn export_preserves_existing_destination() -> anyhow::Result<()> {
    let fixture = fixture(&chart(Vec::new()))?;
    fs::create_dir(&fixture.out)?;
    let sentinel = fixture.out.join("sentinel");
    fs::write(&sentinel, b"keep")?;

    let result = crate::newchart_edited_export::export(&args(&fixture));

    assert!(result.is_err());
    assert_eq!(fs::read(sentinel)?, b"keep");
    assert!(fs::symlink_metadata(fixture.out.join("chart.ssc")).is_err());
    Ok(())
}

#[cfg(unix)]
#[test]
fn export_preserves_existing_destination_symlink() -> anyhow::Result<()> {
    use std::os::unix::fs::symlink;

    let fixture = fixture(&chart(Vec::new()))?;
    let target = fixture._root.path().join("target");
    fs::create_dir(&target)?;
    symlink(&target, &fixture.out)?;

    let result = crate::newchart_edited_export::export(&args(&fixture));

    assert!(result.is_err());
    assert!(fs::read_dir(target)?.next().is_none());
    assert!(Path::new(&fixture.out).is_symlink());
    Ok(())
}

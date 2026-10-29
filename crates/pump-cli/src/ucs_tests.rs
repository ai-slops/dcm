use std::fs;

use pump_chart::{Chart, Fraction, Music, Note, TempoSegment};
use sha2::{Digest, Sha256};

use crate::chart_cli::{
    ChartExportUcsArgs, ChartExportUcsBeatsArgs, ChartImportUcsArgs, UcsModeArg,
};

#[test]
fn import_binds_optional_audio_hash() -> anyhow::Result<()> {
    let root = tempfile::tempdir()?;
    let ucs = root.path().join("chart.ucs");
    let audio = root.path().join("music.bin");
    fs::write(
        &ucs,
        b":Format=1\n:Mode=Single\n:BPM=120\n:Beat=4\n:Split=4\nX....\n",
    )?;
    fs::write(&audio, b"audio")?;

    let imported = crate::ucs_commands::import(&ChartImportUcsArgs {
        file: ucs,
        audio: Some(audio),
    })?;

    let expected_hash: [u8; 32] = Sha256::digest(b"audio").into();
    assert_eq!(imported.music.audio_sha256, expected_hash);
    assert_eq!(imported.chart.notes.len(), 1);
    Ok(())
}

#[test]
fn import_preserves_stable_codec_error_prefix() -> anyhow::Result<()> {
    let root = tempfile::tempdir()?;
    let ucs = root.path().join("bad.ucs");
    fs::write(&ucs, b":Format=3\n")?;

    let error = crate::ucs_commands::import(&ChartImportUcsArgs {
        file: ucs,
        audio: None,
    })
    .expect_err("format must be rejected");

    assert!(error.to_string().starts_with("UCS "));
    Ok(())
}

#[test]
fn export_writes_new_file_and_preserves_existing_destination() -> anyhow::Result<()> {
    let root = tempfile::tempdir()?;
    let chart_path = root.path().join("chart.json");
    let music_path = root.path().join("music.json");
    let out = root.path().join("chart.ucs");
    let chart = Chart {
        ticks_per_beat: 4,
        span_ticks: 4,
        notes: vec![Note {
            tick: 0,
            panel_mask: 1,
            hold_ticks: 0,
        }],
    };
    let music = Music {
        duration_ticks: 4,
        ticks_per_beat: 4,
        offset_micros: 0,
        tempo: vec![TempoSegment {
            start_tick: 0,
            micros_per_beat: Fraction::new(500_000, 1)?,
        }],
        audio_sha256: [0; 32],
        reference_accents: Vec::new(),
    };
    fs::write(&chart_path, serde_json::to_vec(&chart)?)?;
    fs::write(&music_path, serde_json::to_vec(&music)?)?;
    let args = ChartExportUcsArgs {
        chart: chart_path,
        music: music_path,
        mode: UcsModeArg::Single,
        out: out.clone(),
    };

    let summary = crate::ucs_commands::export(&args)?;
    fs::write(&out, b"sentinel")?;
    let error = crate::ucs_commands::export(&args).expect_err("existing file must be preserved");

    assert_eq!(summary.source, "user_edited");
    assert_eq!(summary.certification.status, "none");
    assert!(error.to_string().contains("create new UCS output"));
    assert_eq!(fs::read(out)?, b"sentinel");
    Ok(())
}

#[test]
fn beat_import_and_export_preserve_section_local_grid() -> anyhow::Result<()> {
    let root = tempfile::tempdir()?;
    let ucs = root.path().join("source.ucs");
    let json = root.path().join("beats.json");
    let output = root.path().join("roundtrip.ucs");
    let mut source =
        String::from(":Format=1\n:Mode=Single\n:BPM=120\n:Beat=4\n:Split=127\nX....\n");
    source.push_str(&".....\n".repeat(127));
    source.push_str(":Split=113\n.X...\n");
    source.push_str(&".....\n".repeat(113));
    fs::write(&ucs, source)?;

    let imported = crate::ucs_commands::import_beats(&ChartImportUcsArgs {
        file: ucs,
        audio: None,
    })?;
    fs::write(&json, serde_json::to_vec(&imported)?)?;
    crate::ucs_commands::export_beats(&ChartExportUcsBeatsArgs {
        chart: json,
        out: output.clone(),
    })?;
    let reparsed = pump_ucs::parse_ucs_beats(&fs::read(output)?, [0; 32])?;

    assert_eq!(reparsed, imported);
    assert_eq!(imported.grid_sections[1].rows_per_measure, 452);
    Ok(())
}

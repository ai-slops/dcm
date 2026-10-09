use std::fs;

use crate::chart_export::{ExportFiles, publish};

#[test]
fn publish_refuses_existing_destination_without_clobbering_it() -> anyhow::Result<()> {
    let parent = tempfile::tempdir()?;
    let root = parent.path().join("export");
    fs::create_dir(&root)?;
    let sentinel = root.join("sentinel");
    fs::write(&sentinel, b"keep")?;
    let files = ExportFiles {
        ssc: b"ssc",
        audio_name: "music.wav",
        audio: b"audio",
        replay: b"replay",
    };

    let result = publish(&root, &files);

    assert!(result.is_err());
    assert_eq!(fs::read(sentinel)?, b"keep");
    assert!(fs::symlink_metadata(root.join("chart.ssc")).is_err());
    Ok(())
}

#[test]
fn publish_creates_fixed_artifact_set() -> anyhow::Result<()> {
    let parent = tempfile::tempdir()?;
    let root = parent.path().join("export");
    let files = ExportFiles {
        ssc: b"ssc",
        audio_name: "music.ogg",
        audio: b"audio",
        replay: b"replay",
    };

    publish(&root, &files)?;

    assert_eq!(fs::read(root.join("chart.ssc"))?, b"ssc");
    assert_eq!(fs::read(root.join("music.ogg"))?, b"audio");
    assert_eq!(fs::read(root.join("replay.json"))?, b"replay");
    Ok(())
}

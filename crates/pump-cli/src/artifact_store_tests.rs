use std::fs;

use crate::artifact_store::{ArtifactStore, BlobDigest};

#[test]
fn blob_roundtrip_uses_the_sha256_address() {
    let root = tempfile::tempdir().expect("root");
    let store = ArtifactStore::create(&root.path().join("store")).expect("store");
    let digest =
        BlobDigest::parse("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
            .expect("digest");
    store.put(&digest, b"hello").expect("put");
    assert_eq!(store.read(&digest).expect("read"), b"hello");
    assert!(
        root.path()
            .join("store/blobs/sha256")
            .join(digest.as_str())
            .is_file()
    );
}

#[test]
fn repeated_identical_puts_share_one_blob() {
    let root = tempfile::tempdir().expect("root");
    let store = ArtifactStore::create(root.path()).expect("store");
    let digest = BlobDigest::parse(&crate::bundle::digest(b"shared")).expect("digest");
    store.put(&digest, b"shared").expect("first");
    store.put(&digest, b"shared").expect("second");
    assert_eq!(
        fs::read_dir(root.path().join("blobs/sha256"))
            .expect("blobs")
            .count(),
        1
    );
}

#[test]
fn corrupt_existing_blob_is_rejected_without_overwrite() {
    let root = tempfile::tempdir().expect("root");
    let store = ArtifactStore::create(root.path()).expect("store");
    let digest = BlobDigest::parse(&crate::bundle::digest(b"original")).expect("digest");
    store.put(&digest, b"original").expect("initial");
    let path = root.path().join("blobs/sha256").join(digest.as_str());
    fs::write(&path, b"corrupt").expect("tamper");
    assert!(store.put(&digest, b"original").is_err());
    assert!(store.read(&digest).is_err());
    assert_eq!(fs::read(path).expect("unchanged corruption"), b"corrupt");
}

#[test]
fn mismatched_content_cannot_be_stored_under_a_digest() {
    let root = tempfile::tempdir().expect("root");
    let store = ArtifactStore::create(root.path()).expect("store");
    let digest = BlobDigest::parse(&"00".repeat(32)).expect("digest");
    assert!(store.put(&digest, b"different").is_err());
    assert_eq!(
        fs::read_dir(root.path().join("blobs/sha256"))
            .expect("blobs")
            .count(),
        0
    );
}

#[test]
fn invalid_digest_names_never_become_paths() {
    for digest in ["../outside", "ABCDEF", "", &"A".repeat(64), &"0".repeat(63)] {
        assert!(BlobDigest::parse(digest).is_err());
    }
}

#[test]
fn opening_missing_store_does_not_create_it() {
    let root = tempfile::tempdir().expect("root");
    let path = root.path().join("absent");
    assert!(ArtifactStore::open(&path).is_err());
    assert!(!path.exists());
}

#[test]
fn oversized_blob_is_rejected_before_reading_contents() {
    let root = tempfile::tempdir().expect("root");
    let store = ArtifactStore::create(root.path()).expect("store");
    let digest = BlobDigest::parse(&"00".repeat(32)).expect("digest");
    let file = fs::File::create(root.path().join("blobs/sha256").join(digest.as_str()))
        .expect("sparse file");
    file.set_len(crate::artifact_io::ARTIFACT_LIMIT + 1)
        .expect("oversized length");
    let error = store.read(&digest).expect_err("size bound");
    assert!(error.to_string().contains("size limit"));
}

#[cfg(unix)]
#[test]
fn symlinked_store_directories_and_blobs_are_rejected() {
    let root = tempfile::tempdir().expect("root");
    let outside = tempfile::tempdir().expect("outside");
    let linked = root.path().join("linked");
    std::os::unix::fs::symlink(outside.path(), &linked).expect("link root");
    assert!(ArtifactStore::create(&linked).is_err());
    let store = ArtifactStore::create(&root.path().join("real")).expect("store");
    let digest = BlobDigest::parse(&crate::bundle::digest(b"data")).expect("digest");
    let target = outside.path().join("data");
    fs::write(&target, b"data").expect("target");
    std::os::unix::fs::symlink(
        &target,
        root.path().join("real/blobs/sha256").join(digest.as_str()),
    )
    .expect("link blob");
    assert!(store.read(&digest).is_err());
    assert!(store.put(&digest, b"data").is_err());
}

#[test]
fn concurrent_writers_publish_only_complete_matching_content() {
    let root = tempfile::tempdir().expect("root");
    let store = ArtifactStore::create(root.path()).expect("store");
    let digest = BlobDigest::parse(&crate::bundle::digest(b"shared")).expect("digest");
    std::thread::scope(|scope| {
        let jobs: Vec<_> = (0..8)
            .map(|_| scope.spawn(|| store.put(&digest, b"shared")))
            .collect();
        for job in jobs {
            job.join().expect("join").expect("put");
        }
    });
    assert_eq!(store.read(&digest).expect("read"), b"shared");
    assert_eq!(
        fs::read_dir(root.path().join("blobs/sha256"))
            .expect("blobs")
            .count(),
        1
    );
}

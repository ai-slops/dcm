use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Component, Path, PathBuf};

use anyhow::{Context, Result, bail, ensure};

use crate::artifact_io::{self, ARTIFACT_LIMIT};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct BlobDigest(String);

impl BlobDigest {
    pub fn parse(value: &str) -> Result<Self> {
        ensure!(
            value.len() == 64
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)),
            "blob digest must be 64 lowercase hexadecimal characters"
        );
        Ok(Self(value.to_owned()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug)]
pub struct ArtifactStore {
    blobs: PathBuf,
}

impl ArtifactStore {
    pub fn create(root: &Path) -> Result<Self> {
        Ok(Self {
            blobs: directory(&root.join("blobs/sha256"), true)?,
        })
    }

    pub fn open(root: &Path) -> Result<Self> {
        Ok(Self {
            blobs: directory(&root.join("blobs/sha256"), false)?,
        })
    }

    pub fn read(&self, digest: &BlobDigest) -> Result<Vec<u8>> {
        directory(&self.blobs, false)?;
        let bytes = artifact_io::read(&self.blobs.join(digest.as_str()), ARTIFACT_LIMIT)?;
        ensure!(
            crate::bundle::digest(&bytes) == digest.as_str(),
            "stored blob digest mismatch: {}",
            digest.as_str()
        );
        Ok(bytes)
    }

    pub fn put(&self, digest: &BlobDigest, bytes: &[u8]) -> Result<()> {
        ensure!(
            u64::try_from(bytes.len())? <= ARTIFACT_LIMIT,
            "blob exceeds size limit"
        );
        ensure!(
            crate::bundle::digest(bytes) == digest.as_str(),
            "input blob digest mismatch"
        );
        directory(&self.blobs, false)?;
        let destination = self.blobs.join(digest.as_str());
        match fs::symlink_metadata(&destination) {
            Ok(_) => {
                self.read(digest)?;
                return Ok(());
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(error).context("inspect blob destination"),
        }
        let mut temporary =
            tempfile::NamedTempFile::new_in(&self.blobs).context("create blob staging file")?;
        temporary
            .write_all(bytes)
            .context("write blob staging file")?;
        temporary
            .as_file()
            .sync_all()
            .context("sync blob contents")?;
        match temporary.persist_noclobber(&destination) {
            Ok(_) => Ok(()),
            Err(error) if error.error.kind() == ErrorKind::AlreadyExists => {
                self.read(digest)?;
                Ok(())
            }
            Err(error) => Err(error).context("publish blob without overwriting"),
        }
    }
}

fn directory(path: &Path, create: bool) -> Result<PathBuf> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    let mut checked = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::CurDir => continue,
            Component::ParentDir => bail!("store path cannot contain parent-directory components"),
            Component::Prefix(_) | Component::RootDir | Component::Normal(_) => {
                checked.push(component.as_os_str())
            }
        }
        match fs::symlink_metadata(&checked) {
            Ok(metadata) => ensure!(
                metadata.is_dir(),
                "store path must be a real directory: {}",
                checked.display()
            ),
            Err(error) if create && error.kind() == ErrorKind::NotFound => {
                match fs::create_dir(&checked) {
                    Ok(()) => {}
                    Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                        ensure!(
                            fs::symlink_metadata(&checked)?.is_dir(),
                            "store directory was replaced"
                        );
                    }
                    Err(error) => return Err(error).context("create store directory"),
                }
            }
            Err(error) => {
                return Err(error)
                    .with_context(|| format!("inspect store directory {}", checked.display()));
            }
        }
    }
    Ok(checked)
}

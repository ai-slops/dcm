use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;

use anyhow::{Context, Result, ensure};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::artifact_io;

pub const SIGNATURE_FILE: &str = "signature.json";
const DOMAIN: &[u8] = b"pump.chart.bundle.manifest.v2\0";

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BundleSignature {
    pub schema_version: u16,
    pub algorithm: String,
    pub public_key: String,
    pub manifest_sha256: String,
    pub signature: String,
}

pub fn keygen(private_path: &Path, public_path: &Path) -> Result<()> {
    let mut secret = [0_u8; 32];
    getrandom::fill(&mut secret).context("obtain key material from OS randomness")?;
    let signing = SigningKey::from_bytes(&secret);
    write_new_private(private_path, signing.as_bytes())?;
    let public = hex::encode(signing.verifying_key().as_bytes());
    write_new(public_path, format!("{public}\n").as_bytes(), "public key")
}

pub fn sign(bundle: &Path, manifest: &[u8], private_path: &Path) -> Result<BundleSignature> {
    let private = artifact_io::read(private_path, 64)?;
    ensure!(
        private.len() == 32,
        "private key must contain exactly 32 raw bytes"
    );
    let secret: [u8; 32] = private
        .try_into()
        .map_err(|_| anyhow::anyhow!("invalid private key length"))?;
    let signing = SigningKey::from_bytes(&secret);
    let signature = signing.sign(&message(manifest));
    let record = BundleSignature {
        schema_version: 2,
        algorithm: "ed25519".to_owned(),
        public_key: hex::encode(signing.verifying_key().as_bytes()),
        manifest_sha256: hex::encode(Sha256::digest(manifest)),
        signature: hex::encode(signature.to_bytes()),
    };
    write_new(
        &bundle.join(SIGNATURE_FILE),
        &serde_json::to_vec_pretty(&record).context("encode bundle signature")?,
        "bundle signature",
    )?;
    Ok(record)
}

pub fn verify(bundle: &Path, manifest: &[u8], trusted_key: &str) -> Result<BundleSignature> {
    let bytes = artifact_io::read(&bundle.join(SIGNATURE_FILE), 65_536)?;
    let record: BundleSignature =
        serde_json::from_slice(&bytes).context("decode bundle signature")?;
    ensure!(record.schema_version == 2, "unsupported signature schema");
    ensure!(
        record.algorithm == "ed25519",
        "unsupported signature algorithm"
    );
    ensure!(
        record.manifest_sha256 == hex::encode(Sha256::digest(manifest)),
        "signature manifest binding mismatch"
    );
    let trusted = parse_public_key(trusted_key)?;
    ensure!(
        hex::encode(trusted.as_bytes()) == record.public_key,
        "bundle signer is not the trusted key"
    );
    let signature_bytes =
        hex::decode(&record.signature).context("signature must be hexadecimal")?;
    let signature = Signature::from_slice(&signature_bytes).context("invalid Ed25519 signature")?;
    trusted
        .verify_strict(&message(manifest), &signature)
        .context("bundle signature verification failed")?;
    Ok(record)
}

fn parse_public_key(value: &str) -> Result<VerifyingKey> {
    if value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return verifying_key(&hex::decode(value).context("trusted key must be hexadecimal")?);
    }
    let encoded = if Path::new(value).is_file() {
        let bytes = artifact_io::read(Path::new(value), 128)?;
        match bytes.len() {
            32 => return verifying_key(&bytes),
            _ => String::from_utf8(bytes).context("public key file must be raw bytes or hex")?,
        }
    } else {
        value.to_owned()
    };
    let bytes = hex::decode(encoded.trim()).context("trusted key must be a file or 32-byte hex")?;
    verifying_key(&bytes)
}

fn verifying_key(bytes: &[u8]) -> Result<VerifyingKey> {
    let key: [u8; 32] = bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("public key must contain exactly 32 bytes"))?;
    VerifyingKey::from_bytes(&key).context("invalid Ed25519 public key")
}

fn message(manifest: &[u8]) -> Vec<u8> {
    let mut message = Vec::with_capacity(DOMAIN.len() + manifest.len());
    message.extend_from_slice(DOMAIN);
    message.extend_from_slice(manifest);
    message
}

fn write_new_private(path: &Path, bytes: &[u8]) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)
            .with_context(|| format!("create private key {}", path.display()))?;
        file.write_all(bytes).context("write private key")?;
        Ok(())
    }
    #[cfg(not(unix))]
    anyhow::bail!("private key permission enforcement is unsupported on this platform")
}

fn write_new(path: &Path, bytes: &[u8], label: &str) -> Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .with_context(|| format!("create {label} {}", path.display()))?;
    file.write_all(bytes)
        .with_context(|| format!("write {label}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn trusted_key_must_match_embedded_signer() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let bundle = directory.path().join("bundle");
        fs::create_dir(&bundle).expect("bundle directory");
        fs::write(bundle.join(crate::chart_bundle::MANIFEST), b"manifest").expect("manifest");
        let private = directory.path().join("private.key");
        let public = directory.path().join("public.key");
        keygen(&private, &public).expect("key generation");
        let manifest = b"manifest";
        sign(&bundle, manifest, &private).expect("sign bundle");
        let other_private = directory.path().join("other.key");
        let other_public = directory.path().join("other.pub");
        keygen(&other_private, &other_public).expect("other key generation");

        let error = verify(
            &bundle,
            manifest,
            other_public.to_str().expect("UTF-8 path"),
        )
        .expect_err("untrusted signer must fail");

        assert!(error.to_string().contains("trusted key"));
    }

    #[cfg(unix)]
    #[test]
    fn signing_refuses_signature_symlink() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().expect("temporary directory");
        let bundle = directory.path().join("bundle");
        fs::create_dir(&bundle).expect("bundle directory");
        fs::write(bundle.join(crate::chart_bundle::MANIFEST), b"manifest").expect("manifest");
        let private = directory.path().join("private.key");
        let public = directory.path().join("public.key");
        keygen(&private, &public).expect("key generation");
        let outside = directory.path().join("outside");
        fs::write(&outside, b"sentinel").expect("outside fixture");
        symlink(&outside, bundle.join(SIGNATURE_FILE)).expect("signature symlink");

        let result = sign(&bundle, b"manifest", &private);

        assert!(result.is_err());
        assert_eq!(fs::read(outside).expect("outside bytes"), b"sentinel");
    }

    #[test]
    fn exact_hex_trust_anchor_is_parsed_as_literal() {
        let key = SigningKey::from_bytes(&[7_u8; 32]).verifying_key();
        let encoded = hex::encode(key.as_bytes());

        let parsed = parse_public_key(&encoded).expect("literal public key");

        assert_eq!(parsed, key);
    }

    #[test]
    fn verification_uses_the_supplied_manifest_snapshot() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let bundle = directory.path().join("bundle");
        fs::create_dir(&bundle).expect("bundle directory");
        let signed_manifest = b"signed manifest snapshot";
        fs::write(bundle.join(crate::chart_bundle::MANIFEST), signed_manifest)
            .expect("manifest fixture");
        let private = directory.path().join("private.key");
        let public = directory.path().join("public.key");
        keygen(&private, &public).expect("key generation");
        sign(&bundle, signed_manifest, &private).expect("sign snapshot");
        fs::write(
            bundle.join(crate::chart_bundle::MANIFEST),
            b"different filesystem manifest",
        )
        .expect("replace filesystem manifest");
        let trusted_key = public.to_str().expect("UTF-8 path");

        let verified = verify(&bundle, signed_manifest, trusted_key).expect("verify snapshot");
        let mismatch = verify(&bundle, b"different supplied snapshot", trusted_key)
            .expect_err("different supplied bytes must fail");

        assert_eq!(
            verified.manifest_sha256,
            hex::encode(Sha256::digest(signed_manifest))
        );
        assert!(mismatch.to_string().contains("manifest binding"));
    }
}

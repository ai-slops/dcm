# Local content-addressed artifact store

The store retains exact authoring component bytes, not native Wasmtime machine code or generated Plan fragments. It enables compilation from a package lock after the original package directory has been removed. It is offline and has no network fallback.

## Workflow

```sh
pump package resolve song.package.json --out song.lock.json
pump package cache song.package.json --lock song.lock.json --store .pump-store
pump package compile-locked song.lock.json \
  --store .pump-store --runtime runtime.component.wasm --out restored.bundle
```

Caching requires an existing exact lock and checks it against a fresh source resolution before writing blobs. A changed source artifact is rejected; this command never updates the lock implicitly. The report's `unique_blob_count` counts distinct digests referenced by that lock, not every blob in the store. Independent songs reuse the same stored bytes whenever their component digests match.

Lock-only compilation validates the existing lock schema, roles, capabilities, graph, and ordering, loads digest-matching component bytes, and passes the same in-memory resolution to the existing compiler. ABI checks, guest budgets, mutation poisoning, and bundle validation remain unchanged. The exact supplied lock bytes are preserved, including whitespace: they are not reconstructed from parsed JSON.

## Layout

```text
.pump-store/
  blobs/
    sha256/
      <64 lowercase hexadecimal characters>
```

Only validated SHA-256 values become filenames. The store root is explicitly supplied; no global cache directory is inferred. `.pump-store/` is ignored by Git in this repository. Keep lockfiles separately and version them as appropriate. The runtime generator is still supplied explicitly rather than fetched from this store.

## Integrity and publication

- Each blob is limited to 32 MiB. Package loading retains the existing maximum of 16 package entries and 128 MiB of component bytes per compilation.
- Every read checks regular-file status, size, and SHA-256 before bytes reach Wasmtime.
- New content is written and synced to a same-directory temporary file, then published without replacing an existing path. Concurrent cooperative writers can publish the same digest safely.
- Existing blobs are verified, never overwritten. A corrupt existing blob causes both reads and repeated imports to fail; repair requires explicit operator action.
- Missing stores and blobs fail. Read-only loading does not create directories or search source paths.
- Store path components must be real directories, without symbolic links or `..`. Blob symlinks and special files are rejected.

The directory must be controlled by the operator and must not be writable by untrusted users. Path checks are not a race-free capability filesystem boundary against an attacker replacing directory entries concurrently. Temporary-file cleaners must not operate inside an active store. The no-clobber publication contract prevents replacing existing content; full crash-durable multi-blob transactions are not claimed. A failed import may leave complete, reusable blobs already stored, and a crash may leave staging files.

Hashes establish content integrity, not publisher identity. A lock from an untrusted source is not an authenticity certificate. Caching does not execute or certify components; typed component validation still happens at compile time. Signing, remote transport, garbage collection, native compilation caches, and Plan-fragment caches remain separate work.

## Verification

`scripts/test-store.sh` compares every file in source-built and lock-only bundles, then compares real WASM generation results. It uses a deliberately reformatted lock, caches two songs with one shared pattern (five blobs rather than six), removes all source component files, and checks missing/corrupt blob failures. Filesystem tests cover duplicate imports, concurrent writers, digest/path validation, symlinks, oversized blobs, and no-clobber handling of corruption.

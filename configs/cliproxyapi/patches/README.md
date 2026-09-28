# CLIProxyAPI catalog persistence patch

`0001-persist-model-catalog.patch` applies to upstream v7.3.12, commit
`2eb8dd11d2480c5fd8bc8f2796cec6af534bc3b6`. It includes production changes and
registry regression tests. It is a local patch, not an upstream release.

## Contract

- Restore the last validated `models.json` before the first network fetch.
- Preserve the raw JSON, including provider capability fields omitted by Go JSON
  marshaling of the public model structs.
- Limit cache/network reads to 8 MiB; reject malformed, duplicate-ID, and all-empty
  catalogs. Keep the previous catalog on invalid remote data.
- Write cache files privately using a same-directory temporary file, fsync, atomic
  rename, and directory fsync. Failed writes retain the live in-memory catalog and
  trigger retries.
- Retry unsuccessful refreshes with exponential delay and half-to-full jitter,
  capped at one minute. Return to the existing three-hour interval after success.
- Use the existing provider registration callback; do not restart the server or
  substitute model IDs.

The repo installer sets `CLIPROXYAPI_MODEL_CACHE` explicitly. Standalone upstream
builds with this patch otherwise use the OS user-cache directory.

## Verification and upgrades

In a checkout of the pinned upstream commit:

```bash
git apply /path/to/dev/configs/cliproxyapi/patches/0001-persist-model-catalog.patch
GOTOOLCHAIN=go1.26.0 go test ./internal/registry
GOTOOLCHAIN=go1.26.0 go test -race ./internal/registry
```

From this setup repo:

```bash
bash tests/cliproxyapi.test.sh
bash tests/cliproxy-helper.test.sh
# Actual proxy process, synthetic account, no live credentials or inference:
python3 tests/cliproxy-catalog-integration.test.py \
  ~/.local/bin/cli-proxy-api /path/to/patched-upstream/internal/registry/models/models.json
```

The Python test runs two isolated starts with outbound HTTP(S) downloads blocked.
It proves a model present only in the disk cache appears in the first populated
`/v1/models` response after both starts. The upstream server may return an empty
list before it finishes loading account credentials; this test does not redefine
that server-wide readiness behavior. Registry tests separately exercise download failure, recovery,
cancellation, persistence failure, corrupt caches, and capability preservation.

When upgrading, check whether upstream has solved these issues before rebasing.
Update the source commit/archive checksum and toolchain pin together. Never replace
this patch with a downloaded catalog masquerading as a model alias. Keep user OAuth
credentials and the live cached catalog out of this repository.

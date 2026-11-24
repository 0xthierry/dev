# CLIProxyAPI catalog persistence patch

`0001-persist-model-catalog.patch` applies to upstream v8.1.2, commit
`85225381d89915595598ed13766cd79890c03a84`. It includes production changes and
registry regression tests. It is a local patch, not an upstream release.

## Contract

- For the **implicit official general catalog**, restore the last validated
  `models.json` before its first background fetch and finish notifying registrations
  before startup returns. Explicit URLs/files, `--local-model`, Home mode, and the
  separate Codex/Devin catalogs retain upstream policy; they never read or write
  this cache.
- Preserve the raw JSON, including provider capability fields omitted by Go JSON
  marshaling of the public model structs. If an official update omits Meta, keep
  the previous official Meta definitions (not a custom source's definitions).
- Limit cache/network reads to 8 MiB; reject malformed, duplicate-ID, and all-empty
  catalogs. Keep the previous catalog on invalid remote data.
- Write cache files privately using a same-directory temporary file, fsync, atomic
  rename, and directory fsync. Failed writes retain the live in-memory catalog and
  trigger retries on the background schedule. Background and on-demand publication
  share upstream's generation/sequence fence so a stale result cannot overwrite
  a newer memory or disk catalog.
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
GOTOOLCHAIN=go1.26.10 go test ./internal/registry
GOTOOLCHAIN=go1.26.10 go test -race ./internal/registry
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

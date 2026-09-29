# PSVR2 device permissions

`70-xrhardware.rules` and `LICENSE.xr-hardware` are vendored from
[xr-hardware](https://gitlab.freedesktop.org/monado/utilities/xr-hardware)
commit `143de7a51d307297244769d51d6401897fce2abe`.

Rules SHA256: `4531d8ba2d1c72c33cf7a9c4c11f34142bf4446245a2e71427943347ab9c55da`.

The upstream PSVR2Toolkit Linux guide requires current xr-hardware rules rather
than older distro packages, especially for the left Sense controller. These
rules use logind `uaccess` for the active local session, not world-writable
permissions. The complete upstream rules are preserved, including other XR
hardware support and the original license.

The Omarchy `psvr2` config target installs them through
`install/psvr2-permissions.sh`, which verifies the pinned hash and udev syntax,
backs up an existing different regular file, and reloads the rules. It refuses
to overwrite a symlink. The script is also the narrow entry point for graphical
administrator authorization using `pkexec --disable-internal-agent /usr/bin/bash
/absolute/path/to/install/psvr2-permissions.sh`.

See [the PSVR2 setup guide](../../psvr2/README.md) for user-local components.

# Native analysis third-party notices

The Android native analysis build reproducibly compiles these pinned upstream
projects. Generated source and binary output is not committed.

## KataGo

- Project: <https://github.com/lightvector/KataGo>
- Version: v1.18.2
- Commit: `fd0723fdbc0e9d82cf269c9630af8c27c57c07c4`
- License: MIT for KataGo-owned code, plus the bundled-component notices in the
  upstream `LICENSE` and `cpp/external` directories.

Copyright 2025 David J Wu ("lightvector") and contributors. Permission is
granted, free of charge, to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies, provided that the copyright and permission
notice are included. The software is provided without warranty.

## Eigen

- Project: <https://gitlab.com/libeigen/eigen>
- Version: 3.4.0
- Commit: `3147391d946bb4b6c68edd901f2add6ac1f31f8c`
- License: Mozilla Public License 2.0; see
  <https://www.mozilla.org/MPL/2.0/> and the pinned source file `COPYING.MPL2`.

Store-release packaging must expose the complete pinned upstream license texts
and notices to users. This records provenance for the development build; it is
not a substitute for the final in-app legal-notices screen.

"""TLS configuration for the frozen personal worker.

The desktop worker runs from a bundled Python runtime, which does not inherit
the host interpreter's CA search path.  Keep the trust store in the immutable
release and require certificate verification for every control-plane and
artifact request.
"""

from __future__ import annotations

import ssl

import certifi


def https_context() -> ssl.SSLContext:
    """Return a certificate-verifying context backed by the bundled CA file."""

    return ssl.create_default_context(cafile=certifi.where())

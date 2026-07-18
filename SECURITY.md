# Security Policy

## Reporting a Vulnerability

Please report security issues privately to **hello@cynco.dev**. Do not open a
public issue for anything you believe has security impact.

You can expect an acknowledgement within 72 hours. Please include a reproduction
if possible.

## Scope

These packages render financial data client-side and never transmit it anywhere;
there is no server component. Reports we care about most:

- HTML/attribute injection through entry, posting, account, or statement data
  reaching a shadow root unescaped
- Monetary integer-arithmetic errors (overflow, precision, sign handling)
- Supply-chain issues in the published npm artifacts

## Supported Versions

Only the latest published version of each package receives security fixes while
the project is pre-1.0.

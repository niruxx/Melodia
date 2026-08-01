# Security Policy

## Supported Versions

TuneBox is early-stage software. Only the latest release receives security fixes.

| Version | Supported |
| ------- | --------- |
| 0.3.x   | ✅ |
| < 0.3   | ❌ |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/niruxx/TuneBox/security) of this repository
2. Click **Report a vulnerability**
3. Describe the issue and how to reproduce it

If private reporting is unavailable, open a regular issue saying only that you have a security report to share — without details — and a maintainer will arrange a private channel.

### What to include

The more of this you can provide, the faster it can be triaged:

- The type of issue and the component affected
- Step-by-step reproduction instructions, ideally with a minimal case
- The version of TuneBox, your OS, and how you installed it
- The impact you believe it has
- Any proof-of-concept code, logs, or screenshots — **redact your own cookies, tokens, and account details**

### What to expect

This is a small hobby project maintained in spare time, so responses are best-effort rather than guaranteed:

- **Acknowledgement** — typically within a week
- **Assessment** — a decision on validity and severity once reproduced
- **Fix** — released as soon as practical, prioritised by severity
- **Credit** — you'll be credited in the release notes unless you'd rather not be

Please allow a reasonable window for a fix before disclosing publicly.

## Scope

TuneBox is a desktop client that runs on your own machine. Security-relevant areas include:

- **Stored credentials** — the YouTube Music session cookie or OAuth token held in the app's data directory
- **The Google sign-in window** — session capture and the handling of that cookie
- **LAN device control** — mDNS discovery and the TCP control channel
- **The Python sidecar** — the stdin/stdout bridge and its handling of data returned by YouTube
- **Remote content handling** — audio streams, album artwork, and API responses fetched from the internet

### Known and already documented

These are recorded in the [README roadmap](README.md#-roadmap--known-limitations) and don't need reporting as new findings. Better designs are very welcome as issues or pull requests:

- **LAN device control is unauthenticated and unencrypted** beyond an on-device Accept/Decline prompt. It is intended for a trusted home network only — anyone on the same network who can reach the advertised port can request control.
- **Stored session credentials are not encrypted at rest.** They rely on the operating system's user-account file permissions. Anyone who can read your TuneBox data directory can act as you on YouTube Music.
- **Installers are unsigned**, so Windows SmartScreen warns on first run and binaries can't be verified by signature.

### Out of scope

- Vulnerabilities in YouTube, Google, or Discord themselves — report those to the respective vendor
- Vulnerabilities in third-party dependencies, unless TuneBox uses them in a way that makes the issue exploitable here; otherwise please report upstream
- Issues requiring an attacker who already has local access to an unlocked machine, or the ability to modify the installation
- Terms-of-service concerns about accessing YouTube Music through an unofficial API — a real consideration, but not a security vulnerability

## Good to know

TuneBox reaches YouTube Music through the unofficial [ytmusicapi](https://github.com/sigma67/ytmusicapi) and [yt-dlp](https://github.com/yt-dlp/yt-dlp), and it keeps an authenticated session on your machine.

Treat your TuneBox data directory as sensitive. Signing out from within the app clears the stored credentials for both sign-in methods.

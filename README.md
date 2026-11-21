# traceguide

**Self-hosted ScribeHow and Arcade alternative. Turn Playwright `trace.zip` files into auto-redacted interactive step-by-step click-through guides and Markdown docs that auto-refresh in CI (CLI, SQLite library server, Docker, and GitHub Action with zero runtime dependencies).**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node >=24](https://img.shields.io/badge/node-%3E%3D24.0.0-brightgreen.svg)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-informational.svg)](#architecture)

[![Watch the 15-second traceguide demo](https://github.com/flipcyde101/traceguide/releases/download/v0.1.1/traceguide-poster.png)](https://github.com/flipcyde101/traceguide/releases/download/v0.1.1/traceguide-demo.mp4)

[Watch the 15-second traceguide demo (MP4)](https://github.com/flipcyde101/traceguide/releases/download/v0.1.1/traceguide-demo.mp4)

---

## Try It in 2 Seconds (Zero Setup)

```bash
npx traceguide --demo
```

Generates a Playwright-format `trace.zip` for a 4-step demo flow, redacts known sensitive text, and writes an interactive player at `./traceguide-demo.html`. The default export omits screenshots and retains the step captions, redaction markers, and click positions.

**Upgrading from v0.1.0:** Regenerate older redacted HTML before sharing it. The old player could retain the original images under its visual blur. The updated library withholds images when serving older entries. Existing database files and previously shared exports may still contain their original images.

---

## Quick Start

```bash
# Compile any Playwright trace.zip into an interactive HTML guide + Markdown doc
npx traceguide build test-results/checkout/trace.zip \
  --redact-pii \
  --title "Checkout Walkthrough" \
  --out ./docs/checkout-guide.html \
  --markdown ./docs/checkout-guide.md

# Run the self-hosted SQLite guide library server (127.0.0.1:4320)
npx traceguide serve
```

### Reusable GitHub Action (Auto-Update Docs on Every PR)

```yaml
- uses: flipcyde101/traceguide@v0.1.1
  with:
    trace: test-results/onboarding/trace.zip
    out: ./docs/onboarding.html
    markdown-out: ./docs/onboarding.md
    redact-pii: "true"
```

### 10-Line Self-Hosted Docker Sidecar (`docker-compose.yml`)

```yaml
services:
  traceguide:
    build: .
    ports:
      - "4320:4320"
    volumes:
      - traceguide_data:/data
volumes:
  traceguide_data:
```

---

## How `traceguide` Works

- **Pure-TS zero-dependency ZIP parser:** Reads Playwright `trace.zip` archives directly with `node:zlib`, enforcing strict zip-slip path rejection and decompression size caps.
- **ARIA/role auto-captions + click rings:** Matches Playwright actions (`goto`, `click`, `fill`, `press`, `check`, `selectOption`) to their nearest `screencast-frame` image and draws animated click rings at exact `(x, y)` coordinates.
- **PII redaction (`--redact-pii`, default):** Scrubs known sensitive text patterns, including emails, tokens, and sensitive inputs. It omits all original screenshots, including frames without text matches. Use `--no-redact-pii` or library upload `?redact=0` only for traces already safe to share.
- **Standalone HTML + Markdown + `<iframe>` embed:** Outputs a zero-dependency single HTML file with keyboard navigation (`ArrowLeft`/`ArrowRight`), 1-click **Copy Markdown**, and 1-click **Copy Embed `<iframe>`**.

---

## Honest Comparison

| Feature | `traceguide` | ScribeHow / Tango / Arcade | Playwright Trace Viewer |
|---|---|---|---|
| **Self-hosted / MIT open source** | **Yes** (single Node 24 package / Docker) | No (per-seat SaaS) | Local debug viewer |
| **Auto-updates guides from CI E2E traces** | **Yes** (`trace.zip` + GitHub Action) | Manual re-recording | No customer guide output |
| **Built-in PII & secret auto-redaction** | **Yes** (known text patterns and screenshot omission) | Paid tiers / manual | No |
| **Where commercial tools win** | (CI-driven docs & zero SaaS cost) | Browser click-recorder extensions, voiceover/AI narration, hosted team analytics | Deep DOM/network/console test failure debugging |

---

## Architecture

```mermaid
flowchart LR
    Zip["Playwright trace.zip\n(*.trace NDJSON + resources/*)"] --> Parser["Zero-Dep ZIP & Action Parser\n(Click Coords + ARIA Captions)"]
    Parser --> Redact["PII & Secret Auto-Redactor\n(Text Scrub + Screenshot Omission)"]
    Redact --> Out["Standalone Interactive HTML\n+ Markdown + SQLite Library"]
```

## License

[MIT](./LICENSE)

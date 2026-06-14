---
title: "HyperFrames — Declarative HTML-to-Video Rendering for AI Agents"
date: "2026-06-14"
source: "GitHub(27k+ stars), HeyGen"
relevance: 5
issue: "LAT-265"
related: [
  "[[2026-06-14-hyperframes-heygen-agent-video-rendering]]",
  "[[agent-video-automation]]",
  "[[html-rendering-patterns]]",
  "[[structured-output-patterns]]",
  "[[agent-testing-patterns]]"
]
---

# HyperFrames — Declarative HTML-to-Video Rendering for AI Agents

## 1. Overview

**HyperFrames** (github.com/heygen-com/hyperframes) is an open-source framework by HeyGen for turning HTML, CSS, media assets, and seekable animations into deterministic MP4 videos. It was launched in March 2026 and has quickly grown to ~27,450 GitHub stars.

**Key facts:**
- **Language:** TypeScript
- **License:** Apache 2.0 (no per-render fees, no commercial-use thresholds)
- **Requirements:** Node.js 22+, FFmpeg
- **Runtime build system:** Bun (via `bun install`)
- **Production use:** Used in production at HeyGen; adopters include tldraw and TanStack

**Design philosophy:** "Write HTML. Render video. Built for agents."

HyperFrames' central bet is that plain HTML + CSS + data attributes is a better authoring model for AI agents than React components (the Remotion approach). Agents already write HTML/CSS natively; no JSX, no build step, no bundler required. A single `index.html` file is a playable composition.

**The stack** includes:
| Piece | What it does |
|---|---|
| CLI (`hyperframes`) | Scaffold, preview, lint, inspect, and render local video projects |
| Core (`@hyperframes/core`) | Types, parsers, generators, linter, runtime, and frame adapters |
| Engine (`@hyperframes/engine`) | Seekable page-to-video capture using Puppeteer and FFmpeg |
| Producer (`@hyperframes/producer`) | Full rendering pipeline: capture, encode, and audio mix |
| Studio (`@hyperframes/studio`) | Browser-based composition editor UI |
| Player (`@hyperframes/player`) | Embeddable `<hyperframes-player>` web component |
| Shader transitions (`@hyperframes/shader-transitions`) | WebGL shader transitions |
| AWS Lambda (`@hyperframes/aws-lambda`) | Distributed render deployment |
| Catalog | Reusable blocks (transitions, overlays, captions, charts, maps, effects) |
| frame.md | Design-system-to-video translation layer |

**Agent onboarding:** Skills teach the production loop to coding agents via `npx skills add heygen-com/hyperframes`. Agents learn plan → write HTML → wire animations → lint → preview → render without needing generic web docs.

**Sources:**
- [GitHub Repository](https://github.com/heygen-com/hyperframes)
- [Documentation](https://hyperframes.heygen.com/introduction)
- [Quickstart](https://hyperframes.heygen.com/quickstart)
- [Showcase](https://hyperframes.heygen.com/showcase)
- [Catalog](https://hyperframes.heygen.com/catalog/blocks/data-chart)
- [Playground](https://www.hyperframes.dev/)
- [Studio](https://github.com/heygen-com/hyperframes/tree/main/packages/studio)

---

## 2. How It Works: The Rendering Pipeline

The HyperFrames pipeline is a three-stage chain: **HTML composition → headless Chrome rendering (Puppeteer) → FFmpeg encoding**.

### Stage 1: Composition as HTML

A video is defined entirely as an HTML file. The key abstraction is the `data-*` attribute system:

```html
<div id="stage"
     data-composition-id="launch"
     data-start="0"
     data-width="1920"
     data-height="1080">
  <!-- Elements with data-start, data-duration, data-track-index -->
  <h1 class="clip"
      data-start="1"
      data-duration="4"
      data-track-index="1">
    Launch day
  </h1>
</div>
```

**Attribute semantics:**
| Attribute | Purpose |
|---|---|
| `data-composition-id` | Identifies the composition for timeline lookup |
| `data-start` | When this element's animation begins (seconds, relative to composition start) |
| `data-duration` | How long the animation runs (seconds) |
| `data-track-index` | Z-order layer for rendering priority |

### Stage 2: Seekable Animation via Adapters

Animations are defined as GSAP timelines (or CSS animations, Lottie, Three.js, Anime.js, WAAPI, or custom adapters). The critical pattern:

```javascript
const tl = gsap.timeline({ paused: true });
tl.from("#title", { opacity: 0, y: 40, duration: 0.8 }, 1);
window.__timelines = window.__timelines || {};
window.__timelines[compositionId] = tl;
```

The timeline is **paused** and **seekable** — it can jump to any frame timestamp and render the exact state at that moment. This is what makes the frame-by-frame rendering deterministic.

### Stage 3: Puppeteer + FFmpeg Rendering

The rendering engine (`@hyperframes/engine`) works as follows:

1. **Launch headless Chrome** (via Puppeteer)
2. **Load the HTML composition** in the browser
3. **For each frame** of the desired video:
   a. Calculate the target timestamp (`frameIndex / fps`)
   b. **Seek** each GSAP timeline to that timestamp
   c. **Screenshot** the rendered DOM at that frame
4. **Pipe frames to FFmpeg** for encoding into an MP4

```
index.html ─→ Puppeteer (headless Chrome) ─→ frame screenshots ─→ FFmpeg ─→ output.mp4
                  │                                    │
            seek timelines                          H.264 encode
            capture DOM
```

**Determinism guarantee:** Because timelines are seekable and the DOM state is fully determined by the timestamp, the same HTML input always produces the same MP4 output. This is critical for agent reliability and CI regression testing.

### The Producer Pipeline

The `@hyperframes/producer` package orchestrates the full pipeline:

1. Parse compositions from HTML (validate `data-*` attributes)
2. Drive headless Chrome for each composition
3. Capture frames at the target resolution (1920×1080, etc.)
4. Mix audio tracks (specified via `<audio>` elements with `data-*` timing)
5. Encode to H.264/H.265 via FFmpeg with configurable bitrate

---

## 3. Evaluation for Hermes: Pros and Cons

### Pros for Hermes Integration

**A. HTML-as-intermediate-representation alignment**
Hermes agents already produce structured text output (JSON, markdown, YAML). HTML is just another structured markup language that agents understand natively. The HTML-as-IR pattern is a natural extension of what Hermes already does well.

**B. Deterministic video output**
Same input HTML → same video. This eliminates the stochasticity that plagues generative video models (Runway, Sora). For research summaries and session recaps, determinism means agents can reliably produce videos they've validated.

**C. No ML inference cost per video**
HyperFrames renders via browser + FFmpeg — no GPU inference, no per-frame token cost. A 60-second video costs roughly: Chrome startup (~500MB RAM) + FFmpeg encode (CPU). This is orders of magnitude cheaper than generative video models.

**D. Fine-grained control over visuals**
Agents can control typography, color, layout, animations, transitions, and overlays at the CSS level. Every pixel is deterministic. This is valuable for branded content (LatentSpace branding) and data visualizations.

**E. Rich ecosystem of animation libraries**
GSAP, CSS animations, Lottie, Three.js, Anime.js, WAAPI — agents can pick the right tool for the animation. GSAP timelines are particularly powerful for complex choreography.

**F. Existing skill-based onboarding**
HyperFrames' `SKILL.md` files teach the full production loop. A `video-renderer` skill for Hermes would follow this pattern: agents learn to create, preview, lint, and render videos via the CLI.

**G. MCP server integration**
HyperFrames has an MCP server for agent-driven rendering. This could integrate directly into Hermes' MCP infrastructure for on-demand video generation.

**H. Catalog of reusable blocks**
Pre-built transitions, overlays, captions, charts, and maps reduce the amount of HTML agents need to write from scratch. `npx hyperframes add data-chart` gives an animated chart component.

### Cons / Challenges

**A. Node.js 22+ requirement**
Hermes environments need Node.js 22+. If older runtimes are used, a container or version bump is needed.

**B. FFmpeg dependency**
FFmpeg must be installed in the rendering environment. This adds to the dependency surface. Alpine-based images with `ffmpeg` are small (~15MB compressed) but require careful packaging.

**C. Headless Chrome memory footprint**
Chrome consumes ~500MB+ RAM per instance. For batch rendering or concurrent renders, resource management matters. The AWS Lambda renderer addresses this with distributed rendering.

**D. Animation complexity ceiling**
HyperFrames is excellent for 2D animations, charts, overlays, and text animations. Complex 3D scenes, particle effects, and physics-based animations are harder to achieve (though Three.js support helps). For a research-summary video, this is likely sufficient.

**E. No built-in audio synthesis**
HyperFrames handles audio playback from files but doesn't synthesize voice. For narrated videos, Hermes would need to generate audio separately (e.g., via a TTS tool) and reference it via `<audio src="...">`.

**F. Render time**
A 60-second video at 30fps = 1,800 frames. Each frame requires a Chrome DOM query + screenshot. Typical render time is 2-10 seconds per second of video on modern hardware (3-10x real-time). Not instant, but acceptable for async video generation.

**G. No built-in style transfer**
Unlike generative video models, HyperFrames doesn't have a "style" parameter. Agents must specify all visual properties explicitly in CSS. This is a pro for determinism but a con for "prompt-to-video" simplicity.

**H. Learning curve for complex animations**
While basic fade-ins are trivial, complex multi-track choreography requires understanding GSAP timelines, track indices, and data attributes. Skills mitigate this for agents, but human operators may need guidance.

### Verdict

**HyperFrames is a strong fit for Hermes' video output needs.** The HTML-as-IR pattern aligns with Hermes' existing structured-output paradigms, the deterministic rendering eliminates stochasticity, and the render cost is minimal. The main gap is audio synthesis, which can be bridged by combining HyperFrames with a TTS tool.

**Recommended use cases for Hermes:**
- Session recap videos (chronological summaries of agent sessions)
- Research topic explainer videos (key findings with citations)
- Code walkthrough videos (animated diffs with narration)
- Data visualization videos (chart races, trend animations)
- Branded social media content (consistent LatentSpace branding)

---

## 4. HTML-as-IR Pattern Documentation

### Definition

The **HTML-as-IR (Intermediate Representation)** pattern treats HTML as a machine-readable, deterministic intermediate format between an agent's reasoning output and a final rendered artifact (video, PDF, image, presentation).

### Pattern Structure

```
Agent reasoning → [HTML composition] → Renderer → Final artifact
                   (structured output)     (deterministic)  (MP4/PDF/PNG)
```

### Key Properties

1. **Structured markup:** HTML is a well-defined, parseable format. Agents can produce it via structured output (JSON-to-HTML templates or direct HTML generation).

2. **Separation of concerns:** Content (HTML text), style (CSS), and behavior (JS/GSAP) are separable — each is a well-understood domain for agents.

3. **Human-readable:** Unlike binary video formats, HTML compositions are readable, editable, and debuggable by both humans and agents.

4. **Deterministic:** Given the same HTML file and renderer version, the output is identical. This enables regression testing and reproducibility.

5. **Composable:** HTML compositions can reference external assets (images, videos, audio, fonts) and be nested or combined.

6. **Tool-chain friendly:** HTML is the universal markup format — it renders in browsers, can be styled with CSS preprocessors, animated with JS libraries, and captured by headless browsers.

### Data Attribute Convention

HyperFrames extends HTML with `data-*` attributes to encode temporal information:

```html
<element data-start="N" data-duration="N" data-track-index="N">
```

This is the **temporal IR** — a declarative specification of when things happen, which the renderer interprets as a timeline. The renderer transforms declarative temporal specs into imperative frame-by-frame rendering.

### Variations

| Pattern | IR Format | Renderer | Output |
|---|---|---|---|
| **HyperFrames** | HTML + `data-*` | Puppeteer + FFmpeg | MP4 video |
| **Remotion** | React JSX | Puppeteer + FFmpeg | MP4 video |
| **Puppeteer PDF** | HTML + CSS | Puppeteer | PDF |
| **Playwright snapshots** | HTML + CSS | Playwright | PNG screenshots |
| **Reveal.js → PDF** | HTML + CSS | Browser | PDF presentation |

### Benefits for Agent Workflows

1. **Single artifact, multiple outputs:** One HTML composition can produce video, screenshots, and PDFs.
2. **Iterative refinement:** Agents can preview HTML in the browser, fix issues, and re-render without re-generating from scratch.
3. **Version control:** HTML files are diffable. Git commits capture video composition changes precisely.
4. **Skill-based authoring:** Skills teach agents the HTML patterns for specific video types (charts, transitions, overlays).
5. **Asset pipeline:** HTML references external assets (images, audio) that can be generated by other agent pipelines.

---

## 5. Implementation Sketch for Hermes Integration

### Architecture

```
┌─────────────────────────────────────────────────┐
│                  Hermes Agent                    │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Session   │  │ Research │  │ Summary      │  │
│  │ Recorder  │  │ Topic    │  │ Generator    │  │
│  └────┬──────┘  └────┬─────┘  └──────┬───────┘  │
│       │              │               │           │
│       ▼              ▼               ▼           │
│  ┌──────────────────────────────────────────┐   │
│  │         video-renderer Skill              │   │
│  │  1. Generate HTML composition            │   │
│  │  2. Wire GSAP animations                 │   │
│  │  3. Preview (browser or headless)        │   │
│  │  4. Render → MP4                         │   │
│  │  5. Attach to session/research issue     │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │         TTS Skill (parallel)              │   │
│  │  Generate narration audio                │   │
│  │  → audio/narration.wav                   │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│            Render Environment                    │
│  Node.js 22+ │ FFmpeg │ headless Chrome         │
│  HyperFrames CLI: npx hyperframes render         │
└─────────────────────────────────────────────────┘
```

### Step-by-Step Integration

#### Step 1: Create the `video-renderer` Skill

```markdown
# video-renderer Skill (for ~/.hermes/skills/video-renderer/)

## Capability
Render MP4 videos from HTML compositions using HyperFrames.

## Commands
- `hyperframes init <name>` — scaffold a new video project
- `hyperframes preview` — preview in browser with live reload
- `hyperframes render` — render composition to MP4

## Production Loop
1. Generate HTML composition with data-* attributes for timing
2. Add GSAP timeline for animations
3. Run `hyperframes preview` to verify
4. Run `hyperframes render` to produce output.mp4
5. Attach video to the relevant issue/session

## Templates
- Session recap: chronological events with timestamps
- Research summary: key findings with citations
- Code walkthrough: animated diffs with narration
```

#### Step 2: HTML Composition Generator

The agent generates HTML compositions programmatically:

```javascript
// Example: Session recap composition
function generateSessionRecapHTML(session) {
  const events = session.events.map((e, i) => `
    <div class="event" data-start="${i * 2}" data-duration="2" data-track-index="1">
      <div class="time">${formatTime(e.timestamp)}</div>
      <div class="action">${escapeHtml(e.action)}</div>
    </div>
  `).join('');

  return `
    <div id="stage" data-composition-id="recap" data-width="1920" data-height="1080">
      <style>
        /* LatentSpace branded styles */
        #stage { background: #0a0a0f; color: #fff; font-family: sans-serif; }
        .event { opacity: 0; }
      </style>
      <h1 data-start="0" data-duration="3" data-track-index="0">Session Recap</h1>
      ${events}
      <script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
      <script>
        const tl = gsap.timeline({ paused: true });
        tl.to(".event", { opacity: 1, y: 0, stagger: 0.1, duration: 0.5 });
        window.__timelines = window.__timelines || {};
        window.__timelines.recap = tl;
      </script>
    </div>
  `;
}
```

#### Step 3: Render Pipeline

```javascript
async function renderVideo(compositionPath, outputMp4) {
  // Option A: CLI wrapper
  const { execSync } = require('child_process');
  execSync(`npx hyperframes render ${compositionPath}`, {
    stdio: 'inherit'
  });
  return outputMp4;

  // Option B: Programmatic via @hyperframes/producer
  // const { Producer } = require('@hyperframes/producer');
  // const producer = new Producer();
  // await producer.render(compositionPath, { output: outputMp4 });
}
```

#### Step 4: Integration with Hermes Session Flow

```
1. Session ends
   → SessionRecorder detects completion

2. Generate HTML composition
   → Extract session events, create composition HTML

3. (Optional) Generate narration audio
   → TTS Skill → audio/narration.wav
   → Insert <audio src="narration.wav"> into composition

4. Render video
   → HyperFrames CLI → output/session-recap.mp4

5. Attach to session issue
   → mcp_linear_save_issue: attach video as attachment
   → Update session description with video link
```

#### Step 5: Docker/Container Setup

```dockerfile
FROM node:22-alpine

# Install dependencies
RUN apk add --no-cache ffmpeg git-lfs
RUN npm install -g hyperframes

# Clone repo for catalog blocks (optional)
RUN GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 \
    https://github.com/heygen-com/hyperframes.git /hyperframes

WORKDIR /workspace
CMD ["hyperframes", "render", "composition/index.html"]
```

### Configuration

```yaml
# ~/.hermes/config/video-renderer.yaml
video-renderer:
  engine: hyperframes
  resolution: { width: 1920, height: 1080 }
  fps: 30
  output_format: mp4
  codec: h264
  bitrate: "8M"
  default_duration: 60  # seconds, max per render
  max_concurrent_renders: 2
  render_timeout: 300  # seconds
  asset_cache: ~/.hermes/cache/video-assets/
  default_templates:
    - session-recap
    - research-summary
    - code-walkthrough
```

### Example: End-to-End Session

```
Agent: "Let me render a video summary of this session."
  → Generates session-recap.html with 10 events
  → Generates narration.wav via TTS
  → Adds <audio src="narration.wav"> to composition
  → Runs `npx hyperframes render`
  → Gets output.mp4 (30s video, 28MB)
  → Attaches to LAT-XXX issue
  → Posts comment: "Session video summary: [link]"
```

### Monitoring and Metrics

Track render performance:
- Render duration vs. real-time factor
- Composition complexity (number of elements, tracks)
- Error rates (invalid HTML, missing assets, render failures)
- Storage usage (MP4 file sizes)

---

## References

1. [HyperFrames GitHub](https://github.com/heygen-com/hyperframes)
2. [HyperFrames Documentation](https://hyperframes.heygen.com/introduction)
3. [Quickstart Guide](https://hyperframes.heygen.com/quickstart)
4. [GSAP Animation Guide](https://hyperframes.heygen.com/guides/gsap-animation)
5. [HyperFrames vs Remotion](https://hyperframes.heygen.com/guides/hyperframes-vs-remotion)
6. [AWS Lambda Rendering](https://hyperframes.heygen.com/deploy/aws-lambda)
7. [Catalog - Data Chart Block](https://hyperframes.heygen.com/catalog/blocks/data-chart)
8. [frame.md Design Templates](https://www.hyperframes.dev/design)
9. [Community Playground](https://www.hyperframes.dev/)
10. [Discord](https://discord.gg/EbK98HBPdk)

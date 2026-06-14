---
id: ADR-0025
title: Unity-first PCVR v1 stack
status: proposed
date: 2026-06-14
decision_makers:
  - Ben Elliott
related_linear:
  - LAT-146
supersedes:
superseded_by:
revisit_trigger: >-
  If Unity's avatar system cannot support 5+ curated wearable slots per
  avatar without custom tech, or if play-test feedback shows the visual
  fidelity gap to Unreal is a dealbreaker for the core loop, revisit Unreal
  for a v2 rewrite.
---

# ADR-0025: Unity-first PCVR v1 stack

> File name: `vault/adr/unity-first-pcvr-v1-stack.md` — decision on the v1
> engine, platform, and toolchain strategy.

## Context

The AI Social Sandbox MMO Discovery project needs a v1 prototype: a PCVR
roomscale social space with 2–4 networked avatars, fast iteration, and
curated wearable/prop content. The goal is to validate the core loop (avatars
meeting, interacting, AI-assisted scene generation) before investing in
high-fidelity visuals or a multi-engine strategy.

Key constraints:

- Side project: iteration speed > polish.
- Buy-over-build wherever possible (prebuilt tools beat custom systems).
- Lots of wearable items and avatar customization matter.
- No open user-generated content (UGC) in the MVP; curated wearables and props only.
- Unreal is desired for realistic visuals but can be deferred if Unity
  proves the loop.

Research was conducted on VR interaction toolkits (XRI, MISDK, Auto Hand),
avatar systems (VRM/UniVRM, VRoid, UMA), networking (Fish-Networking,
Photon Fusion, NGO), AI asset generation (Meshy, Tripo), voice (Vivux), and
lighting/shaders. See the research hub for full evidence and source links.

## Decision Drivers

1. **Iteration speed** — The prototype must turn a design idea into a playable
   room in minutes, not hours. Every hour spent writing custom systems is an
   hour not spent validating the social loop.
2. **Buy-over-build** — Prebuilt tools that reduce art, interaction, avatar,
   or networking work should be bought immediately. Build only what no tool
   covers.
3. **Open ecosystem** — No vendor lock-in on the core engine; the VR
   interaction layer should work on SteamVR, Index, Vive, Quest, Pico.
4. **Avatar-first** — Wearable slots and avatar customization are core to the
   experience. The avatar pipeline must handle multiple items per avatar
   without custom tech.
5. **Curated content** — MVP uses curated wearables/props, not open UGC. This
   reduces pipeline complexity while keeping content quality high.

## Considered Options

1. **Unity-first (chosen)** — Unity 2022.3+ LTS with XRI, VRM/UniVRM,
   Fish-Networking, Vivux for voice, Meshy/Tripo for AI props. Unreal kept
   on the horizon for a potential v2 realism pass.
2. **Unreal-first** — UE5 with VR templates, Niagara for effects,
   multiplayer via Replication Graph or Chaos. Slower iteration for a side
   project but potentially higher visual fidelity out of the box.
3. **Dual-engine (both v1)** — Unity for prototype + Unreal for a parallel
   build. Maximum flexibility but doubles engineering effort.

## Decision

**Chosen: Option 1 — Unity-first PCVR v1.**

### Engine and runtime

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Engine | Unity 2022.3+ LTS | Stable, well-documented, large ecosystem |
| Render pipeline | URP | Good balance of visuals and performance for VR |
| VR interaction | XR Interaction Toolkit (XRI) | Free, open, no vendor lock-in, excellent docs |
| Hand models | Auto Hand (~$55 one-time) | Best-in-class skeletal hands; defer if hand quality is not a v1 differentiator |
| Avatar format | VRM 1.0 + UniVRM | Standard VR avatar format, MIT licensed |
| Avatar creation | VRoid Studio | Free, drag-and-drop, outputs VRM directly |
| Animations | Mixamo (free) | 500+ auto-rigged animations |
| Networking | Fish-Networking (free) | Clean API, lightweight, great for 2–4 CCU rooms |
| Voice | Unity Voice / Vivux (free tier, 1K MAU) | Proximity chat built into Unity |
| AI props | Meshy / Tripo (free tier) | Text/image-to-3D for rapid prop generation |
| Shaders | Shader Graph (free) + Amplify Shader Editor (~$25) | Visual shader creation for custom materials |
| Placeholder assets | Polygon Toolkit / Kenney (free, CC0) | 300+ free low-poly models for rapid room setup |
| Camera | Cinemachine (free, built-in) | Professional VR camera management |
| Text UI | TextMeshPro (free, built-in) | Superior text rendering for VR UI |

### Platform target

- **PCVR (roomscale)** as v1 target. OpenXR abstraction ensures the same
  codebase can target Quest later if needed.

### UGC policy

- **No open UGC in MVP.** All wearables and props are curated by the team.
- Rationale: reduces pipeline complexity, ensures quality, and validates the
  core social loop before adding UGC tooling (export, upload, moderation,
  runtime loading).
- UGC becomes a v2 consideration if the curated MVP proves successful.

### Unreal strategy

- **Deferred, not abandoned.** Unreal is kept as a later realism target if:
  - The Unity loop proves valuable but visual fidelity becomes a bottleneck.
  - Play-test feedback shows the core loop is strong but Unity's visuals
    hold players back.
  - Unreal-specific features (e.g., MetaHuman avatars, Nanite LODs,
    Lumen GI) become critical differentiators.
- Unreal does not block Unity development; the two are independent.

## Buy / Build Rules

### Buy immediately (v1 essentials)

- Unity XR Interaction Toolkit (free)
- UniVRM (free)
- VRoid Studio (free)
- Mixamo (free)
- Fish-Networking (free)
- Unity Voice / Vivux (free tier)
- Shader Graph (free)
- Polygon Toolkit / Kenney (free)
- TextMeshPro (free)
- Cinemachine (free)

### Buy soon (v1 nice-to-have, under $100)

- Auto Hand (~$55) — if hand interactions are visible/social in the prototype
- Amplify Shader Editor (~$25) — if custom materials are needed beyond Shader Graph
- Amplify Impostors (~$25) — if many complex props/models need VR optimization

### Buy later (v2 or scale)

- UMA — if runtime avatar creation is needed
- Photon Fusion — if Fish-Networking hits limits (20+ CCU, built-in matchmaking)
- Nakama — if a full backend (chat, leaderboards, storage) is needed
- Meshy Creator / Tripo Pro — if >100 AI assets/month are generated
- Rokoko Pro (~$15/mo) — if webcam mocap quality is needed

### Build (custom systems)

- Curated wearable/prop catalog system (VRM slot-based, no open UGC)
- AI-assisted scene assembly pipeline (connects AI asset generation to
  Unity scene building)
- Custom avatar item swap logic (if VRM's built-in secondary bone system
  cannot handle the required number of slots per avatar)

### Do not buy / build for v1

- Hurricane VR (XRI + Auto Hand is better)
- MISDK (XRI is more flexible; MISDK if pivoting to Quest-only)
- Netcode for GameObjects (Fish-Networking is cleaner for v1)
- Nakama (overkill for v1)
- Luma AI / Kaiber (Meshy + Tripo cover the same needs)

## Exit Criteria for Revisiting Unreal

The Unreal option should be reconsidered if any of the following conditions
are met after the Unity prototype reaches a playable state:

1. **Visual fidelity gap** — Play-test feedback consistently rates Unity's
   visuals below Unreal's, and the core social loop is strong enough that
   visuals become the limiting factor.
2. **Avatar system limit** — Unity's avatar pipeline (VRM/UniVRM) cannot
   support 5+ curated wearable slots per avatar without custom tech that
   takes >1 week to implement.
3. **Iteration speed parity** — Unreal's toolchain (Blueprints, Marketplace
   assets, MetaHumans) achieves iteration speed comparable to Unity for the
   same feature set.
4. **Content moat** — Unreal-exclusive assets or systems (e.g., MetaHuman,
   Nanite) provide a content advantage that cannot be matched in Unity at
   acceptable cost.

If two or more criteria are met, a v2 Unreal port is warranted. If only one
is met, evaluate whether the gap is worth a full rewrite.

## Consequences

### Good

- **Fast iteration** — A playable PCVR room can be assembled from prebuilt
  XR pieces in under an hour.
- **Low cost** — v1 budget is $0–$100 (mostly free tools, optional ~$55 for
  Auto Hand).
- **No vendor lock-in** — XRI works on all OpenXR platforms. Unity can
  target Quest, Pico, SteamVR from the same codebase.
- **Clear upgrade path** — Unreal is deferred, not replaced. The decision
  to adopt it later has explicit exit criteria.
- **Curated quality** — No open UGC means higher content quality and simpler
  pipeline for v1.

### Bad / open

- **Unreal defer risk** — If the Unity prototype validates the loop but
  visuals feel dated, a v2 Unreal port adds cost and time.
- **Avatar slot limit** — VRM's built-in slot system may require custom
  tech for complex wardrobe systems (5+ items per avatar).
- **PCVR only** — Mobile VR (Quest) is not the v1 target; requires
  additional testing effort if pivoting later.
- **Fish-Networking scale limit** — If the prototype exceeds 4–8 players
  per room, migration to Photon Fusion may be needed.

## Confirmation

This decision is working if:

- A playable PCVR room with 2 networked avatars is assembled in ≤2 hours
  from prebuilt pieces.
- Avatar wearables can be swapped in real-time without reloading scenes.
- AI-generated props can be imported and validated in ≤10 minutes per asset.
- The team spends <80% of dev time on infrastructure and >20% on validating
  the social loop.

Signal to revisit Unreal: play-test feedback consistently identifies visual
fidelity as the #1 improvement needed, or the avatar system requires >1 week
of custom development to support 5+ wearable slots.

## Links

- **Research hub:** [Unity PCVR v1 research hub](https://linear.app/latentspacelabs/document/unity-pcvr-v1-research-hub-193ea046dfe7)
- **VR toolkit comparison:** `vr-toolkit-comparison.md` (worktree root)
- **Buy-over-build shortlist:** `buy-over-build-shortlist.md` (worktree root)
- **Linear issue:** [LAT-146](https://linear.app/latentspacelabs/issue/LAT-146/adr-unity-first-pcvr-v1-stack-for-ai-assisted-social-sandbox)
- **Related ADRs:** [ADR-0002](../docs/decisions/0002-store-process-docs-and-adrs-in-the-monorepo.md) (store process docs and ADRs in the monorepo)
- **Key source docs:**
  - [Unity XR Interaction Toolkit](https://docs.unity3d.com/Packages/com.unity.xr.interaction.toolkit@2.5/manual/index.html)
  - [UniVRM](https://github.com/vrm-c/UniVRM)
  - [Fish-Networking](https://fish-networking.gitbook.io/docs)
  - [Vivux Unity Voice](https://unity.com/products/voice)
  - [Meshy](https://www.meshy.ai/)
  - [Tripo3D](https://www.tripo3d.ai/)

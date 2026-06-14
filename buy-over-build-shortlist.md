# Buy-Over-Build Purchase Shortlist — Unity PCVR v1 Prototype

**Project:** AI Social Sandbox MMO Discovery (Unity-first PCVR v1)
**Scope:** Roomscale VR, 2–4 networked avatars per room, fast iteration
**Philosophy:** Buy prebuilt tools that reduce art, VR interaction, avatar, networking, or import-pipeline work. Avoid buying anything only useful after the core prototype works.

**Created:** 2026-06-14

---

## Table of Contents

1. [VR Interaction Toolkits](#1-vr-interaction-toolkits)
2. [Avatar Customization Systems](#2-avatar-customization-systems)
3. [AI-Generated Asset Pipelines](#3-ai-generated-asset-pipelines)
4. [Networking Solutions](#4-networking-solutions)
5. [Voice / In-Game Chat](#5-voice--in-game-chat)
6. [Lighting & Visuals](#6-lighting--visuals)
7. [Other Essential Tools](#7-other-essential-tools)
8. [Summary: What to Buy Right Now](#summary-what-to-buy-right-now)

---

## 1. VR Interaction Toolkits

### 1.1 Unity XR Interaction Toolkit (XRI) — MUST BUY (it's free)

| Field | Details |
|-------|---------|
| **Cost** | Free (built-in Unity package) |
| **Trial** | N/A — install from Package Manager |
| **License** | Unity Package License (MIT-like). Unity Pro subscription not required for basic features |
| **Why it accelerates iteration** | Drop-in XR Rig presets, action-based input abstraction, snap zones, proximity grabs, poke interactions, one/two-handed grabs. Works on all OpenXR platforms (SteamVR, Index, Vive, Quest, Pico). Excellent documentation with official tutorials. ~15–30 min setup. The de facto standard in the Unity VR ecosystem. |
| **Key features** | GrabInteractable, PokeInteractable, Teleportation, Ray Interactor, Gaze Interactor, Articulated Hand Pose system, configurable grab thresholds |
| **Notes** | Physics interactions require manual tuning. No built-in multiplayer integration (pair with networking solution). |

**Verdict:** The foundation. Free, well-maintained, no vendor lock-in. Install immediately.

---

### 1.2 Auto Hand — NICE TO HAVE ($55)

| Field | Details |
|-------|---------|
| **Cost** | ~$55 one-time (Asset Store) |
| **Trial** | ~$55 one-time (Asset Store) |
| **Trial** | No free trial; Asset Store refund policy allows testing with refund if unmodified |
| **License** | Asset Store EULA. Can be used in free/paid products. No per-seat fee. |
| **Why it accelerates iteration** | Best-in-class skeletal hand models with realistic finger articulation. Advanced grab system with one-handed, two-handed, snap zones, proximity grab, pinch-to-grab, throw. IK-based hand tracking support. Great grab quality out of the box, significantly better than XRI's defaults. Active Discord community, regular updates. |
| **Alternative** | Use XRI + free hand model packs (e.g., Mixamo hands) if budget is tight |

**Verdict:** Worth the $55 if hand interactions are visible/social in your prototype. The hand models save 2–3 hours of custom hand rigging per avatar. Defer if hand quality isn't a differentiator for v1.

---

### 1.3 Meta Interaction SDK (MISDK) — DEFER

| Field | Details |
|-------|---------|
| **Cost** | Free |
| **Trial** | N/A — install from Package Manager |
| **License** | Free. Requires Meta SDK dependency chain |
| **Why consider** | Best hand interaction system out of the box. Superior grab physics with spring joints and collision filtering built in. |
| **Why defer** | Optimized for Meta Quest ecosystem. PCVR support via OpenXR is good but not as battle-tested as XRI. Import/dependency management can be complex. Adds Meta-specific build requirements. |
| **When to buy** | If v1 becomes Quest-only and hand interactions become the #1 priority |

**Verdict:** Skip for now. Use XRI. If you later pivot to Quest-first, switch to MISDK.

---

### 1.4 Hurricane VR — DEFER

| Field | Details |
|-------|---------|
| **Cost** | ~$45 one-time (Asset Store) |
| **Trial** | No free trial; Asset Store refund window |
| **License** | Asset Store EULA |
| **Why consider** | Very simple drag-and-drop setup, ~10 min. Good for rapid prototyping. |
| **Why defer** | Older asset (last updated ~2022–2023). Hand tracking is basic compared to MISDK/Auto Hand. Less actively maintained. Overlaps with XRI's feature set without clear advantages for a social MMO. |

**Verdict:** Skip. XRI + Auto Hand is a better combination.

---

## 2. Avatar Customization Systems

### 2.1 VRM + UniVRM — MUST BUY (free)

| Field | Details |
|-------|---------|
| **Cost** | Free (UniVRM on GitHub/Asset Store) |
| **Trial** | N/A — open source |
| **License** | MIT License (UniVRM). VRM specification is open. |
| **Why it accelerates iteration** | VRM is the standard format for VR avatars. UniVRM (v1.0+) is actively maintained, supports humanoid rig mapping, blendshapes (facial expressions), clothing swap via VRM Secondary Bone system. Thousands of avatars available on VRoid Hub, VRChat Workshop, Sketchfab. Import pipeline: VRM file → Unity GameObject in minutes. |
| **Key features** | VRM 1.0 spec support, humanoid rig auto-mapping, blendshape animation, expression management, clothing slot system |
| **Notes** | Works with Unity 2022.3+. Requires humanoid rig on source models. Not ideal for highly stylized/non-humanoid characters. |

**Verdict:** Install immediately. Free, open-source, massive asset ecosystem. The backbone of avatar import.

---

### 2.2 VRoid Studio — MUST BUY (free)

| Field | Details |
|-------|---------|
| **Cost** | Free (Reallusion) |
| **Trial** | N/A — free download |
| **License** | Free for commercial use. Avatars exported to VRM format. |
| **Why it accelerates iteration** | Drag-and-drop avatar creator. No 3D modeling skills needed. Outputs VRM files directly (compatible with UniVRM). Huge library of hair, clothing, accessory presets. Multiple racial/ethnic preset sets included. Creates fully rigged humanoid characters with facial expressions. |
| **Key features** | Face sculpting, hair styling, clothing presets, accessory system, expression presets, VRM export |
| **Notes** | Anime/semi-realistic art style. Not photorealistic. Can export to FBX for further editing. |

**Verdict:** Install immediately. Free avatar creator that plugs directly into UniVRM. Saves 4–8 hours per custom avatar vs. building from scratch.

---

### 2.3 Mixamo (Adobe) — MUST BUY (free)

| Field | Details |
|-------|---------|
| **Cost** | Free (Adobe) |
| **Trial** | N/A — free with Adobe account |
| **License** | Free for commercial use |
| **Why it accelerates iteration** | 500+ free animations auto-rigged to any humanoid model. One-click upload → auto-rig → download with animations. Massive library of clothing/accessories that auto-rig. Essential for getting characters animated quickly. |
| **Key features** | Auto-rigger, 500+ animations, clothing/accessory library, facial animation presets |
| **Notes** | Requires humanoid rig. Some animations may need retargeting for VR-specific movements. |

**Verdict:** Install immediately. Free. Essential for getting characters animated without hiring an animator.

---

### 2.4 UMA (Unity Multi-Avatar) — DEFER

| Field | Details |
|-------|---------|
| **Cost** | Free |
| **Trial** | N/A — open source |
| **License** | MIT License |
| **Why consider** | Full runtime avatar customization. Slot-based system for clothing, body type, race. Powerful for games where players create/customize avatars in-game. |
| **Why defer** | Steep learning curve. Heavy setup. Slower iteration for a prototype. Larger package size. Better suited for later when you need in-game avatar creation. |
| **When to buy** | If v2 needs in-game avatar creation/customization system |

**Verdict:** Skip for v1. Use VRM + VRoid. If you need runtime customization later, migrate to UMA.

---

### 2.5 Rokoko Studio — NICE TO HAVE (free tier available)

| Field | Details |
|-------|---------|
| **Cost** | Free tier available. Pro: ~$15/month |
| **Trial** | Free tier with limitations. Full trial available. |
| **License** | Subscription. Free tier includes basic motion capture |
| **Why consider** | Full-body motion capture using webcam (no hardware needed in free tier). Exports BVH files compatible with UniVRM avatar animation. Can animate your custom avatars without a mocap rig. |
| **Key features** | Webcam mocap, finger mocap (Pro), BVH export, animation library, auto-retargeting |
| **Notes** | Free tier has limited features. Pro unlocks finger tracking and higher quality. |

**Verdict:** Try the free tier. If quality is sufficient, keep it. If not, upgrade to Pro at $15/month. Great value for a side project.

---

## 3. AI-Generated Asset Pipelines

### 3.1 Meshy — NICE TO HAVE

| Field | Details |
|-------|---------|
| **Cost** | Free tier: ~100 credits/month. Paid: $29/month (Creator plan) |
| **Trial** | Free tier with 100 credits/month |
| **License** | Standard SaaS. Assets can be used in commercial products |
| **Why it accelerates iteration** | Text-to-3D and image-to-3D. Generates game-ready 3D models (OBJ/FBX) with PBR textures. Direct Unity plugin available. Great for props, weapons, furniture, accessories. 5–10 minutes per asset vs. hours of manual modeling. |
| **Key features** | Text-to-3D, image-to-3D, Unity plugin, OBJ/FBX export, PBR textures, UV unwrapped models |
| **Notes** | Quality varies by prompt. Best for props and accessories, less reliable for characters. Free tier sufficient for v1 prototype. |

**Verdict:** Use the free tier for v1. Upgrade to Creator if you generate >100 assets/month. Critical for rapid prototyping of room props and accessories.

---

### 3.2 Tripo AI — NICE TO HAVE

| Field | Details |
|-------|---------|
| **Cost** | Free tier: ~200 credits/month. Paid: $29/month (Pro) |
| **Trial** | Free tier available |
| **License** | Standard SaaS |
| **Why consider** | Faster generation than Meshy for simple shapes. Image-to-3D quality is competitive. Unity plugin available. Good for quick prop generation when you need many items fast. |
| **Key features** | Text-to-3D, image-to-3D, Unity plugin, OBJ/FBX export |
| **Notes** | Sometimes generates cleaner meshes than Meshy for simple objects. Try both and use whichever is better per asset type. |

**Verdict:** Use free tier alongside Meshy. Don't pay for both — pick whichever produces better assets for your use case.

---

### 3.3 Luma AI (Genie) — DEFER

| Field | Details |
|-------|---------|
| **Cost** | Free tier available. Paid: ~$19/month |
| **Trial** | Free tier with limited generations |
| **Why consider** | Fast text-to-3D. Good for architectural props and environments. |
| **Why defer** | Meshy and Tripo cover the same use case better for Unity. Luma's strength is in video-to-3D (which is overkill for v1). |
| **When to buy** | If you need video-to-3D or photogrammetry integration |

**Verdict:** Skip for v1. Meshy + Tripo cover the same needs.

---

### 3.4 Kaiber — DEFER

| Field | Details |
|-------|---------|
| **Cost** | Free trial. Paid: $11/month (Starter) |
| **Trial** | Free trial available |
| **Why consider** | AI-generated textures, materials, and 2D art. Good for environmental art. |
| **Why defer** | More useful for 2D art direction than for 3D asset pipelines. Can be replaced with Midjourney + texture generators. |
| **When to buy** | If you need AI-generated environmental textures or concept art |

**Verdict:** Skip for v1. Use Midjourney/DALL-E for textures if needed.

---

## 4. Networking Solutions

### 4.1 Fish-Networking — MUST BUY (free)

| Field | Details |
|-------|---------|
| **Cost** | Free (Asset Store) |
| **Trial** | N/A — free |
| **License** | MIT License. Open source. |
| **Why it accelerates iteration** | Lightweight, modern, clean API. Works well with Unity's new input system. Built on top of Fish-Networking's custom transport layer (but pluggable). Excellent documentation. Handles 2–4 CCU easily. Simple RPC system, state synchronization, spawn management. Low overhead, no vendor lock-in. |
| **Key features** | Client/Server architecture, RPCs, state sync, spawn system, transport abstraction, Unity UI integration |
| **Notes** | Smaller community than Photon but growing rapidly. Best for smaller-scale multiplayer (2–16 players per room). |

**Verdict:** Install immediately. Free, open-source, clean API. Perfect for 2–4 avatar roomscale multiplayer.

---

### 4.2 Photon Fusion — NICE TO HAVE ($200/month if scaling)

| Field | Details |
|-------|---------|
| **Cost** | Free up to 20 CCU. Paid: $200/month (Starter) |
| **Trial** | Free tier: up to 20 concurrent users, unlimited rooms |
| **License** | Photon EULA. No revenue cap on free tier. |
| **Why consider** | Industry-standard Unity networking. Excellent reliability, built-in matchmaking, room management, lag compensation. Photon Fusion 2 is the latest iteration. Battle-tested in hundreds of published games. |
| **Key features** | Client/Server + Client prediction, lag compensation, built-in matchmaking, room management, state authority, snapshot replication |
| **Notes** | Free tier generous for v1 (20 CCU). At $200/month Starter plan, it's pricier than Fish-Networking but more robust for scaling. |

**Verdict:** Start with Fish-Networking (free). Migrate to Photon Fusion if you hit limits or want built-in matchmaking. Free tier of Photon is worth keeping in your back pocket.

---

### 4.3 Nakama (Heroic Labs) — DEFER

| Field | Details |
|-------|---------|
| **Cost** | Free tier: up to 1,000 MAU. Paid: custom pricing |
| **Trial** | Free tier available |
| **License** | Apache 2.0 (open source). Cloud hosting available. |
| **Why consider** | Full backend solution: multiplayer, chat, leaderboards, sessions, storage. Self-hostable. |
| **Why defer** | Overkill for v1 (2–4 players per room). More ops overhead than Photon or Fish-Networking. Worth it when you need a full backend, not just networking. |
| **When to buy** | If v2 needs chat, leaderboards, social features, and a full backend |

**Verdict:** Skip for v1. Revisit if you need a full backend solution.

---

### 4.4 Netcode for GameObjects (NGO) — DEFER

| Field | Details |
|-------|---------|
| **Cost** | Free (Unity) |
| **Trial** | N/A — built-in Unity package |
| **License** | Unity Package License |
| **Why consider** | Official Unity networking. Tightly integrated with Unity ecosystem. |
| **Why defer** | Still maturing. Smaller community than Photon/Mirror. Fish-Networking has a cleaner API and better docs for small-scale multiplayer. |
| **When to buy** | If Unity's ecosystem converges around NGO |

**Verdict:** Skip for v1. Fish-Networking is the better choice.

---

## 5. Voice / In-Game Chat

### 5.1 Unity Voice (Vivox) — MUST BUY (free tier)

| Field | Details |
|-------|---------|
| **Cost** | Free up to 1,000 MAU. Paid: $0.004/min of voice usage |
| **Trial** | Free tier: 1,000 MAU, no credit card required |
| **License** | Unity Voice EULA. Integrated as Unity package |
| **Why it accelerates iteration** | Built directly into Unity. Drop-in Voice Chat component. Supports proximity chat, team chat, push-to-talk. Works with XRI hand tracking (voice activation). No external dependencies. Handles NAT traversal, echo cancellation, noise suppression. |
| **Key features** | Proximity chat, team chat, push-to-talk, voice activation, NAT traversal, echo cancellation |
| **Notes** | Free tier is extremely generous for v1 (1,000 MAU). At $0.004/min, even heavy usage is cheap. |

**Verdict:** Install immediately. Free tier covers v1. Critical for social VR experience.

---

### 5.2 Discord Voice SDK — DEFER

| Field | Details |
|-------|---------|
| **Cost** | Free |
| **Trial** | N/A — free |
| **License** | Discord EULA |
| **Why consider** | High-quality voice chat. Built-in overlay, push-to-talk UI. |
| **Why defer** | Requires Discord app running. Adds dependency. Better suited for web/browser VR than native PCVR. |
| **When to buy** | If you want Discord integration for voice chat |

**Verdict:** Skip for v1. Vivox is more integrated with Unity/VR.

---

## 6. Lighting & Visuals

### 6.1 Amplify Shader Editor — MUST BUY ($25)

| Field | Details |
|-------|---------|
| **Cost** | $25 one-time (Asset Store) |
| **Trial** | No free trial; Asset Store refund window |
| **License** | Asset Store EULA. Perpetual license. |
| **Why it accelerates iteration** | Visual node-based shader editor. Much faster than writing shader code. Essential for custom VR materials (holographic, translucent, glowing). Thousands of community presets. Integrates with Unity's SRP/HDRP/Built-in. |
| **Key features** | Node-based shader creation, visual debugging, community presets, HDRP/URP/Built-in support |
| **Notes** | Steeper learning curve than Shader Graph but far more powerful. |

**Verdict:** Worth $25 if you need custom materials. Shader Graph (free) is good for basic stuff, ASE covers everything else.

---

### 6.2 Unity Shader Graph (URP) — MUST BUY (free)

| Field | Details |
|-------|---------|
| **Cost** | Free (URP package) |
| **Trial** | N/A — built-in |
| **License** | Unity Package License |
| **Why it accelerates iteration** | Visual node-based shader creation. Built into Unity. Good for basic materials, PBR shaders, simple effects. |
| **Key features** | Node-based shader creation, URP/HDRP support, real-time preview |
| **Notes** | Limitations vs. Amplify Shader Editor. Use for basic needs, ASE for advanced. |

**Verdict:** Install immediately with URP. Free foundation.

---

### 6.3 Enlighten — NICE TO HAVE (built-in)

| Field | Details |
|-------|---------|
| **Cost** | Free (built into Unity Builtin Render Pipeline) |
| **Trial** | N/A — built-in |
| **License** | Unity Package License |
| **Why consider** | Real-time global illumination. Auto-bakes at runtime. Good for dynamic environments. |
| **Notes** | Builtin Render Pipeline only (not URP/HDRP). URP uses GPU-based GI. HDRP has its own GI system. |

**Verdict:** Depends on render pipeline choice. If using Built-in RP, enable Enlighten. If using URP/HDRP, use their native GI.

---

### 6.4 Amplify Impostors — NICE TO HAVE ($25)

| Field | Details |
|-------|---------|
| **Cost** | $25 one-time (Asset Store) |
| **Trial** | No free trial; Asset Store refund window |
| **License** | Asset Store EULA |
| **Why consider** | Auto-generates impostor textures (billboard sprites) from 3D models. Dramatically reduces draw calls for complex props/avatars. Essential for VR performance with many objects. |
| **Key features** | Auto-impostor generation, LOD management, VR optimization |

**Verdict:** Worth $25 if you have many complex props/models. VR performance is critical for 2–4 avatars + environment.

---

## 7. Other Essential Tools

### 7.1 Mirror Networking — DEFER

| Field | Details |
|-------|---------|
| **Cost** | Free (Asset Store) |
| **Trial** | N/A — free |
| **License** | MIT License |
| **Why consider** | Mature, battle-tested. Large community. Works with XRI. |
| **Why defer** | Fish-Networking is newer and cleaner. Mirror hasn't had major updates recently. |
| **When to buy** | If you prefer Mirror's API or need specific Mirror features |

**Verdict:** Skip for v1. Fish-Networking is the better modern choice.

---

### 7.2 Polygon Toolkit (free) / Kenney.nl assets — MUST BUY (free)

| Field | Details |
|-------|---------|
| **Cost** | Free (CC0 / CC-BY 3.0) |
| **Trial** | N/A — free |
| **License** | CC0 (no attribution) or CC-BY 3.0 (attribution required) |
| **Why it accelerates iteration** | 300+ free low-poly 3D models: furniture, props, vehicles, environment pieces. Instantly populate your VR room. Kenney.nl has thousands of free game assets across all categories. |
| **Key features** | Low-poly models, PBR materials, UV unwrapped, ready-to-import |
| **Notes** | Art style is stylized/low-poly. Fine for v1 prototype. Can be enhanced with AI textures from Meshy. |

**Verdict:** Install immediately. Free. Essential for rapid room prototyping.

---

### 7.3 TextMeshPro — MUST BUY (free)

| Field | Details |
|-------|---------|
| **Cost** | Free (built-in Unity) |
| **Trial** | N/A — built-in |
| **License** | Unity Package License |
| **Why it accelerates iteration** | Superior text rendering for Unity. Essential for UI, chat bubbles, labels, names above avatars. |
| **Notes** | Install from Package Manager if not pre-installed. |

**Verdict:** Install immediately. Every Unity project needs it.

---

### 7.4 Cinemachine — MUST BUY (free)

| Field | Details |
|-------|---------|
| **Cost** | Free (built-in Unity) |
| **Trial** | N/A — built-in |
| **License** | Unity Package License |
| **Why it accelerates iteration** | Professional camera system. Essential for VR camera management, cuts, transitions, post-processing. |
| **Notes** | Install from Package Manager. |

**Verdict:** Install immediately. Critical for VR camera work.

---

## Summary: What to Buy Right Now

### MUST BUY (Total: ~$50)

| Tool | Cost | Priority |
|------|------|----------|
| **Unity XR Interaction Toolkit** | Free | 1 — Foundation |
| **UniVRM** | Free | 1 — Avatar import |
| **VRoid Studio** | Free | 1 — Avatar creation |
| **Mixamo** | Free | 1 — Animation library |
| **Fish-Networking** | Free | 1 — Networking |
| **Unity Voice (Vivox)** | Free (1K MAU) | 1 — Voice chat |
| **Shader Graph (URP)** | Free | 1 — Basic shaders |
| **Polygon Toolkit / Kenney** | Free | 1 — Placeholder assets |
| **TextMeshPro** | Free | 1 — UI text |
| **Cinemachine** | Free | 1 — Camera system |
| **Auto Hand** | ~$55 | 2 — Hand models (if visible) |
| **Amplify Shader Editor** | ~$25 | 3 — Advanced shaders |
| **Amplify Impostors** | ~$25 | 3 — VR performance |

### NICE TO HAVE (Try first, buy if needed)

| Tool | Cost | Reason to upgrade |
|------|------|-------------------|
| **Meshy** | Free tier → $29/mo | >100 AI-generated assets/month |
| **Tripo AI** | Free tier → $29/mo | Faster generation for simple shapes |
| **Rokoko Studio** | Free tier → $15/mo | Webcam mocap quality needed |
| **Photon Fusion** | Free to $200/mo | Need built-in matchmaking, scaling past 20 CCU |

### DEFER (Buy after core prototype works)

| Tool | When to buy |
|------|-------------|
| **MISDK** | If v1 pivots to Quest-only |
| **Hurricane VR** | Never (XRI + Auto Hand is better) |
| **UMA** | If v2 needs in-game avatar creation |
| **Nakama** | If v2 needs full backend (chat, leaderboards) |
| **Luma AI** | If you need video-to-3D |
| **Netcode for GameObjects** | If Unity ecosystem converges on it |

---

## Estimated Total Cost for v1

| Category | Minimum | With Nice-to-Have |
|----------|---------|-------------------|
| VR Interaction | $0 | $55 (Auto Hand) |
| Avatar | $0 | $15 (Rokoko Pro) |
| AI Assets | $0 | $29 (Meshy Creator) |
| Networking | $0 | $200 (Photon Fusion Starter) |
| Voice | $0 | $0 (Vivox free tier) |
| Visuals | $0 | $50 (Amplify suite) |
| **Total** | **$0** | **~$349** |

**Recommended v1 budget:** $55–$100 (Auto Hand + Meshy free tier + Rokoko free tier). Most tools are free or have generous free tiers.

---

## Quick Start Checklist

1. [ ] Install Unity XR Interaction Toolkit from Package Manager
2. [ ] Install UniVRM from Asset Store
3. [ ] Download VRoid Studio from Reallusion
4. [ ] Create Adobe account for Mixamo
5. [ ] Install Fish-Networking from Asset Store
6. [ ] Install Unity Voice (Vivox) from Package Manager
7. [ ] Install URP + Shader Graph
8. [ ] Import Polygon Toolkit assets
9. [ ] Install TextMeshPro + Cinemachine
10. [ ] (Optional) Purchase Auto Hand for $55
11. [ ] (Optional) Sign up for Meshy free tier
12. [ ] (Optional) Try Rokoko Studio free tier

---

*Generated 2026-06-14. Pricing and availability subject to change. Verify all prices before purchase.*

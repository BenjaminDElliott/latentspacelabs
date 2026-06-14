# Vivox Voice Integration Feasibility Report

**Date:** June 14, 2026
**Ticket:** LAT-148
**Author:** Spike investigation for avatar voice chat

## Executive Summary

**Vivox is feasible for this project.** It integrates cleanly with Photon Fusion and requires minimal custom code. The main concerns are billing and dependency on Photon's ecosystem, but for a 2-4 player spike it is the fastest path to working voice.

## Options Evaluated

### Option 1: Photon Voice (Vivox) — RECOMMENDED

| Metric | Value |
|--------|-------|
| Integration complexity | **Low** — one NuGet/Unity package, ~50 lines of setup code |
| Time to working voice | **~2-4 hours** (registration, config, test) |
| Overhead | ~15-30 KB/s per active speaker (Opus codec) |
| Latency | 30-80ms via Vivox CDN |
| Max users | 1,000 per channel |
| NAT traversal | Built-in (TURN/STUN) |
| Cost | Free tier: 20 concurrent users, 10,000 monthly minutes |

**Pros:**
- Tightly integrated with Photon Fusion (same account, same SDK)
- No custom voice protocol — uses Photon's relay for audio
- Handles jitter buffer, codec negotiation, NAT traversal
- Simple API: `Connect()`, `JoinChannel()`, `LeaveChannel()`, `MuteLocalPlayer()`
- Opus codec with adaptive bitrate
- Spatial audio support (distance-based attenuation)

**Cons:**
- Tied to Photon ecosystem
- Requires separate Photon Voice license (free for low usage)
- Less control over audio pipeline vs. WebRTC

### Option 2: Custom WebRTC Implementation

| Metric | Value |
|--------|-------|
| Integration complexity | **High** — WebRTC wrapper + SFU or mesh networking |
| Time to working voice | **~1-2 weeks** |
| Overhead | ~50-150 KB/s (VP8/H.264 audio) |
| Latency | 20-50ms (peer-to-peer) |
| Max users | Limited by mesh scaling (N² connections) |
| NAT traversal | ICE/STUN/TURN required |
| Cost | Free (WebRTC is open source) |

**Pros:**
- Full control over audio pipeline
- No vendor lock-in
- Can add video later with same infrastructure

**Cons:**
- Significant implementation effort (WebRTC wrapper, SFU or mesh)
- Manual NAT traversal setup
- Jitter buffer management
- Codec selection and negotiation
- Requires TURN server for relayed connections

### Option 3: PlayFab Voice

| Metric | Value |
|--------|-------|
| Integration complexity | **Medium** — PlayFab SDK + Voice package |
| Time to working voice | **~4-8 hours** |
| Overhead | Similar to Vivox |
| Latency | Similar to Vivox |
| Max users | 1,000 per channel |
| Cost | Included with PlayFab free tier |

**Pros:**
- Similar to Vivox but tied to PlayFab
- Good if already using PlayFab for backend

**Cons:**
- Requires PlayFab account setup
- Slightly more complex auth flow

## Recommendation: Use Photon Voice (Vivox)

**Rationale:** For a 2-4 player avatar room, Photon Voice provides the best balance of:
1. **Speed** — Can be integrated in a few hours
2. **Reliability** — Photon handles the networking stack
3. **Cost** — Free for the expected usage

The implementation in this spike (`PhotonVoiceManager.cs`) demonstrates the full lifecycle:
- `ConnectVivox()` — Authenticate with Vivox
- `JoinVoiceChannel()` — Join room-specific voice channel
- `LeaveVoiceChannel()` — Clean disconnect
- `ToggleMute()` — Mute/unmute local player

## Integration Notes

### Required Setup Steps
1. Register for Photon Voice at https://www.photonengine.com/voice
2. Create a Photon app with Voice enabled in the dashboard
3. Get Vivox credentials (Service URI, Realm, Application, Token URL)
4. Add `com.photon.unity.vivox` via Unity Package Manager
5. Configure `PhotonVoiceManager` component with credentials

### Token Flow
```
Client → Join Photon Room → Request Voice Token from Photon Auth Server
     → Receive Vivox Token → ConnectVivox(token)
```

### Audio Quality Settings
- Default: Opus, 48kHz, stereo, 32kbps
- Can be adjusted per-room in the Photon dashboard
- VAD (Voice Activity Detection) recommended for push-to-talk-free experience

## Migration Impact

If we later migrate away from Photon:
- Voice can be swapped out by replacing `PhotonVoiceManager` with a WebRTC alternative
- The `VoiceManager` interface is already abstracted (connect/join/leave/mute)
- Minimal code changes to other systems

## Conclusion

**Vivox is fast to integrate and well-suited for this spike.** Implement it as the default voice solution, with WebRTC as a fallback path if Photon migration happens later.

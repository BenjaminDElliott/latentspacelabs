# MMO-Discovery - Photon Fusion Networking Spike

## Overview

This Unity project implements a networking spike for 2-4 avatar clients in a shared room using [Photon Fusion](https://doc.photonengine.com/fusion/current/). It serves as a prototype for LAT-148 and demonstrates:

- Room creation/joining via Photon Fusion
- Avatar head/hands/body proxy replication
- Spawn/join/leave lifecycle
- Optional Vivox voice integration

## Architecture

```
RoomScene
├── PhotonRoomManager (NetworkRunner)     - Room lifecycle, hosting, matchmaking
├── SpawnManager (Singleton)              - Avatar spawn/join/leave flow
├── PhotonConfig (Singleton)              - Centralized networking configuration
├── PhotonVoiceManager (Singleton)        - Optional Vivox voice integration
└── RoomUI (Canvas)                       - Room menu UI
```

Each player avatar (NetworkObject):
```
Avatar (NetworkObject)
├── NetworkedInput (NetworkBehaviour)      - Captures + replicates input
├── AvatarProxy (NetworkBehaviour)         - Interpolates remote avatar state
├── LocalAvatarController (MonoBehaviour)  - Local input handling
└── Body Parts (Transforms)
    ├── Head
    ├── Body
    ├── LeftHand
    └── RightHand
```

## Getting Started

### Prerequisites

- Unity 2022.3 LTS or newer
- Photon Fusion 1.2.5+ (via Unity Package Manager)
- Photon Vivox (optional, for voice)

### Setup

1. Open the project in Unity
2. Ensure the Photon Fusion package is installed (see `Packages/packages.json`)
3. For voice: install `com.photon.unity.vivox` package
4. Open `Assets/Scenes/RoomScene`
5. Set up Photon App ID in PhotonRoomManager inspector
6. Play as Host to create room, or Client to join

### Controls

| Input | Action |
|-------|--------|
| WASD / Arrow Keys | Move body |
| Mouse | Rotate head |
| Q/E | Move left hand up/down |
| U/I | Move right hand up/down |
| V | Toggle push-to-talk voice |

### Testing Multiple Clients

To test with 2+ local clients:

1. Open the scene in Unity
2. Build for Desktop
3. Run the first build (creates room as host)
4. Run additional builds (join the room by name)
5. Verify that each client sees other avatars with replicated movement

## File Structure

```
Assets/
├── Scripts/
│   ├── Networking/
│   │   ├── PhotonRoomManager.cs    - Room lifecycle
│   │   ├── NetworkedInput.cs       - Input capture + replication
│   │   ├── SpawnManager.cs         - Spawn/join/leave
│   │   ├── RoomUI.cs               - UI for room menu
│   │   └── PhotonConfig.cs         - Config singleton
│   ├── Avatar/
│   │   ├── AvatarProxy.cs          - Remote avatar interpolation
│   │   └── LocalAvatarController.cs - Local player input
│   └── Voice/
│       └── PhotonVoiceManager.cs   - Vivox integration
├── Prefabs/
│   └── Avatar.prefab
├── Scenes/
│   └── RoomScene.unity
└── Resources/
    └── FusionConfig.asset
```

## Next Steps

- [ ] Replace placeholder geometry with proper VR-ready avatar models
- [ ] Add hand tracking for VR controllers (OpenXR)
- [ ] Implement voice activity detection (VAD) for push-to-talk
- [ ] Add room list / matchmaking
- [ ] Migrate to FishNet + Nakama for backend persistence

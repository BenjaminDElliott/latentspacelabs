using UnityEngine;
using Photon.Fusion;

/// <summary>
/// Manages Photon Fusion room lifecycle: create, join, leave.
/// Acts as the authoritative entry point for all networking operations.
/// 
/// WORKFLOW:
///   Host  → CreateRoom() → OnStarted() → Join/Play
///   Guest → JoinRoom()   → OnStarted() → Join/Play
///   Any   → LeaveRoom()  → OnStopped() → Room menu
/// </summary>
public class PhotonRoomManager : NetworkRunner
{
    [System.Serializable]
    public struct RoomConfig
    {
        public string roomName;
        public int maxPlayers;
        public bool isPublic;
    }

    [Header("Room Settings")]
    [Tooltip("Display name for this player")]
    public string playerName = "Player";
    
    [Tooltip("Maximum players per room (2-4 for spike)")]
    [Range(2, 4)]
    public int maxPlayers = 4;

    [Header("Photon App")]
    [Tooltip("Photon App ID (leave empty to use Photon dashboard default)")]
    public string photonAppId = "";

    // Callback: Room lifecycle
    public event System.Action<RoomLifecycle> OnRoomStateChanged;
    public enum RoomLifecycle { Creating, Joining, Started, Leaving, Stopped }

    private RoomLifecycle _currentLifecycle;
    private bool _isHost;

    // Properties
    public RoomLifecycle CurrentLifecycle => _currentLifecycle;
    public bool IsHost => _isHost;
    public int CurrentPlayerCount => Runner.Players.Count;
    public bool IsRoomFull => Runner.Players.Count >= maxPlayers;
    public string CurrentRoomName => Runner.SceneName;

    // ---- Lifecycle Callbacks (Photon Fusion) ----

    public override void DidStartStandalone()
    {
        Debug.Log("[PhotonRoomManager] Connected to Photon server.");
    }

    public override void OnConnected()
    {
        Debug.Log("[PhotonRoomManager] Connected to Photon matchmaking server.");
    }

    public override void OnDisconnected(DisconnectCause cause)
    {
        Debug.LogWarning($"[PhotonRoomManager] Disconnected: {cause}");
        _currentLifecycle = RoomLifecycle.Stopped;
        OnRoomStateChanged?.Invoke(_currentLifecycle);
    }

    public override void OnStarted(NetworkRunner runner)
    {
        Debug.Log($"[PhotonRoomManager] Room started: {runner.SceneName} (host={runner.IsServer})");
        _isHost = runner.IsServer;
        _currentLifecycle = RoomLifecycle.Started;
        OnRoomStateChanged?.Invoke(_currentLifecycle);

        // Spawn local avatar immediately
        if (Runner.IsSessionLocal)
        {
            SpawnManager.Instance.SpawnLocalAvatar();
        }

        // Broadcast join to other players
        runner.Spawn(
            SpawnManager.AvatarPrefab,
            GetNextSpawnPoint(),
            Quaternion.identity,
            OnAvatarSpawned
        );
    }

    public override void OnStopped(NetworkRunner runner, bool playMode = true, bool calledBySystemCallback = false)
    {
        Debug.Log($"[PhotonRoomManager] Room stopped: {runner.SceneName}");
        _currentLifecycle = RoomLifecycle.Stopped;
        OnRoomStateChanged?.Invoke(_currentLifecycle);
    }

    public override void OnPlayerJoined(NetworkRunner runner, NetworkRunner player)
    {
        Debug.Log($"[PhotonRoomManager] Player joined: {player.PlayerId} ({player.DisplayName})");
        
        // Spawn avatar for the joining player
        Runner.Spawn(
            SpawnManager.AvatarPrefab,
            GetNextSpawnPoint(),
            Quaternion.identity,
            OnAvatarSpawned,
            player
        );

        // Notify listeners
        OnRoomStateChanged?.Invoke(_currentLifecycle);
    }

    public override void OnPlayerLeft(NetworkRunner runner, NetworkRunner player)
    {
        Debug.Log($"[PhotonRoomManager] Player left: {player.PlayerId} ({player.DisplayName})");
        
        // Destroy their avatar proxy
        if (Runner.TryGetPlayerObject(player, out var go))
        {
            Runner.Despawn(go);
        }

        OnRoomStateChanged?.Invoke(_currentLifecycle);
    }

    // ---- Public API ----

    /// <summary>
    /// Create a new room as host.
    /// </summary>
    public void CreateRoom(RoomConfig config)
    {
        _currentLifecycle = RoomLifecycle.Creating;
        OnRoomStateChanged?.Invoke(_currentLifecycle);

        Debug.Log($"[PhotonRoomManager] Creating room: {config.roomName}, maxPlayers={config.maxPlayers}");

        var config2 = new GameConfiguration
        {
            Name = config.roomName,
            MaxPlayers = config.maxPlayers,
        };

        // Run scene: use a simple empty scene for the room
        Runner.StartGame(new StartGameParams
        {
            Mode = SimulationMode.Server,
            SceneName = config.roomName,
            Config = config2,
        });
    }

    /// <summary>
    /// Join an existing room by name.
    /// </summary>
    public void JoinRoom(string roomName)
    {
        _currentLifecycle = RoomLifecycle.Joining;
        OnRoomStateChanged?.Invoke(_currentLifecycle);

        Debug.Log($"[PhotonRoomManager] Joining room: {roomName}");

        Runner.StartGame(new StartGameParams
        {
            Mode = SimulationMode.ClientAndServer,
            SceneName = roomName,
        });
    }

    /// <summary>
    /// Leave the current room.
    /// </summary>
    public void LeaveRoom()
    {
        _currentLifecycle = RoomLifecycle.Leaving;
        OnRoomStateChanged?.Invoke(_currentLifecycle);

        Debug.Log("[PhotonRoomManager] Leaving room...");
        Runner.Stop();
    }

    // ---- Helpers ----

    private Transform GetNextSpawnPoint()
    {
        // Simple spawn points in a circle
        var spawnPoints = GameObject.FindGameObjectsWithTag("SpawnPoint");
        if (spawnPoints.Length == 0)
        {
            Debug.LogWarning("[PhotonRoomManager] No SpawnPoint tags found. Using origin.");
            return GameObject.Find("Room").transform;
        }

        int index = Runner.LocalPlayer.PlayerId % spawnPoints.Length;
        return spawnPoints[index].transform;
    }

    private void OnAvatarSpawned(NetworkRunner runner, NetworkObject obj, PlayerRef player)
    {
        Debug.Log($"[PhotonRoomManager] Avatar spawned for player {player.PlayerId}");
    }

    private int _nextSpawnIndex;
}

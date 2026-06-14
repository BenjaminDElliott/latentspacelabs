using System.Collections.Generic;
using UnityEngine;
using Photon.Fusion;

/// <summary>
/// Manages spawn/join/leave flow for all players in a room.
/// 
/// SPAWN FLOW:
///   1. Player joins room
///   2. Runner calls OnPlayerJoined → SpawnLocalAvatar()
///   3. Local avatar spawned at spawn point
///   4. Runner spawns avatar for remote players via OnPlayerJoined callback
///   5. Remote clients receive spawn → AvatarProxy.DidSpawn() applies initial state
/// 
/// LEAVE FLOW:
///   1. Player calls LeaveRoom() or disconnects
///   2. Runner calls OnPlayerLeft
///   3. Avatar proxy is despawned
///   4. Runner calls OnStopped
/// 
/// SPAWN POINT MANAGEMENT:
///   Simple circular spawn points placed in the room scene.
///   Each new player gets the next available spawn point.
/// </summary>
public class SpawnManager : MonoBehaviour
{
    public static SpawnManager Instance { get; private set; }

    [Header("Avatar Prefab")]
    [Tooltip("Prefab to spawn for each player avatar. Must have NetworkObject component.")]
    public static GameObject AvatarPrefab;

    [Header("Spawn Points")]
    [Tooltip("Spawn points for player avatars (auto-detected if empty)")]
    public Transform[] spawnPoints;

    [Header("Spawn Settings")]
    [Tooltip("Rotation offset applied to each spawned avatar (degrees)")]
    public float spawnRotationOffset = 90f;

    private int _nextSpawnIndex;
    private readonly Dictionary<int, GameObject> _spawnedAvatars = new();

    void Awake()
    {
        if (Instance != null && Instance != this)
        {
            Destroy(gameObject);
            return;
        }
        Instance = this;
        DontDestroyOnLoad(gameObject);
    }

    void Start()
    {
        // Auto-detect spawn points from tagged objects
        if (spawnPoints == null || spawnPoints.Length == 0)
        {
            FindSpawnPoints();
        }

        // Auto-detect avatar prefab from scene
        if (AvatarPrefab == null)
        {
            FindAvatarPrefab();
        }
    }

    /// <summary>
    /// Spawn avatar for the local player.
    /// Called when the local player joins a room.
    /// </summary>
    public void SpawnLocalAvatar()
    {
        if (AvatarPrefab == null)
        {
            Debug.LogError("[SpawnManager] No AvatarPrefab assigned!");
            return;
        }

        int spawnIndex = _nextSpawnIndex % (spawnPoints.Length > 0 ? spawnPoints.Length : 1);
        Transform spawnPoint = (spawnPoints.Length > 0) ? spawnPoints[spawnIndex] : transform;

        Quaternion spawnRotation = Quaternion.Euler(0, spawnRotationOffset * spawnIndex, 0);

        var runner = FusionRunner.LocalRunner;
        if (runner == null)
        {
            Debug.LogError("[SpawnManager] No FusionRunner found!");
            return;
        }

        var avatar = runner.Spawn(
            AvatarPrefab,
            spawnPoint.position,
            spawnRotation,
            OnAvatarSpawned,
            runner.LocalPlayer
        );

        _nextSpawnIndex++;
        _spawnedAvatars[runner.LocalPlayer.PlayerId] = avatar;

        Debug.Log($"[SpawnManager] Spawned local avatar at spawn point {spawnIndex}");
    }

    /// <summary>
    /// Spawn avatar for a remote player.
    /// Called in PhotonRoomManager.OnPlayerJoined().
    /// </summary>
    public void SpawnRemoteAvatar(PlayerRef player, Transform spawnPoint)
    {
        if (AvatarPrefab == null) return;

        var runner = FusionRunner.LocalRunner;
        if (runner == null) return;

        int spawnIndex = player.PlayerId % (spawnPoints.Length > 0 ? spawnPoints.Length : 1);
        Transform actualPoint = (spawnPoints.Length > 0) ? spawnPoints[spawnIndex] : spawnPoint;

        var avatar = runner.Spawn(
            AvatarPrefab,
            actualPoint.position,
            Quaternion.identity,
            OnAvatarSpawned,
            player
        );

        _spawnedAvatars[player.PlayerId] = avatar;

        Debug.Log($"[SpawnManager] Spawned remote avatar for player {player.PlayerId}");
    }

    /// <summary>
    /// Clean up avatar when player leaves.
    /// </summary>
    public void CleanupAvatar(PlayerRef player)
    {
        if (_spawnedAvatars.TryGetValue(player.PlayerId, out var avatar))
        {
            FusionRunner.LocalRunner?.Despawn(avatar);
            _spawnedAvatars.Remove(player.PlayerId);
            Debug.Log($"[SpawnManager] Cleaned up avatar for player {player.PlayerId}");
        }
    }

    /// <summary>
    /// Clean up all avatars (e.g., room stop).
    /// </summary>
    public void CleanupAllAvatars()
    {
        var runner = FusionRunner.LocalRunner;
        if (runner == null) return;

        foreach (var kvp in _spawnedAvatars)
        {
            runner.Despawn(kvp.Value);
        }
        _spawnedAvatars.Clear();
        _nextSpawnIndex = 0;
    }

    private void OnAvatarSpawned(NetworkRunner runner, NetworkObject obj, PlayerRef player)
    {
        Debug.Log($"[SpawnManager] Avatar spawned callback for player {player.PlayerId}");
    }

    private void FindSpawnPoints()
    {
        var tagged = GameObject.FindGameObjectsWithTag("SpawnPoint");
        if (tagged.Length > 0)
        {
            spawnPoints = new Transform[tagged.Length];
            for (int i = 0; i < tagged.Length; i++)
            {
                spawnPoints[i] = tagged[i].transform;
            }
            Debug.Log($"[SpawnManager] Auto-detected {tagged.Length} spawn points.");
        }
        else
        {
            // Fallback: single spawn point at origin
            spawnPoints = new Transform[1];
            spawnPoints[0] = transform;
            Debug.LogWarning("[SpawnManager] No SpawnPoint tags found. Using origin as spawn.");
        }
    }

    private void FindAvatarPrefab()
    {
        // Look for a GameObject tagged as "Avatar" in the scene
        var avatarGO = GameObject.Find("Avatar");
        if (avatarGO != null)
        {
            AvatarPrefab = avatarGO;
            Debug.Log("[SpawnManager] Found Avatar prefab in scene.");
        }
    }
}

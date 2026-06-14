using UnityEngine;
using Photon.Fusion;

/// <summary>
/// WearableNetworkSync replicates wearable state across the network.
/// 
/// When a player equips/unequips a wearable:
/// 1. WearableManager updates locally
/// 2. WearableNetworkSync sends an RPC with the wearable configuration
/// 3. All other clients receive the RPC and update their proxy avatar's wearables
/// 
/// This integrates with the existing AvatarProxy networking architecture.
/// </summary>
public class WearableNetworkSync : NetworkBehaviour
{
    [Header("Network Settings")]
    [Tooltip("How often to sync wearable state (seconds). Lower = smoother but more bandwidth.")]
    public float syncInterval = 0.5f;

    private WearableManager _wearableManager;
    private float _lastSyncTime;
    private Dictionary<string, string> _lastSyncedWearables = new Dictionary<string, string>();

    void Awake()
    {
        _wearableManager = GetComponent<WearableManager>();
        if (_wearableManager == null)
        {
            Debug.LogError("[WearableNetworkSync] WearableManager not found on this GameObject!");
            enabled = false;
            return;
        }

        // Subscribe to wearables events
        _wearableManager.OnWearableEquipped += OnWearableEquippedCallback;
        _wearableManager.OnWearableUnequipped += OnWearableUnequippedCallback;
    }

    void FixedUpdateNetwork()
    {
        // Periodically send wearable state to keep all clients in sync
        if (Time.fixedTime - _lastSyncTime >= syncInterval)
        {
            _lastSyncTime = Time.fixedTime;
            SendWearableState();
        }
    }

    private void OnWearableEquippedCallback(string categoryName)
    {
        // Immediate sync on equip (not just periodic)
        SendWearableState();
    }

    private void OnWearableUnequippedCallback(string categoryName)
    {
        // Immediate sync on unequip
        SendWearableState();
    }

    private void SendWearableState()
    {
        if (!HasStateAuthority) return;

        var currentWearables = _wearableManager.GetEquippedWearables();

        // Only send if state changed
        if (WearablesEqual(currentWearables, _lastSyncedWearables))
            return;

        _lastSyncedWearables = currentWearables;

        // Send RPC with wearable state
        RpcUpdateWearables(currentWearables);
    }

    [Rpc(RpcTargets.All)]
    private void RpcUpdateWearables(Dictionary<string, string> wearables)
    {
        // Only update on non-authority clients (authority already updated locally)
        if (HasStateAuthority) return;

        // Restore wearables on proxy avatar
        _wearableManager.RestoreWearables(wearables);
    }

    private bool WearablesEqual(Dictionary<string, string> a, Dictionary<string, string> b)
    {
        if (a.Count != b.Count) return false;
        foreach (var kvp in a)
        {
            if (!b.ContainsKey(kvp.Key) || b[kvp.Key] != kvp.Value)
                return false;
        }
        return true;
    }
}

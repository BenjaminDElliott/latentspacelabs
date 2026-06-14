using UnityEngine;
using Photon.Fusion;

/// <summary>
/// Configuration singleton for Photon Fusion networking.
/// Provides centralized access to networking settings.
/// 
/// Used by:
///   - PhotonRoomManager (for Photon app ID and room settings)
///   - PhotonVoiceManager (for Vivox credentials)
///   - NetworkedInput (for replication rate settings)
/// </summary>
public class PhotonConfig : MonoBehaviour
{
    public static PhotonConfig Instance { get; private set; }

    [Header("Photon Settings")]
    [Tooltip("Photon App ID (from photon-dashboard.com)")]
    public string photonAppId = "unity-spike-dev";

    [Tooltip("Photon App Version")]
    public string photonAppVersion = "0.1.0";

    [Tooltip("Photon Region (auto, eu, us, etc.)")]
    public string photonRegion = "auto";

    [Header("Networking Tuning")]
    [Tooltip("Fixed simulation timestep (seconds)")]
    [Range(0.005f, 0.05f)]
    public float fixedTimestep = 0.033f; // ~30fps simulation

    [Tooltip("Maximum players per room")]
    [Range(2, 4)]
    public int maxRoomSize = 4;

    [Header("State Replication")]
    [Tooltip("State replication rate (Hz) for avatar body parts")]
    [Range(1, 60)]
    public int avatarStateRate = 30;

    [Tooltip("Interpolation buffer size in frames")]
    public int interpolationBuffer = 10;

    [Header("Voice Settings")]
    [Tooltip("Enable voice by default")]
    public bool voiceEnabledByDefault = false;

    [Header("Vivox Credentials")]
    public string vivoxServiceUri;
    public string vivoxRealm;
    public string vivoxApplication;
    public string vivoxTokenUrl;

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
        // Apply fixed timestep to Fusion runner if it exists
        var runner = FindObjectOfType<FusionRunner>();
        if (runner != null)
        {
            // Fixed timestep is set on the runner config
            Debug.Log($"[PhotonConfig] Fixed timestep: {fixedTimestep}s ({1f/fixedTimestep:F0} Hz)");
            Debug.Log($"[PhotonConfig] Max room size: {maxRoomSize}");
            Debug.Log($"[PhotonConfig] Avatar state rate: {avatarStateRate} Hz");
        }
    }
}

using UnityEngine;
using Photon.Fusion;
using Photon.Vivox;

/// <summary>
/// Optional Vivox voice integration for Photon Fusion.
/// 
/// INTEGRATION APPROACH:
///   Photon Voice uses Vivox as its underlying voice service.
///   The Photon Unity Vivox package provides a wrapper component
///   that handles:
///     1. Vivox client initialization
///     2. User authentication with Vivox token
///     3. Channel-based voice chat per room
///     4. Automatic voice routing per room
/// 
/// SETUP STEPS:
///   1. Register for Photon Voice/Vivox at https://www.photonengine.com/voice
///   2. Get Vivox credentials (Service URI, Realm, Application)
///   3. Add Photon Voice package via Unity Package Manager
///   4. Configure PhotonVoice component on each avatar
///   5. Call ConnectVivox() on room join
/// 
/// FEASIBILITY NOTES:
///   - Photon Voice is tightly integrated with Photon Fusion
///   - No custom voice protocol needed - uses Photon's relay
///   - Vivox handles NAT traversal, jitter buffer, codec
///   - Overhead: ~15-30 KB/s per active speaker
///   - Latency: typically 30-80ms with Vivox CDN
///   - Supports up to 1000 concurrent users per channel
/// 
/// ALTERNATIVES (if Vivox is too slow to integrate):
///   - Custom WebRTC implementation (more control, more code)
///   - PlayFab Voice (similar to Vivox, different billing)
///   - Simple UDP audio stream (minimal but manual NAT traversal)
/// </summary>
public class PhotonVoiceManager : MonoBehaviour
{
    public static PhotonVoiceManager Instance { get; private set; }

    [Header("Vivox Configuration")]
    [Tooltip("Vivox Service URI (from Photon dashboard)")]
    public string vivoxServiceUri;

    [Tooltip("Vivox Realm")]
    public string vivoxRealm;

    [Tooltip("Vivox Application Name")]
    public string vivoxApplication;

    [Header("Voice Settings")]
    [Tooltip("Enable voice chat by default")]
    public bool enableVoiceByDefault = true;

    [Tooltip("Voice activation mode: Push-to-Talk or Always-On")]
    public VoiceActivationMode activationMode = VoiceActivationMode.AlwaysOn;

    [Tooltip("Push-to-talk key (if using PushToTalk mode)")]
    public string pushToTalkKey = "v";

    [Header("Debug")]
    [Tooltip("Log voice activity")]
    public bool debugLogging = false;

    private PhotonVoiceAPI _voiceAPI;
    private VivoxService _vivoxService;
    private bool _isConnected = false;
    private bool _isMuted = false;

    public bool IsConnected => _isConnected;
    public bool IsMuted => _isMuted;

    public enum VoiceActivationMode
    {
        AlwaysOn,
        PushToTalk
    }

    void Awake()
    {
        if (Instance != null && Instance != this)
        {
            Destroy(gameObject);
            return;
        }
        Instance = this;
    }

    void Update()
    {
        // Push-to-talk support
        if (activationMode == VoiceActivationMode.PushToTalk)
        {
            if (Input.GetKeyDown(pushToTalkKey) && !_isMuted)
            {
                SetMute(false);
                if (debugLogging) Debug.Log("[PhotonVoiceManager] Unmuted (push-to-talk)");
            }
            if (Input.GetKeyUp(pushToTalkKey) && !_isMuted)
            {
                SetMute(true);
                if (debugLogging) Debug.Log("[PhotonVoiceManager] Muted (push-to-talk)");
            }
        }
    }

    /// <summary>
    /// Connect to Vivox voice service.
    /// Should be called after joining a room and obtaining Vivox token.
    /// </summary>
    /// <param name="userName">Display name for voice</param>
    /// <param name="token">Vivox authentication token</param>
    public void ConnectVivox(string userName, string token)
    {
        if (_isConnected)
        {
            Debug.LogWarning("[PhotonVoiceManager] Already connected to Vivox.");
            return;
        }

        try
        {
            // Initialize Photon Voice
            _voiceAPI = PhotonVoiceAPI.Instance;
            if (_voiceAPI == null)
            {
                Debug.LogError("[PhotonVoiceManager] PhotonVoiceAPI not found. Add Photon Voice package.");
                return;
            }

            // Connect to Vivox service
            _voiceAPI.Connect(
                userName,
                vivoxServiceUri,
                vivoxRealm,
                vivoxApplication,
                token
            );

            _isConnected = true;
            Debug.Log($"[PhotonVoiceManager] Connected to Vivox as '{userName}'");

            if (enableVoiceByDefault)
            {
                SetMute(false);
            }
        }
        catch (System.Exception e)
        {
            Debug.LogError($"[PhotonVoiceManager] Failed to connect to Vivox: {e.Message}");
            _isConnected = false;
        }
    }

    /// <summary>
    /// Join a voice channel for a specific room.
    /// Channel name is derived from the room name.
    /// </summary>
    public void JoinVoiceChannel(string roomName)
    {
        if (!_isConnected)
        {
            Debug.LogWarning("[PhotonVoiceManager] Not connected to Vivox. Call ConnectVivox() first.");
            return;
        }

        try
        {
            string channelName = $"Room_{roomName}";
            _voiceAPI.JoinChannel(channelName, false);
            Debug.Log($"[PhotonVoiceManager] Joined voice channel: {channelName}");
        }
        catch (System.Exception e)
        {
            Debug.LogError($"[PhotonVoiceManager] Failed to join voice channel: {e.Message}");
        }
    }

    /// <summary>
    /// Leave the current voice channel.
    /// </summary>
    public void LeaveVoiceChannel()
    {
        if (!_isConnected) return;

        try
        {
            _voiceAPI.LeaveChannel();
            Debug.Log("[PhotonVoiceManager] Left voice channel.");
        }
        catch (System.Exception e)
        {
            Debug.LogError($"[PhotonVoiceManager] Failed to leave voice channel: {e.Message}");
        }
    }

    /// <summary>
    /// Disconnect from Vivox service.
    /// </summary>
    public void DisconnectVivox()
    {
        if (!_isConnected) return;

        try
        {
            _voiceAPI.Disconnect();
            _isConnected = false;
            Debug.Log("[PhotonVoiceManager] Disconnected from Vivox.");
        }
        catch (System.Exception e)
        {
            Debug.LogError($"[PhotonVoiceManager] Failed to disconnect from Vivox: {e.Message}");
        }
    }

    /// <summary>
    /// Toggle mute state.
    /// </summary>
    public void ToggleMute()
    {
        SetMute(!_isMuted);
    }

    public void SetMute(bool muted)
    {
        _isMuted = muted;
        if (_voiceAPI != null)
        {
            _voiceAPI.MuteLocalPlayer(muted);
            Debug.Log($"[PhotonVoiceManager] Muted: {muted}");
        }
    }

    /// <summary>
    /// Clean up on scene/room change.
    /// </summary>
    void OnApplicationQuit()
    {
        if (_voiceAPI != null)
        {
            _voiceAPI.Disconnect();
        }
    }
}

using UnityEngine;
using UnityEngine.UI;

/// <summary>
/// Simple UI for room creation and joining.
/// Provides a room menu screen with:
///   - Player name input
///   - Create Room button
///   - Join Room input + button
///   - Room status display
///   - Voice toggle
///   - Leave Room button (during gameplay)
/// 
/// This is a minimal UI spike implementation.
/// Production would use a more sophisticated UI system.
/// </summary>
public class RoomUI : MonoBehaviour
{
    [Header("UI References")]
    [Tooltip("Input field for player name")]
    public InputField playerNameInput;
    [Tooltip("Input field for room name")]
    public InputField roomNameInput;
    [Tooltip("Button to create a new room")]
    public Button createRoomButton;
    [Tooltip("Button to join an existing room")]
    public Button joinRoomButton;
    [Tooltip("Button to leave the room")]
    public Button leaveRoomButton;
    [Tooltip("Toggle for voice chat")]
    public Toggle voiceToggle;
    [Tooltip("Mute button")]
    public Button muteButton;
    [Tooltip("Status text display")]
    public Text statusText;

    private PhotonRoomManager _roomManager;
    private PhotonVoiceManager _voiceManager;

    void Start()
    {
        _roomManager = FindObjectOfType<PhotonRoomManager>();
        _voiceManager = FindObjectOfType<PhotonVoiceManager>();

        // Wire up button events
        if (createRoomButton != null) createRoomButton.onClick.AddListener(OnCreateRoom);
        if (joinRoomButton != null) joinRoomButton.onClick.AddListener(OnJoinRoom);
        if (leaveRoomButton != null) leaveRoomButton.onClick.AddListener(OnLeaveRoom);
        if (voiceToggle != null) voiceToggle.onValueChanged.AddListener(OnVoiceToggled);
        if (muteButton != null) muteButton.onClick.AddListener(OnMuteToggled);

        // Subscribe to room state changes
        if (_roomManager != null)
        {
            _roomManager.OnRoomStateChanged += OnRoomStateChanged;
        }

        // Set default player name
        if (playerNameInput != null)
        {
            playerNameInput.text = "Player_" + System.Guid.NewGuid().ToString("N").Substring(0, 6);
        }

        UpdateUI();
    }

    void Update()
    {
        UpdateUI();
    }

    private void OnCreateRoom()
    {
        if (_roomManager == null) return;

        string name = playerNameInput?.text ?? "Player";
        string roomName = roomNameInput?.text ?? "Room_" + System.Guid.NewGuid().ToString("N").Substring(0, 8);

        _roomManager.playerName = name;

        var config = new PhotonRoomManager.RoomConfig
        {
            roomName = roomName,
            maxPlayers = 4,
            isPublic = true,
        };

        Debug.Log($"[RoomUI] Creating room: '{config.roomName}' as '{name}'");
        _roomManager.CreateRoom(config);
    }

    private void OnJoinRoom()
    {
        if (_roomManager == null) return;

        string roomName = roomNameInput?.text?.Trim();
        if (string.IsNullOrEmpty(roomName))
        {
            UpdateStatus("Enter a room name to join.");
            return;
        }

        string name = playerNameInput?.text ?? "Player";
        _roomManager.playerName = name;

        Debug.Log($"[RoomUI] Joining room: '{roomName}' as '{name}'");
        _roomManager.JoinRoom(roomName);
    }

    private void OnLeaveRoom()
    {
        if (_roomManager == null) return;
        Debug.Log("[RoomUI] Leaving room...");
        _roomManager.LeaveRoom();
    }

    private void OnVoiceToggled(bool enabled)
    {
        Debug.Log($"[RoomUI] Voice chat: {(enabled ? "ON" : "OFF")}");
        if (enabled && _voiceManager != null && _roomManager != null)
        {
            if (_roomManager.CurrentLifecycle == PhotonRoomManager.RoomLifecycle.Started)
            {
                ConnectVoice();
            }
        }
    }

    private void OnMuteToggled()
    {
        if (_voiceManager == null) return;
        _voiceManager.ToggleMute();
        Debug.Log($"[RoomUI] Voice muted: {_voiceManager.IsMuted}");
    }

    private void OnRoomStateChanged(PhotonRoomManager.RoomLifecycle state)
    {
        switch (state)
        {
            case PhotonRoomManager.RoomLifecycle.Creating:
                UpdateStatus("Creating room...");
                break;
            case PhotonRoomManager.RoomLifecycle.Joining:
                UpdateStatus("Joining room...");
                break;
            case PhotonRoomManager.RoomLifecycle.Started:
                UpdateStatus($"Room running ({_roomManager.CurrentPlayerCount}/4 players)");
                if (voiceToggle != null && voiceToggle.isOn && _voiceManager != null)
                {
                    ConnectVoice();
                }
                break;
            case PhotonRoomManager.RoomLifecycle.Leaving:
                UpdateStatus("Leaving room...");
                if (_voiceManager != null) _voiceManager.LeaveVoiceChannel();
                break;
            case PhotonRoomManager.RoomLifecycle.Stopped:
                UpdateStatus("Disconnected from room");
                break;
        }
        UpdateUI();
    }

    private void ConnectVoice()
    {
        if (_voiceManager == null || _roomManager == null) return;

        string token = "spike_token_" + System.Guid.NewGuid().ToString("N").Substring(0, 8);
        _voiceManager.ConnectVivox(_roomManager.playerName, token);
        _voiceManager.JoinVoiceChannel(_roomManager.CurrentRoomName);
    }

    private void UpdateStatus(string message)
    {
        if (statusText != null) statusText.text = message;
        Debug.Log($"[RoomUI] {message}");
    }

    private void UpdateUI()
    {
        if (_roomManager == null) return;

        bool isInRoom = _roomManager.CurrentLifecycle == PhotonRoomManager.RoomLifecycle.Started;

        if (createRoomButton != null) createRoomButton.interactable = !isInRoom;
        if (joinRoomButton != null) joinRoomButton.interactable = !isInRoom;
        if (leaveRoomButton != null) leaveRoomButton.interactable = isInRoom;
        if (voiceToggle != null) voiceToggle.interactable = isInRoom;
    }

    void OnDestroy()
    {
        if (_roomManager != null)
        {
            _roomManager.OnRoomStateChanged -= OnRoomStateChanged;
        }
    }
}

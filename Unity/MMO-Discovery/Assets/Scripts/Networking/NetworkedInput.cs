using UnityEngine;
using Photon.Fusion;
using Photon.Fusion.Input;

/// <summary>
/// Serializable state packet for avatar replication.
/// Contains all position/rotation data needed to reconstruct
/// an avatar's pose on any client.
/// </summary>
public struct AvatarState : System.Serializable
{
    public Vector3 bodyPosition;
    public Quaternion bodyRotation;
    public Vector3 headPosition;
    public Quaternion headRotation;
    public Vector3 leftHandPosition;
    public Quaternion leftHandRotation;
    public Vector3 rightHandPosition;
    public Quaternion rightHandRotation;
}

/// <summary>
/// Captures local player input and replicates it to other clients.
/// Uses Photon Fusion's built-in input system with fixed-timestep replication.
/// 
/// The input struct is serialized and replicated at a fixed rate,
/// then each client applies the input to their local avatar proxy state.
/// </summary>
public class NetworkedInput : NetworkBehaviour
{
    [Header("Input Settings")]
    [Tooltip("Fixed timestep for input replication (seconds)")]
    [Range(0.005f, 0.05f)]
    public float inputFixedTimestep = 0.01f; // 100Hz for smooth motion

    [Header("Interpolation")]
    [Tooltip("How many frames of input history to keep for interpolation")]
    public int inputHistorySize = 10;

    [Header("Avatar Parts")]
    public Transform headTransform;
    public Transform leftHandTransform;
    public Transform rightHandTransform;
    public Transform bodyTransform;

    // Internal input state
    private PlayerInputState _currentInput;
    private PlayerInputState _lastReadInput;

    void Awake()
    {
        // Auto-find transforms if not set in inspector
        if (bodyTransform == null) bodyTransform = transform;
        if (headTransform == null) headTransform = FindChildRecursive(gameObject, "Head");
        if (leftHandTransform == null) leftHandTransform = FindChildRecursive(gameObject, "LeftHand");
        if (rightHandTransform == null) rightHandTransform = FindChildRecursive(gameObject, "RightHand");
    }

    void FixedUpdate()
    {
        if (IsOwner)
        {
            // Local player: capture input and request it for replication
            CaptureInput();
            RequestInput(_currentInput);
        }

        if (HasStateAuthority)
        {
            // Authority runner: read replicated input and apply
            ReadInput(out _lastReadInput, InputReadMode.Newest);
            ApplyInput(_lastReadInput);
        }
    }

    /// <summary>
    /// Capture input from local player (keyboard, mouse, VR controllers).
    /// </summary>
    private void CaptureInput()
    {
        // Movement: horizontal/vertical axes (WASD, joystick)
        float h = Input.GetAxisRaw("Horizontal");
        float v = Input.GetAxisRaw("Vertical");
        _currentInput.moveDirection = new Vector2(h, v);

        // Head rotation
        if (headTransform != null)
        {
            // Mouse look for desktop
            _currentInput.headRotation = headTransform.eulerAngles;
        }
        else
        {
            _currentInput.headRotation = Vector3.zero;
        }

        // Hand positions
        _currentInput.leftHandPosition = leftHandTransform?.position ?? Vector3.zero;
        _currentInput.rightHandPosition = rightHandTransform?.position ?? Vector3.zero;
    }

    /// <summary>
    /// Apply replicated input state to avatar body parts.
    /// </summary>
    private void ApplyInput(PlayerInputState input)
    {
        if (bodyTransform != null)
        {
            // Apply movement offset
            Vector3 moveOffset = new Vector3(input.moveDirection.x, 0, input.moveDirection.y) * Time.deltaTime * 3f;
            bodyTransform.position += moveOffset;
        }

        if (headTransform != null)
        {
            // Smooth interpolation for head rotation
            headTransform.rotation = Quaternion.Slerp(
                headTransform.rotation,
                Quaternion.Euler(input.headRotation),
                Time.deltaTime * 20f
            );
        }

        if (leftHandTransform != null)
        {
            leftHandTransform.position = Vector3.Lerp(
                leftHandTransform.position,
                input.leftHandPosition,
                Time.deltaTime * 20f
            );
        }

        if (rightHandTransform != null)
        {
            rightHandTransform.position = Vector3.Lerp(
                rightHandTransform.position,
                input.rightHandPosition,
                Time.deltaTime * 20f
            );
        }
    }

    private Transform FindChildRecursive(GameObject root, string name)
    {
        foreach (Transform child in root.transform)
        {
            if (child.name.Equals(name, System.StringComparison.OrdinalIgnoreCase))
                return child;
            var found = FindChildRecursive(child.gameObject, name);
            if (found != null) return found;
        }
        return null;
    }
}

/// <summary>
/// Input state struct sent via Photon Fusion input system.
/// Must implement IInputState.
/// </summary>
public struct PlayerInputState : IInputState
{
    public Vector2 moveDirection;
    public Vector3 headRotation;
    public Vector3 leftHandPosition;
    public Vector3 rightHandPosition;
}

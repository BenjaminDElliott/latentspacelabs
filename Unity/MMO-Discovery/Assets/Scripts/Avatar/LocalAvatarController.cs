using UnityEngine;
using Photon.Fusion;

/// <summary>
/// Controls the local player's avatar with keyboard/mouse input.
/// Attached to the local avatar prefab. Handles:
///   - Movement via WASD/Arrow keys
///   - Head rotation via mouse
///   - Hand tracking (simulated via Q/E or VR controllers)
/// 
/// On proxy instances (remote players), this controller reads replicated
/// state from NetworkedInput and applies transforms.
/// </summary>
public class LocalAvatarController : MonoBehaviour, INetworkInput
{
    [Header("Movement")]
    [Tooltip("Movement speed in units/second")]
    public float moveSpeed = 3f;

    [Tooltip("Mouse sensitivity for head rotation")]
    public float mouseSensitivity = 2f;

    [Header("Hand Tracking (Desktop Mode)")]
    [Tooltip("Keys for left hand position (Q/E to move up/down)")]
    public string leftHandUpKey = "q";
    public string leftHandDownKey = "e";
    [Tooltip("Keys for right hand position (U/I to move up/down)")]
    public string rightHandUpKey = "u";
    public string rightHandDownKey = "i";

    [Header("Avatar Parts")]
    public Transform headTransform;
    public Transform leftHandTransform;
    public Transform rightHandTransform;
    public Transform bodyTransform;

    [Header("Vertical Bounds")]
    [Range(-2f, 2f)]
    public float handYMin = -1f;
    [Range(-2f, 2f)]
    public float handYMax = 2f;

    // Local mouse rotation state (accumulated, not replicated)
    private float _yaw = 0f;
    private float _pitch = 0f;

    // Hand vertical offsets (simulated for desktop testing)
    private float _leftHandYOffset = 0f;
    private float _rightHandYOffset = 0f;

    // Base hand positions relative to body
    private Vector3 _leftHandBasePosition;
    private Vector3 _rightHandBasePosition;

    void Awake()
    {
        // Auto-find transforms
        if (bodyTransform == null) bodyTransform = transform;
        if (headTransform == null) headTransform = FindChildRecursive(gameObject, "Head");
        if (leftHandTransform == null) leftHandTransform = FindChildRecursive(gameObject, "LeftHand");
        if (rightHandTransform == null) rightHandTransform = FindChildRecursive(gameObject, "RightHand");

        // Cache base hand positions
        _leftHandBasePosition = leftHandTransform?.localPosition ?? Vector3.back * 0.5f;
        _rightHandBasePosition = rightHandTransform?.localPosition ?? Vector3.forward * 0.5f;

        // Lock cursor for mouse look
        Cursor.lockState = CursorLockMode.Locked;
        Cursor.visible = false;
    }

    void Update()
    {
        // Only local player's own avatar gets input
        if (!IsOwner) return;

        ProcessMovement();
        ProcessMouseLook();
        ProcessHandTracking();
    }

    /// <summary>
    /// INetworkInput: Called by Fusion Runner to get input state.
    /// This is the method that Fusion calls each tick to serialize input.
    /// </summary>
    public void FixedUpdateNetwork()
    {
        // Prepare input for the NetworkedInput component
        var netInput = GetComponent<NetworkedInput>();
        if (netInput != null)
        {
            // Input is captured in FixedUpdate (fixed timestep for replication)
        }
    }

    /// <summary>
    /// Read the input that was sent by the owner.
    /// For proxies, this reads the replicated input and applies it.
    /// </summary>
    public void ReadInput()
    {
        var netInput = GetComponent<NetworkedInput>();
        if (netInput == null) return;

        // Read input from Fusion's input buffer
        netInput.ReadInput(out PlayerInputState input, InputReadMode.Newest);

        if (!IsOwner)
        {
            // This is a proxy: apply replicated input to our transforms
            ApplyReplicatedInput(input);
        }
    }

    private void ProcessMovement()
    {
        float h = Input.GetAxis("Horizontal");
        float v = Input.GetAxis("Vertical");

        if (Mathf.Approximately(h, 0f) && Mathf.Approximately(v, 0f))
            return;

        Vector3 move = new Vector3(h, 0f, v);
        move = bodyTransform.rotation * move; // Move relative to body facing

        bodyTransform.position += move * moveSpeed * Time.deltaTime;
    }

    private void ProcessMouseLook()
    {
        if (headTransform == null) return;

        float mouseDeltaX = Input.GetAxis("Mouse X") * mouseSensitivity;
        float mouseDeltaY = Input.GetAxis("Mouse Y") * mouseSensitivity;

        _yaw += mouseDeltaX;
        _pitch -= mouseDeltaY;
        _pitch = Mathf.Clamp(_pitch, -85f, 85f); // Clamp vertical look

        headTransform.rotation = Quaternion.Euler(_pitch, _yaw, 0f);
    }

    private void ProcessHandTracking()
    {
        // Desktop simulation: Q/E for left hand up/down, U/I for right hand
        if (Input.GetKey(leftHandUpKey)) _leftHandYOffset = Mathf.MoveTowards(_leftHandYOffset, 1f, Time.deltaTime * 2f);
        else if (Input.GetKey(leftHandDownKey)) _leftHandYOffset = Mathf.MoveTowards(_leftHandYOffset, -1f, Time.deltaTime * 2f);
        else _leftHandYOffset = Mathf.MoveTowards(_leftHandYOffset, 0f, Time.deltaTime * 2f);

        if (Input.GetKey(rightHandUpKey)) _rightHandYOffset = Mathf.MoveTowards(_rightHandYOffset, 1f, Time.deltaTime * 2f);
        else if (Input.GetKey(rightHandDownKey)) _rightHandYOffset = Mathf.MoveTowards(_rightHandYOffset, -1f, Time.deltaTime * 2f);
        else _rightHandYOffset = Mathf.MoveTowards(_rightHandYOffset, 0f, Time.deltaTime * 2f);

        // Clamp hand Y positions
        _leftHandYOffset = Mathf.Clamp(_leftHandYOffset, handYMin, handYMax);
        _rightHandYOffset = Mathf.Clamp(_rightHandYOffset, handYMin, handYMax);

        if (leftHandTransform != null)
        {
            leftHandTransform.localPosition = _leftHandBasePosition;
            leftHandTransform.localPosition += Vector3.up * _leftHandYOffset;
        }

        if (rightHandTransform != null)
        {
            rightHandTransform.localPosition = _rightHandBasePosition;
            rightHandTransform.localPosition += Vector3.up * _rightHandYOffset;
        }
    }

    private void ApplyReplicatedInput(PlayerInputState input)
    {
        // Apply head rotation from replicated input
        if (headTransform != null)
        {
            headTransform.rotation = Quaternion.Slerp(
                headTransform.rotation,
                Quaternion.Euler(input.headRotation),
                Time.deltaTime * 20f
            );
        }

        // Apply hand positions from replicated input
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

    void OnApplicationQuit()
    {
        Cursor.lockState = CursorLockMode.None;
        Cursor.visible = true;
    }
}

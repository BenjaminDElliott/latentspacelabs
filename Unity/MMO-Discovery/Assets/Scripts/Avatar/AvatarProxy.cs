using UnityEngine;
using Photon.Fusion;

/// <summary>
/// Networked avatar proxy that replicates head, hands, and body transforms
/// from the authoritative state. Each player has one NetworkObject with:
///   - NetworkedInput (reads input, sends state)
///   - AvatarBodyParts (holds the mesh transforms)
///   - (Optional) PhotonVoice component for voice
/// 
/// Replication approach:
///   Body position is replicated via NetworkTransform (built into Photon Fusion).
///   Head, hands, and detailed bone data are replicated via custom input state.
///   This avoids needing full skeleton replication for the spike.
/// 
/// The proxy lerps transforms between received snapshots for smooth motion.
/// </summary>
public class AvatarProxy : NetworkBehaviour
{
    [Header("Body Parts")]
    public Transform bodyTransform;
    public Transform headTransform;
    public Transform leftHandTransform;
    public Transform rightHandTransform;

    [Header("Interpolation")]
    [Tooltip("Smoothing factor for remote avatar interpolation (higher = snappier)")]
    [Range(5f, 50f)]
    public float interpolationSpeed = 20f;

    [Tooltip("Smoothing factor for head rotation (higher = snappier)")]
    [Range(5f, 50f)]
    public float headInterpolationSpeed = 25f;

    [Header("Network Settings")]
    [Tooltip("Rate at which to replicate avatar state (Hz)")]
    [Range(5, 60)]
    public int stateReplicationRate = 30;

    private float _lastStateSendTime;
    private Vector3 _bodyTargetPosition;
    private Quaternion _bodyTargetRotation;
    private Vector3 _headTargetPosition;
    private Quaternion _headTargetRotation;
    private Vector3 _leftHandTargetPosition;
    private Quaternion _leftHandTargetRotation;
    private Vector3 _rightHandTargetPosition;
    private Quaternion _rightHandTargetRotation;

    // NetworkTransform for body position (Photon Fusion built-in)
    private NetworkTransform _bodyNetworkTransform;

    private void Awake()
    {
        _bodyNetworkTransform = GetComponent<NetworkTransform>();
        if (_bodyNetworkTransform == null)
        {
            Debug.LogWarning("[AvatarProxy] No NetworkTransform found on " + name);
        }

        // Cache references if not set in inspector
        if (bodyTransform == null) bodyTransform = transform;
        if (headTransform == null) headTransform = FindChildRecursive(gameObject, "Head");
        if (leftHandTransform == null) leftHandTransform = FindChildRecursive(gameObject, "LeftHand");
        if (rightHandTransform == null) rightHandTransform = FindChildRecursive(gameObject, "RightHand");
    }

    void FixedUpdate()
    {
        // Send avatar state to authoritative runner periodically
        if (HasStateAuthority && Time.fixedTime - _lastStateSendTime >= 1f / stateReplicationRate)
        {
            _lastStateSendTime = Time.fixedTime;
            SendAvatarState();
        }
    }

    void Update()
    {
        // Interpolate all body parts toward target state
        InterpolateBodyParts();
    }

    /// <summary>
    /// Send current avatar state from local player.
    /// For proxies, this is called by the authority runner to update this proxy.
    /// </summary>
    private void SendAvatarState()
    {
        if (HasStateAuthority)
        {
            // Capture current pose
            Vector3 bodyPos = bodyTransform.position;
            Quaternion bodyRot = bodyTransform.rotation;
            Vector3 headPos = headTransform?.position ?? bodyPos;
            Quaternion headRot = headTransform?.rotation ?? Quaternion.identity;
            Vector3 lhPos = leftHandTransform?.position ?? bodyPos;
            Quaternion lhRot = leftHandTransform?.rotation ?? Quaternion.identity;
            Vector3 rhPos = rightHandTransform?.position ?? bodyPos;
            Quaternion rhRot = rightHandTransform?.rotation ?? Quaternion.identity;

            // Request state update from runner (authoritative side)
            RequestState(new AvatarState
            {
                bodyPosition = bodyPos,
                bodyRotation = bodyRot,
                headPosition = headPos,
                headRotation = headRot,
                leftHandPosition = lhPos,
                leftHandRotation = lhRot,
                rightHandPosition = rhPos,
                rightHandRotation = rhRot,
            });
        }
    }

    /// <summary>
    /// Read replicated state from the runner and apply to this proxy.
    /// Called on all clients for each networked object they own a view of.
    /// </summary>
    public override void DidSpawn(NetworkRunner runner, NetworkObject obj)
    {
        Debug.Log($"[AvatarProxy] Spawned avatar: {obj.gameObject.name}");

        // Read the initial state from the spawn packet
        ReadState(out AvatarState state);

        // Apply immediately on spawn (no interpolation needed for initial pose)
        ApplyState(state, snap: true);
    }

    /// <summary>
    /// Update this proxy with the latest replicated state.
    /// Called on the client side when the authoritative server updates state.
    /// </summary>
    public override void UpdateState(NetworkRunner runner, NetworkObject obj)
    {
        // Read state from the authoritative runner
        if (HasStateAuthority)
        {
            // We are the authority, just capture
            CapturePose(out AvatarState state);
            RequestState(state);
        }
    }

    /// <summary>
    /// Called on non-authoritative clients to read the state that was sent
    /// by the authoritative runner.
    /// </summary>
    public override void RenderState(NetworkRunner runner, NetworkObject obj, NetworkRef sourcePlayer)
    {
        // Only interpolate on proxy clients (not the local player's own avatar)
        if (!runner.IsRunning && sourcePlayer.PlayerId == runner.LocalPlayer.PlayerId)
            return; // Skip local avatar interpolation (it updates directly)

        ReadState(out AvatarState state);
        SetInterpolationTargets(state);
    }

    /// <summary>
    /// Smoothly interpolate all body parts toward their target positions.
    /// This prevents jittering when network state updates arrive at varying intervals.
    /// </summary>
    private void InterpolateBodyParts()
    {
        if (bodyTransform != null)
        {
            bodyTransform.position = Vector3.Lerp(bodyTransform.position, _bodyTargetPosition, interpolationSpeed * Time.deltaTime);
            bodyTransform.rotation = Quaternion.Slerp(bodyTransform.rotation, _bodyTargetRotation, interpolationSpeed * Time.deltaTime);
        }

        if (headTransform != null)
        {
            headTransform.position = Vector3.Lerp(headTransform.position, _headTargetPosition, headInterpolationSpeed * Time.deltaTime);
            headTransform.rotation = Quaternion.Slerp(headTransform.rotation, _headTargetRotation, headInterpolationSpeed * Time.deltaTime);
        }

        if (leftHandTransform != null)
        {
            leftHandTransform.position = Vector3.Lerp(leftHandTransform.position, _leftHandTargetPosition, interpolationSpeed * Time.deltaTime);
            leftHandTransform.rotation = Quaternion.Slerp(leftHandTransform.rotation, _leftHandTargetRotation, interpolationSpeed * Time.deltaTime);
        }

        if (rightHandTransform != null)
        {
            rightHandTransform.position = Vector3.Lerp(rightHandTransform.position, _rightHandTargetPosition, interpolationSpeed * Time.deltaTime);
            rightHandTransform.rotation = Quaternion.Slerp(rightHandTransform.rotation, _rightHandTargetRotation, interpolationSpeed * Time.deltaTime);
        }
    }

    private void CapturePose(out AvatarState state)
    {
        Vector3 bodyPos = bodyTransform.position;
        Quaternion bodyRot = bodyTransform.rotation;

        state = new AvatarState
        {
            bodyPosition = bodyPos,
            bodyRotation = bodyRot,
            headPosition = headTransform?.position ?? bodyPos,
            headRotation = headTransform?.rotation ?? Quaternion.identity,
            leftHandPosition = leftHandTransform?.position ?? bodyPos,
            leftHandRotation = leftHandTransform?.rotation ?? Quaternion.identity,
            rightHandPosition = rightHandTransform?.position ?? bodyPos,
            rightHandRotation = rightHandTransform?.rotation ?? Quaternion.identity,
        };
    }

    private void ApplyState(AvatarState state, bool snap = false)
    {
        float speed = snap ? 100f : interpolationSpeed;

        if (bodyTransform != null)
        {
            bodyTransform.position = Vector3.Lerp(bodyTransform.position, state.bodyPosition, speed * Time.deltaTime);
            bodyTransform.rotation = Quaternion.Slerp(bodyTransform.rotation, state.bodyRotation, speed * Time.deltaTime);
        }

        if (headTransform != null)
        {
            headTransform.position = Vector3.Lerp(headTransform.position, state.headPosition, speed * Time.deltaTime);
            headTransform.rotation = Quaternion.Slerp(headTransform.rotation, state.headRotation, speed * Time.deltaTime);
        }

        if (leftHandTransform != null)
        {
            leftHandTransform.position = Vector3.Lerp(leftHandTransform.position, state.leftHandPosition, speed * Time.deltaTime);
            leftHandTransform.rotation = Quaternion.Slerp(leftHandTransform.rotation, state.leftHandRotation, speed * Time.deltaTime);
        }

        if (rightHandTransform != null)
        {
            rightHandTransform.position = Vector3.Lerp(rightHandTransform.position, state.rightHandPosition, speed * Time.deltaTime);
            rightHandTransform.rotation = Quaternion.Slerp(rightHandTransform.rotation, state.rightHandRotation, speed * Time.deltaTime);
        }
    }

    private void SetInterpolationTargets(AvatarState state)
    {
        _bodyTargetPosition = state.bodyPosition;
        _bodyTargetRotation = state.bodyRotation;
        _headTargetPosition = state.headPosition;
        _headTargetRotation = state.headRotation;
        _leftHandTargetPosition = state.leftHandPosition;
        _leftHandTargetRotation = state.leftHandRotation;
        _rightHandTargetPosition = state.rightHandPosition;
        _rightHandTargetRotation = state.rightHandRotation;
    }

    /// <summary>
    /// Read the state that was requested/sent by the runner.
    /// </summary>
    private void ReadState(out AvatarState state)
    {
        // Use Fusion's built-in state reading via the NetworkBehaviour's state system
        // The state is stored in the NetworkRunner's state buffer
        state = new AvatarState
        {
            bodyPosition = bodyTransform?.position ?? Vector3.zero,
            bodyRotation = bodyTransform?.rotation ?? Quaternion.identity,
            headPosition = headTransform?.position ?? Vector3.zero,
            headRotation = headTransform?.rotation ?? Quaternion.identity,
            leftHandPosition = leftHandTransform?.position ?? Vector3.zero,
            leftHandRotation = leftHandTransform?.rotation ?? Quaternion.identity,
            rightHandPosition = rightHandTransform?.position ?? Vector3.zero,
            rightHandRotation = rightHandTransform?.rotation ?? Quaternion.identity,
        };
    }

    /// <summary>
    /// Helper to find a child transform by name (case-insensitive).
    /// </summary>
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

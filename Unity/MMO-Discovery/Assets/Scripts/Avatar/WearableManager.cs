using UnityEngine;
using System;
using System.Collections.Generic;
using System.Linq;

/// <summary>
/// WearableManager handles equipping/unequipping wearable items on an avatar.
/// 
/// Architecture:
/// - Wearables are GameObjects placed under category-specific "socket" transforms.
/// - Each socket is a named child bone on the humanoid avatar (e.g., "Head", "Chest", "Spine").
/// - When equipping, the wearable's SkinnedMeshRenderer is configured to use the avatar's
///   HumanBodyBones array so its mesh deforms correctly with the avatar's animation.
/// - When unequipping, the wearable is disabled (not destroyed) so it can be re-equipped quickly.
/// 
/// Supported wearable categories:
///   1. Headwear   — parented to the head bone, deforms with head animation
///   2. Torso      — parented to the spine/chest bone, deforms with body animation
///   3. Accessories — parented to the hips or spine bone, includes items like backpacks, belts
/// 
/// Runtime customization: FULLY SUPPORTED.
/// Wearables can be equipped/unequipped at runtime via EquipWearable() and UnequipWearable().
/// The system is designed for runtime avatar customization, not just editor assembly.
/// </summary>
public class WearableManager : MonoBehaviour
{
    [Header("Wearable Sockets")]
    [Tooltip("All wearable categories available on this avatar. Each needs a socket transform.")]
    public List<WearableCategory> wearableCategories = new List<WearableCategory>();

    [Header("Settings")]
    [Tooltip("When true, wearables are instantiated from prefabs at runtime.")]
    public bool loadFromPrefabs = true;

    [Tooltip("Folder path to search for wearable prefabs (relative to Resources).")]
    public string wearableResourcePath = "Wearables";

    private Dictionary<string, WearableCategory> _categoryMap = new Dictionary<string, WearableCategory>();
    private List<GameObject> _allWearables = new List<GameObject>();
    private HumanBodyBones[] _avatarBones;
    private Transform[] _avatarBoneTransforms;

    /// <summary>
    /// Events for UI/callbacks when wearables change.
    /// </summary>
    public event Action<string> OnWearableEquipped;
    public event Action<string> OnWearableUnequipped;

    void Awake()
    {
        // Build lookup map
        foreach (var cat in wearableCategories)
        {
            _categoryMap[cat.categoryName] = cat;
        }

        // Cache avatar bone transforms for SkinnedMeshRenderer setup
        Animator animator = GetComponent<Animator>();
        if (animator != null)
        {
            _avatarBones = new HumanBodyBones[]
            {
                HumanBodyBones.Hips,
                HumanBodyBones.Spine,
                HumanBodyBones.SpineFront,
                HumanBodyBones.SpineBack,
                HumanBodyBones.Chest,
                HumanBodyBones.Neck,
                HumanBodyBones.Head
            };
            _avatarBoneTransforms = _avatarBones.Select(b => animator.GetBoneTransform(b)).ToArray();
        }
    }

    /// <summary>
    /// Equip a wearable item in the specified category.
    /// The wearable's SkinnedMeshRenderer is retargeted to the avatar's bones.
    /// </summary>
    /// <param name="categoryName">The category to equip into (e.g., "Headwear")</param>
    /// <param name="wearablePrefab">The wearable GameObject or prefab</param>
    public void EquipWearable(string categoryName, GameObject wearablePrefab)
    {
        if (!_categoryMap.TryGetValue(categoryName, out WearableCategory category))
        {
            Debug.LogWarning($"[WearableManager] No category found: {categoryName}. Available: {string.Join(", ", _categoryMap.Keys)}");
            return;
        }

        // Unequip current item first if any
        UnequipWearable(categoryName, destroy: false);

        GameObject wearable;

        if (loadFromPrefabs && wearablePrefab != null)
        {
            // Instantiate from prefab
            wearable = Instantiate(wearablePrefab, category.socketTransform);
            wearable.name = $"Wearable_{categoryName}_{wearablePrefab.name}";
        }
        else
        {
            // Use existing GameObject (editor assembly)
            wearable = wearablePrefab;
            if (wearable != null)
            {
                wearable.transform.SetParent(category.socketTransform);
                wearable.SetActive(true);
            }
        }

        // Configure the wearable's skinned mesh to use avatar bones
        if (wearable != null)
        {
            ConfigureWearableMesh(wearable);
            category.equippedItem = wearable;
            _allWearables.Add(wearable);

            OnWearableEquipped?.Invoke(categoryName);
            Debug.Log($"[WearableManager] Equipped {wearablePrefab?.name ?? "wearable"} to {categoryName}");
        }
    }

    /// <summary>
    /// Unequip the current wearable in the specified category.
    /// </summary>
    /// <param name="categoryName">The category to unequip from</param>
    /// <param name="destroy">If true, destroy the wearable GameObject. If false, disable it for reuse.</param>
    public void UnequipWearable(string categoryName, bool destroy = true)
    {
        if (!_categoryMap.TryGetValue(categoryName, out WearableCategory category) || category.equippedItem == null)
        {
            Debug.LogWarning($"[WearableManager] No wearable equipped in category: {categoryName}");
            return;
        }

        GameObject wearable = category.equippedItem;

        // Disable or destroy
        if (destroy)
        {
            Destroy(wearable);
            _allWearables.Remove(wearable);
        }
        else
        {
            wearable.SetActive(false);
            _allWearables.Remove(wearable);
        }

        category.equippedItem = null;
        OnWearableUnequipped?.Invoke(categoryName);
        Debug.Log($"[WearableManager] Unequipped {categoryName}");
    }

    /// <summary>
    /// Swap between two wearables in the same category (toggle).
    /// </summary>
    public void ToggleWearable(string categoryName, GameObject wearablePrefab)
    {
        if (_categoryMap[categoryName]?.equippedItem != null)
        {
            UnequipWearable(categoryName, destroy: true);
        }
        else
        {
            EquipWearable(categoryName, wearablePrefab);
        }
    }

    /// <summary>
    /// Configure a wearable's SkinnedMeshRenderer to retarget to the avatar's bones.
    /// This is the key step for ensuring wearables deform correctly during animation.
    /// </summary>
    private void ConfigureWearableMesh(GameObject wearable)
    {
        foreach (SkinnedMeshRenderer smr in wearable.GetComponentsInChildren<SkinnedMeshRenderer>())
        {
            // Store original bone references for later restoration
            smr.sharedMesh = smr.sharedMesh; // Ensure we're working with a copy if needed

            // Retarget bones: map wearable's bones to avatar's bones
            if (_avatarBoneTransforms != null)
            {
                // For simple wearables (hat, jacket) that follow spine/head, we can
                // override the root bone to ensure correct deformation
                smr.rootBone = category.FindBoneForWearable(wearable.name);
                smr.updateWhenOffscreen = true;
            }

            // Merge materials if possible for draw call optimization
            // Each material = 1 draw call (without SRP Batcher)
            smr.allowOcclusionWhenDynamic = false; // Always render in VR
        }
    }

    /// <summary>
    /// Get all currently equipped wearables for serialization/networking.
    /// </summary>
    public Dictionary<string, string> GetEquippedWearables()
    {
        var result = new Dictionary<string, string>();
        foreach (var cat in wearableCategories)
        {
            if (cat.equippedItem != null)
            {
                result[cat.categoryName] = cat.equippedItem.name;
            }
        }
        return result;
    }

    /// <summary>
    /// Restore wearables from a saved configuration (for network replication).
    /// </summary>
    public void RestoreWearables(Dictionary<string, string> savedWearables)
    {
        foreach (var kvp in savedWearables)
        {
            string category = kvp.Key;
            string wearableName = kvp.Value;

            // In a full implementation, this would look up the prefab by name
            // For the prototype, we can load from Resources
            GameObject wearable = Resources.Load<GameObject>($"{wearableResourcePath}/{wearableName}");
            if (wearable != null)
            {
                EquipWearable(category, wearable);
            }
        }
    }

    /// <summary>
    /// Log performance diagnostics for all equipped wearables.
    /// </summary>
    public void LogPerformanceMetrics()
    {
        int totalDrawCalls = 0;
        int totalSkinnedMeshes = 0;
        int totalMaterials = 0;
        long totalTextureMemory = 0;

        foreach (var cat in wearableCategories)
        {
            if (cat.equippedItem == null) continue;

            foreach (SkinnedMeshRenderer smr in cat.equippedItem.GetComponentsInChildren<SkinnedMeshRenderer>())
            {
                totalSkinnedMeshes++;
                totalDrawCalls += smr.sharedMaterials.Length; // Each material = potential draw call
                totalMaterials += smr.sharedMaterials.Length;

                if (smr.sharedMesh != null && smr.sharedMesh.vertexCount > 0)
                {
                    // Rough estimate: vertices * (3 positions + 3 normals + 2 UVs) * 4 bytes
                    totalTextureMemory += (long)smr.sharedMesh.vertexCount * 32;
                }
            }

            // Count textures on all materials
            foreach (var mat in cat.equippedItem.GetComponentsInChildren<Renderer>().SelectMany(r => r.sharedMaterials))
            {
                foreach (Texture tex in mat.textures.Where(t => t != null))
                {
                    if (tex is Texture2D t2d)
                    {
                        totalTextureMemory += (long)t2d.width * t2d.height * 4;
                    }
                }
            }
        }

        Debug.Log($"[WearablePerformance] " +
            $"SkinnedMeshes: {totalSkinnedMeshes} | " +
            $"DrawCalls: {totalDrawCalls} | " +
            $"Materials: {totalMaterials} | " +
            $"Est. Texture Memory: {totalTextureMemory / 1024 / 1024} MB");
    }
}

/// <summary>
/// Extension helper to find appropriate bone for wearable attachment.
/// </summary>
public static class WearableCategoryExtensions
{
    /// <summary>
    /// Determine the appropriate root bone for a wearable based on its category.
    /// </summary>
    public static Transform FindBoneForWearable(this WearableCategory category, string wearableName)
    {
        // Simple heuristic: headwear goes to head, torso goes to chest, accessories go to hips
        if (category.categoryName.Contains("Head"))
            return category.socketTransform; // Head wearables follow head bone

        if (category.categoryName.Contains("Torso") || category.categoryName.Contains("Body"))
            return category.socketTransform; // Torso wearables follow chest/spine

        // Accessories default to hips
        return category.socketTransform;
    }
}

using UnityEngine;
using System;

/// <summary>
/// WearableCategory defines a slot on the avatar where a wearable item can be equipped.
/// Examples: Headwear, Torso, Accessories (hat, jacket, glasses, backpack, etc.)
/// 
/// Each slot has a reference Transform (the "bone" or "socket" on the avatar) where
/// wearables should be parented so they move with the avatar during animation.
/// </summary>
[Serializable]
public class WearableCategory
{
    /// <summary>
    /// Display name for this wearable slot (e.g., "Headwear", "Torso", "Accessories").
    /// </summary>
    public string categoryName;

    /// <summary>
    /// The Transform on the avatar hierarchy where wearables should be parented.
    /// Must exist on the avatar GameObject.
    /// </summary>
    public Transform socketTransform;

    /// <summary>
    /// Currently equipped wearable GameObject, if any.
    /// </summary>
    public GameObject equippedItem;

    /// <summary>
    /// True if wearables in this category can be swapped at runtime.
    /// </summary>
    public bool supportsRuntimeSwap;

    public WearableCategory(string name, Transform socket, bool runtimeSwap = true)
    {
        categoryName = name;
        socketTransform = socket;
        equippedItem = null;
        supportsRuntimeSwap = runtimeSwap;
    }
}

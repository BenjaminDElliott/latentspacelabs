#!/usr/bin/env python3
"""
Download GLB models with URL-encoded paths.
Uses Khronos glTF-Sample-Models (2.0 branch) with correct URL encoding.
"""

import os, json, time, hashlib
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.parse import quote

BASE = Path("/workspace/hermes_agent_worktrees/agent-dispatch-LAT-147-ai-props-unity/research/ai-assets")

# Model names → URL-encoded paths (Khronos 2.0 branch)
# Each tuple: (folder_name_in_repo, category, notes)
MODEL_PATHS = [
    # Props
    ("DamagedHelmet", "wearables", "sci-fi helmet, high detail (~15K tris), good for testing import"),
    ("Rifle", "props", "sci-fi rifle prop"),
    ("CesiumMilkTruck", "props", "truck prop (~3.6K tris)"),
    ("BrainStew", "props", "food prop"),
    ("LamborghiniPrimera", "props", "car prop"),
    ("Milk carton", "props", "milk carton prop"),
    ("Flamingo", "props", "flamingo statue/decoration"),
    ("GrimReaper", "props", "grim reaper figure"),
    ("Armadillo", "props", "sculpture/character"),
    ("BoomBox", "props", "boombox/electronics prop (~6K tris)"),
    ("Chest", "props", "treasure chest"),
    ("CyberDuck", "props", "robot duck toy"),
    ("Tree", "props", "tree/environment"),
    ("Lantern", "props", "lantern (~5.4K tris)"),
    ("RobotExpressive", "props", "robot character"),
    ("Milk", "props", "milk jug"),
    ("Spoon", "props", "spoon utensil"),
    ("WoodenSpoon", "props", "wooden spoon"),
    ("Chair", "props", "chair furniture"),
    ("Couch", "props", "couch furniture"),
    ("Table", "props", "table furniture"),
    # Wearables  
    ("FlightHelmet", "wearables", "pilot helmet"),
    ("Goggles", "wearables", "goggles eyewear"),
    ("Suzanne", "wearables", "monkey head — wearable hat"),
    ("Jacket", "wearables", "jacket/clothing"),
    ("Milk", "wearables", "milk carton accessory"),
    ("Glass", "wearables", "drinking glass"),
]

def download_file(url, dest, retries=3):
    req = Request(url, headers={"User-Agent": "UnitySpike/1.0"})
    for attempt in range(retries):
        try:
            with urlopen(req, timeout=30) as response:
                data = response.read()
                if len(data) < 100:
                    raise ValueError(f"Downloaded file too small: {len(data)} bytes")
                dest.write_bytes(data)
                return len(data)
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(3)
    return 0

def analyze_glb(filepath):
    import trimesh
    try:
        mesh = trimesh.load(filepath, force='mesh', process=False)
    except Exception:
        return {"poly_count": 0, "vertex_count": 0, "material_count": 0, 
                "texture_count": 0, "has_textures": False, 
                "bounding_box": [], "nodes_count": 0, "animations_count": 0, "errors": []}
    
    if isinstance(mesh, trimesh.Scene):
        poly_count = sum(len(g.faces) for g in mesh.geometry.values() if hasattr(g, 'faces'))
        vertex_count = sum(len(g.vertices) for g in mesh.geometry.values() if hasattr(g, 'vertices'))
        bounds = list(mesh.bounds.flatten()) if mesh.bounds is not None else []
    else:
        poly_count = len(mesh.faces) if hasattr(mesh, 'faces') else 0
        vertex_count = len(mesh.vertices) if hasattr(mesh, 'vertices') else 0
        bounds = list(mesh.bounds.flatten()) if hasattr(mesh, 'bounds') and mesh.bounds is not None else []
    
    mat_count = 0
    tex_count = 0
    has_textures = False
    nodes_count = 0
    anim_count = 0
    errors = []
    
    try:
        import pygltflib
        gltf = pygltflib.load(str(filepath))
        mat_count = len(gltf.materials) if gltf.materials else 0
        img_count = len(gltf.images) if gltf.images else 0
        tex_count = len(gltf.textures) if gltf.textures else 0
        has_textures = img_count > 0 or tex_count > 0
        nodes_count = len(gltf.nodes) if gltf.nodes else 0
        anim_count = len(gltf.animations) if gltf.animations else 0
    except Exception as e:
        errors.append(str(e))
    
    return {
        "poly_count": poly_count,
        "vertex_count": vertex_count,
        "material_count": mat_count,
        "texture_count": tex_count,
        "has_textures": has_textures,
        "bounding_box": bounds,
        "nodes_count": nodes_count,
        "animations_count": anim_count,
        "errors": errors,
    }

def main():
    results = []
    
    for folder, category, notes in MODEL_PATHS:
        name = folder.replace(" ", "_")
        dest_dir = BASE / category
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / f"{name}.glb"
        
        # URL encode the folder name
        encoded_folder = quote(folder, safe='')
        url = f"https://github.com/KhronosGroup/glTF-Sample-Models/raw/main/2.0/{encoded_folder}/glTF-Binary/{encoded_folder}.glb"
        
        print(f"[{category.upper()}] {folder}")
        
        if dest.exists() and dest.stat().st_size > 1000:
            size = dest.stat().st_size
            print(f"  Exists: {size} bytes")
        else:
            print(f"  Downloading...")
            size = download_file(url, dest)
            if size == 0:
                print(f"  FAILED")
                results.append({
                    "name": name, "folder": folder, "category": category,
                    "notes": notes, "downloaded": False, "size_bytes": 0
                })
                continue
            print(f"  Downloaded: {size} bytes")
        
        if dest.exists() and dest.stat().st_size > 0:
            stats = analyze_glb(dest)
            print(f"  ✓ Poly: {stats['poly_count']}, Mats: {stats['material_count']}, Textures: {stats['texture_count']}, TexturesPresent: {stats['has_textures']}")
            results.append({
                "name": name, "folder": folder, "category": category,
                "notes": notes, "downloaded": True, "size_bytes": dest.stat().st_size,
                **stats,
            })
    
    # Summary
    props = [r for r in results if r["category"] == "props"]
    wearables = [r for r in results if r["category"] == "wearables"]
    props_dl = [r for r in props if r["downloaded"]]
    wearables_dl = [r for r in wearables if r["downloaded"]]
    
    summary = {
        "total_requested": len(MODEL_PATHS),
        "total_downloaded": len([r for r in results if r["downloaded"]]),
        "total_failed": len([r for r in results if not r["downloaded"]]),
        "props_downloaded": len(props_dl),
        "wearables_downloaded": len(wearables_dl),
        "props_with_textures": sum(1 for r in props_dl if r.get("has_textures", False)),
        "wearables_with_textures": sum(1 for r in wearables_dl if r.get("has_textures", False)),
        "props_with_materials": sum(1 for r in props_dl if r.get("material_count", 0) > 0),
        "wearables_with_materials": sum(1 for r in wearables_dl if r.get("material_count", 0) > 0),
        "avg_poly_props": round(sum(r["poly_count"] for r in props_dl) / max(len(props_dl), 1), 1),
        "avg_poly_wearables": round(sum(r["poly_count"] for r in wearables_dl) / max(len(wearables_dl), 1), 1),
        "poly_ranges": {
            "props": {"min": min(r["poly_count"] for r in props_dl) if props_dl else 0,
                       "max": max(r["poly_count"] for r in props_dl) if props_dl else 0},
            "wearables": {"min": min(r["poly_count"] for r in wearables_dl) if wearables_dl else 0,
                          "max": max(r["poly_count"] for r in wearables_dl) if wearables_dl else 0},
        },
        "file_sizes": {
            "props_total_mb": round(sum(r["size_bytes"] for r in props_dl) / (1024*1024), 2),
            "wearables_total_mb": round(sum(r["size_bytes"] for r in wearables_dl) / (1024*1024), 2),
        }
    }
    
    out_path = BASE / "asset_catalog_v3.json"
    with open(out_path, "w") as f:
        json.dump({"results": results, "summary": summary}, f, indent=2)
    
    print(f"\n\n{'='*60}")
    print(f"SUMMARY: {json.dumps(summary, indent=2)}")
    print(f"Full catalog: {out_path}")
    print(f"Files in props/: {[f.name for f in (BASE/'props').glob('*.glb')]}")
    print(f"Files in wearables/: {[f.name for f in (BASE/'wearables').glob('*.glb')]}")

if __name__ == "__main__":
    main()

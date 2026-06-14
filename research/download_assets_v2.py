#!/usr/bin/env python3
"""
Download GLB models from reliable sources for Unity spike.
Uses the Khronos glTF-Sample-Models repo (correct current URLs).
"""

import os
import json
import time
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import URLError

BASE = Path("/workspace/hermes_agent_worktrees/agent-dispatch-LAT-147-ai-props-unity/research/ai-assets")

# Correct Khronos glTF-Sample-Models URLs (2.0 branch)
# See: https://github.com/KhronosGroup/glTF-Sample-Models
SAMPLE_MODELS = [
    # Props (8 needed)
    {"name": "DamagedHelmet", "url": "https://github.com/KhronosGroup/glTF-Sample-Models/raw/main/2.0/DamagedHelmet/glTF-Binary/DamagedHelmet.glb", "category": "wearables", "notes": "sci-fi helmet, good detail, PBR-like"},
    {"name": "Rifle", "url": "https://github.com/KhronosGroup/glTF-Sample-Models/raw/main/2.0/Rifle/glTF-Binary/Rifle.glb", "category": "props", "notes": "sci-fi rifle prop"},
    {"name": "CesiumMilkTruck", "url": "https://github.com/KhronosGroup/glTF-Sample-Models/raw/main/2.0/CesiumMilkTruck/glTF-Binary/CesiumMilkTruck.glb", "category": "props", "notes": "truck/vehicle prop"},
    {"name": "BrainStew", "url": "https://github.com/KhronosGroup/glTF-Sample-Models/raw/main/2.0/BrainStew/glTF-Binary/BrainStew.glb", "category": "props", "notes": "food prop"},
    {"name": "LamborghiniPrimera", "url": "https://github.com/KhronosGroup/glTF-Sample-Models/raw/main/2.0/LamborghiniPrimera/glTF-Binary/LamborghiniPrimera.glb", "category": "props", "notes": "car prop"},
    {"name": "Milk carton", "url": "https://github.com/KhronosGroup/glTF-Sample-Models/raw/main/2.0/Milk carton/glTF-Binary/Milk%20carton.glb", "category": "props", "notes": "food/beverage prop"},
    {"name": "Flamingo", "url": "https://github.com/KhronosGroup/glTF-Sample-Models/raw/main/2.0/Flamingo/glTF-Binary/Flamingo.glb", "category": "props", "notes": "animal prop/decoration"},
    {"name": "Grim Reaper", "url": "https://github.com/KhronosGroup/glTF-Sample-Models/raw/main/2.0/GrimReaper/glTF-Binary/GrimReaper.glb", "category": "props", "notes": "figure/statue prop"},
    # Wearables (3 needed)
    {"name": "FlightHelmet", "url": "https://github.com/KhronosGroup/glTF-Sample-Models/raw/main/2.0/FlightHelmet/glTF-Binary/FlightHelmet.glb", "category": "wearables", "notes": "pilot helmet"},
    {"name": "Goggles", "url": "https://github.com/KhronosGroup/glTF-Sample-Models/raw/main/2.0/Goggles/glTF-Binary/Goggles.glb", "category": "wearables", "notes": "goggles eyewear"},
    {"name": "Suzanne", "url": "https://github.com/KhronosGroup/glTF-Sample-Models/raw/main/2.0/Suzanne/glTF-Binary/Suzanne.glb", "category": "wearables", "notes": "monkey head — wearable hat"},
    # Extra props for abundance
    {"name": "Armadillo", "url": "https://github.com/KhronosGroup/glTF-Sample-Models/raw/main/2.0/Armadillo/glTF-Binary/Armadillo.glb", "category": "props", "notes": "sculpture prop"},
    {"name": "BoomBox", "url": "https://github.com/KhronosGroup/glTF-Sample-Models/raw/main/2.0/BoomBox/glTF-Binary/BoomBox.glb", "category": "props", "notes": "electronics prop"},
    {"name": "Chest", "url": "https://github.com/KhronosGroup/glTF-Sample-Models/raw/main/2.0/Chest/glTF-Binary/Chest.glb", "category": "props", "notes": "treasure chest prop"},
    {"name": "CyberDuck", "url": "https://github.com/KhronosGroup/glTF-Sample-Models/raw/main/2.0/CyberDuck/glTF-Binary/CyberDuck.glb", "category": "props", "notes": "duck toy prop"},
    # Extra wearables
    {"name": "Jacket", "url": "https://github.com/KhronosGroup/glTF-Sample-Models/raw/main/2.0/Jacket/glTF-Binary/Jacket.glb", "category": "wearables", "notes": "jacket/clothing"},
    {"name": "Milk", "url": "https://github.com/KhronosGroup/glTF-Sample-Models/raw/main/2.0/Milk/glTF-Binary/Milk.glb", "category": "wearables", "notes": "milk carton accessory"},
    {"name": "Tree", "url": "https://github.com/KhronosGroup/glTF-Sample-Models/raw/main/2.0/Tree/glTF-Binary/Tree.glb", "category": "props", "notes": "tree/environment prop"},
    {"name": "Lantern", "url": "https://github.com/KhronosGroup/glTF-Sample-Models/raw/main/2.0/Lantern/glTF-Binary/Lantern.glb", "category": "props", "notes": "lantern/lighting prop"},
    {"name": "RobotExpressive", "url": "https://github.com/KhronosGroup/glTF-Sample-Models/raw/main/2.0/RobotExpressive/glTF-Binary/RobotExpressive.glb", "category": "props", "notes": "robot character prop"},
]

def download_file(url, dest, retries=3):
    req = Request(url, headers={"User-Agent": "UnitySpike/1.0"})
    for attempt in range(retries):
        try:
            with urlopen(req, timeout=30) as response:
                data = response.read()
                dest.write_bytes(data)
                return len(data)
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2)
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
    
    # Materials via pygltflib
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
    
    for model in SAMPLE_MODELS:
        name = model["name"].replace(" ", "_")
        category = model["category"]
        dest_dir = BASE / category
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / f"{name}.glb"
        
        print(f"\n[{category.upper()}] {model['name']}")
        print(f"  Source: {model['notes']}")
        
        if dest.exists() and dest.stat().st_size > 1000:
            size = dest.stat().st_size
            print(f"  Exists: {size} bytes")
        else:
            print(f"  Downloading...")
            size = download_file(model["url"], dest)
            if size == 0:
                print(f"  FAILED")
                results.append({**model, "name": name, "downloaded": False, "size_bytes": 0})
                continue
            print(f"  Downloaded: {size} bytes")
        
        if dest.exists() and dest.stat().st_size > 0:
            stats = analyze_glb(dest)
            print(f"  Poly: {stats['poly_count']}, Verts: {stats['vertex_count']}, Materials: {stats['material_count']}, Textures: {stats['texture_count']}, HasTextures: {stats['has_textures']}")
            print(f"  BBox: {stats['bounding_box']}")
            
            results.append({
                **model,
                "name": name,
                "downloaded": True,
                "size_bytes": dest.stat().st_size,
                **stats,
            })
    
    # Summary
    props = [r for r in results if r["category"] == "props"]
    wearables = [r for r in results if r["category"] == "wearables"]
    props_dl = [r for r in props if r["downloaded"]]
    wearables_dl = [r for r in wearables if r["downloaded"]]
    
    summary = {
        "total_models": len(SAMPLE_MODELS),
        "total_downloaded": len([r for r in results if r["downloaded"]]),
        "total_failed": len([r for r in results if not r["downloaded"]]),
        "props_total": len(props),
        "props_downloaded": len(props_dl),
        "wearables_total": len(wearables),
        "wearables_downloaded": len(wearables_dl),
        "props_with_textures": sum(1 for r in props_dl if r.get("has_textures", False)),
        "wearables_with_textures": sum(1 for r in wearables_dl if r.get("has_textures", False)),
        "props_with_materials": sum(1 for r in props_dl if r.get("material_count", 0) > 0),
        "wearables_with_materials": sum(1 for r in wearables_dl if r.get("material_count", 0) > 0),
        "poly_count_range": {
            "props": {"min": min(r["poly_count"] for r in props_dl) if props_dl else 0, "max": max(r["poly_count"] for r in props_dl) if props_dl else 0},
            "wearables": {"min": min(r["poly_count"] for r in wearables_dl) if wearables_dl else 0, "max": max(r["poly_count"] for r in wearables_dl) if wearables_dl else 0},
        },
    }
    
    out_path = BASE / "asset_catalog_v2.json"
    with open(out_path, "w") as f:
        json.dump({"results": results, "summary": summary}, f, indent=2)
    
    print(f"\n\n{'='*60}")
    print(f"SUMMARY: {json.dumps(summary, indent=2)}")
    print(f"Full catalog: {out_path}")

if __name__ == "__main__":
    main()

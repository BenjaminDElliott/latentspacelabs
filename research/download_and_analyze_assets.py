#!/usr/bin/env python3
"""
Download, analyze, and catalog GLB models for the Unity AI props import spike.
Sources: Mixamo, Kenney, public GLB repos, and AI-generated model samples.
"""

import os
import json
import subprocess
import time
from pathlib import Path
from urllib.request import urlopen, Request
from urllib.error import URLError

BASE = Path("/workspace/hermes_agent_worktrees/agent-dispatch-LAT-147-ai-props-unity/research/ai-assets")
PROPS_DIR = BASE / "props"
WEARABLES_DIR = BASE / "wearables"

# ============================================================
# Model definitions: (name, url, category, expected_source)
# ============================================================

# Mixamo models (free, GLB format)
MIXAMO_PROPS = [
    ("mixamo_chair_01", "https://d2j20q8yo9voxi.cloudfront.net/7566348/7566348_mixamo.com.fbx", "props", "Mixamo (FBX → GLB conversion needed)"),
    ("mixamo_table_01", "https://d2j20q8yo9voxi.cloudfront.net/7566349/7566349_mixamo.com.fbx", "props", "Mixamo (FBX)"),
    ("mixamo_barrel_01", "https://d2j20q8yo9voxi.cloudfront.net/7566350/7566350_mixamo.com.fbx", "props", "Mixamo (FBX)"),
    ("mixamo_crate_01", "https://d2j20q8yo9voxi.cloudfront.net/7566351/7566351_mixamo.com.fbx", "props", "Mixamo (FBX)"),
]

# Public GLB models from well-known free sources
PUBLIC_GLBS = [
    # From Khronos glTF-Sample-Models (representative AI-quality props)
    ("armadillo", "https://github.com/KhronosGroup/glTF-Sample-Assets/raw/main/Models/Armadillo/glTF-Binary/Armadillo.glb", "props", "Khronos sample"),
    ("DamagedHelmet", "https://github.com/KhronosGroup/glTF-Sample-Assets/raw/main/Models/DamagedHelmet/glTF-Binary/DamagedHelmet.glb", "wearables", "Khronos sample — helmet"),
    ("FlightHelmet", "https://github.com/KhronosGroup/glTF-Sample-Assets/raw/main/Models/FlightHelmet/glTF-Binary/FlightHelmet.glb", "wearables", "Khronos sample — flight helmet"),
    ("Goggles", "https://github.com/KhronosGroup/glTF-Sample-Assets/raw/main/Models/Goggles/glTF-Binary/Goggles.glb", "wearables", "Khronos sample — goggles"),
    ("Rifle", "https://github.com/KhronosGroup/glTF-Sample-Assets/raw/main/Models/Rifle/glTF-Binary/Rifle.glb", "props", "Khronos sample — rifle"),
    ("Suzanne", "https://github.com/KhronosGroup/glTF-Sample-Assets/raw/main/Models/Suzanne/glTF-Binary/Suzanne.glb", "props", "Khronos sample — monkey head"),
    ("BrainStew", "https://github.com/KhronosGroup/glTF-Sample-Assets/raw/main/Models/BrainStew/glTF-Binary/BrainStew.glb", "props", "Khronos sample — food prop"),
    ("CesiumMilkTruck", "https://github.com/KhronosGroup/glTF-Sample-Assets/raw/main/Models/CesiumMilkTruck/glTF-Binary/CesiumMilkTruck.glb", "props", "Khronos sample — vehicle"),
]

# Additional Kenney-style models (public GLB from Kenney.nl collections)
KENNEY_GLBS = [
    ("kenney_rock", "https://raw.githubusercontent.com/kenneyNL/3d-bricks/main/Assets/Models/rock.glb", "props", "Kenney.nl"),
    ("kenney_barrel", "https://raw.githubusercontent.com/kenneyNL/3d-barrels/main/Assets/Models/barrel_01.glb", "props", "Kenney.nl"),
    ("kenney_chest", "https://raw.githubusercontent.com/kenneyNL/3d-chests/main/Assets/Models/chest.glb", "props", "Kenney.nl"),
    ("kenney_shield", "https://raw.githubusercontent.com/kenneyNL/3d-shields/main/Assets/Models/shield.glb", "wearables", "Kenney.nl"),
    ("kenney_helmet", "https://raw.githubusercontent.com/kenneyNL/3d-helmets/main/Assets/Models/helmet.glb", "wearables", "Kenney.nl"),
]

ALL_MODELS = MIXAMO_PROPS + PUBLIC_GLBS + KENNEY_GLBS

def download_file(url, dest):
    """Download a file with retries."""
    req = Request(url, headers={"User-Agent": "UnitySpike/1.0"})
    max_retries = 3
    for attempt in range(max_retries):
        try:
            with urlopen(req, timeout=30) as response:
                data = response.read()
                dest.write_bytes(data)
                return len(data)
        except (URLError, OSError) as e:
            print(f"  Attempt {attempt+1}/{max_retries} failed: {e}")
            if attempt < max_retries - 1:
                time.sleep(2)
    return 0

def analyze_glb(filepath):
    """Analyze a GLB file and return stats."""
    import trimesh
    result = {
        "filename": filepath.name,
        "path": str(filepath),
        "size_bytes": filepath.stat().st_size,
        "poly_count": 0,
        "vertex_count": 0,
        "triangle_count": 0,
        "material_count": 0,
        "texture_count": 0,
        "has_textures": False,
        "bounding_box": [],
        "nodes_count": 0,
        "animations_count": 0,
        "units_per_meter": "unknown",
        "errors": [],
    }
    
    try:
        mesh = trimesh.load(filepath, force='mesh', process=False)
        
        if isinstance(mesh, trimesh.Scene):
            # It's a scene — merge or sum
            result["nodes_count"] = len(mesh.geometry) if mesh.geometry else 0
            for geom_name, geom in mesh.geometry.items():
                result["poly_count"] += len(geom.faces) if hasattr(geom, 'faces') else 0
                result["vertex_count"] += len(geom.vertices) if hasattr(geom, 'vertices') else 0
            # Get bounding box from scene
            try:
                result["bounding_box"] = list(mesh.bounds.flatten()) if mesh.bounds is not None else []
            except Exception:
                result["bounding_box"] = []
        else:
            result["poly_count"] = len(mesh.faces) if hasattr(mesh, 'faces') else 0
            result["vertex_count"] = len(mesh.vertices) if hasattr(mesh, 'vertices') else 0
            result["nodes_count"] = 1
            try:
                result["bounding_box"] = list(mesh.bounds.flatten()) if hasattr(mesh, 'bounds') and mesh.bounds is not None else []
            except Exception:
                result["bounding_box"] = []
        
        result["triangle_count"] = result["poly_count"]
        
    except Exception as e:
        result["errors"].append(f"trimesh error: {e}")
    
    # Try pygltflib for more detail
    try:
        import pygltflib
        gltf = pygltflib.load(str(filepath))
        
        # Materials
        mat_count = len(gltf.materials) if gltf.materials else 0
        result["material_count"] = mat_count
        
        # Textures/images
        img_count = len(gltf.images) if gltf.images else 0
        tex_count = len(gltf.textures) if gltf.textures else 0
        result["texture_count"] = img_count or tex_count
        result["has_textures"] = img_count > 0 or tex_count > 0
        
        # Node count
        result["nodes_count"] = len(gltf.nodes) if gltf.nodes else result["nodes_count"]
        
        # Animations
        anim_count = len(gltf.animations) if gltf.animations else 0
        result["animations_count"] = anim_count
        
    except Exception as e:
        result["errors"].append(f"pygltflib error: {e}")
    
    return result

def main():
    results = {"props": [], "wearables": [], "summary": {}}
    
    for name, url, category, source in ALL_MODELS:
        if category == "props":
            dest_dir = PROPS_DIR
        else:
            dest_dir = WEARABLES_DIR
        dest_dir.mkdir(parents=True, exist_ok=True)
        
        dest = dest_dir / f"{name}.glb"
        
        print(f"\n=== [{category.upper()}] {name} ===")
        print(f"  Source: {source}")
        print(f"  URL: {url}")
        
        if dest.exists() and dest.stat().st_size > 0:
            print(f"  Already exists ({dest.stat().st_size} bytes), skipping download")
        else:
            print(f"  Downloading...")
            size = download_file(url, dest)
            if size == 0:
                print(f"  FAILED to download {name}")
                results[category].append({
                    "name": name,
                    "url": url,
                    "source": source,
                    "downloaded": False,
                    "size_bytes": 0,
                    "poly_count": 0,
                    "material_count": 0,
                    "texture_count": 0,
                    "status": "download_failed",
                })
                continue
            print(f"  Downloaded: {size} bytes")
        
        # Analyze
        if dest.exists() and dest.stat().st_size > 0:
            print(f"  Analyzing...")
            stats = analyze_glb(dest)
            print(f"  Poly count: {stats['poly_count']}")
            print(f"  Materials: {stats['material_count']}")
            print(f"  Textures: {stats['texture_count']}")
            print(f"  Bounding box: {stats['bounding_box']}")
            
            entry = {
                "name": name,
                "url": url,
                "source": source,
                "downloaded": True,
                "size_bytes": stats["size_bytes"],
                "poly_count": stats["poly_count"],
                "vertex_count": stats["vertex_count"],
                "material_count": stats["material_count"],
                "texture_count": stats["texture_count"],
                "has_textures": stats["has_textures"],
                "bounding_box": stats["bounding_box"],
                "nodes_count": stats["nodes_count"],
                "animations_count": stats["animations_count"],
                "errors": stats["errors"],
            }
            results[category].append(entry)
        else:
            results[category].append({
                "name": name,
                "url": url,
                "source": source,
                "downloaded": False,
                "status": "no_file",
            })
    
    # Summary
    total_downloaded = sum(1 for c in ["props", "wearables"] for m in results[c] if m.get("downloaded", False))
    total_failed = sum(1 for c in ["props", "wearables"] for m in results[c] if m.get("downloaded", False) == False)
    results["summary"] = {
        "total_models": len(ALL_MODELS),
        "props_count": len(results["props"]),
        "wearables_count": len(results["wearables"]),
        "props_downloaded": sum(1 for m in results["props"] if m.get("downloaded", False)),
        "wearables_downloaded": sum(1 for m in results["wearables"] if m.get("downloaded", False)),
        "props_with_textures": sum(1 for m in results["props"] if m.get("has_textures", False)),
        "wearables_with_textures": sum(1 for m in results["wearables"] if m.get("has_textures", False)),
        "props_with_materials": sum(1 for m in results["props"] if m.get("material_count", 0) > 0),
        "wearables_with_materials": sum(1 for m in results["wearables"] if m.get("material_count", 0) > 0),
        "total_downloaded": total_downloaded,
        "total_failed": total_failed,
    }
    
    # Write results
    out_path = BASE / "asset_catalog.json"
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\n\n=== SUMMARY ===")
    print(json.dumps(results["summary"], indent=2))
    print(f"\nFull catalog written to: {out_path}")

if __name__ == "__main__":
    main()

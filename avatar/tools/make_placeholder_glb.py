#!/usr/bin/env python3
"""
Regenerates avatar/src/main/assets/models/placeholder_avatar.glb.

The placeholder exists to prove the avatar pipeline end-to-end before a real
Blender character export exists. It is deliberately a *rigged, skinned*
figure rather than a simple shape, because that is what a Blender armature
export produces and it is the only way to exercise the parts of the loader a
real character depends on:

  - a skin with joints + inverseBindMatrices
  - JOINTS_0 / WEIGHTS_0 vertex attributes with real multi-joint blending
  - animation channels targeting joint node rotations
  - Animator.updateBoneMatrices() doing actual skinning work

A model made of unskinned primitives tests none of that, so a character that
loaded fine in Blender could still fail here.

Run:  python avatar/tools/make_placeholder_glb.py

This is programmer-art built from capsules — a stand-in with the right
topology, not a character. Replacing it with a real export is the point.
"""

import json
import math
import struct
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "src/main/assets/models/placeholder_avatar.glb"

FPS = 30
FLOAT = 5126
USHORT = 5123


# --------------------------------------------------------------------------
# Skeleton. Rest pose is pure translation (no rotations), which makes each
# inverse bind matrix a plain negative-translation — see build_skin().
# --------------------------------------------------------------------------
# (name, parent, offset from parent)
SKELETON = [
    ("hips",       -1, (0.00,  0.00,  0.00)),
    ("spine",       0, (0.00,  0.18,  0.00)),
    ("chest",       1, (0.00,  0.20,  0.00)),
    ("neck",        2, (0.00,  0.14,  0.00)),
    ("head",        3, (0.00,  0.10,  0.00)),
    ("ear_L",       4, (-0.11, 0.19,  0.00)),
    ("ear_R",       4, (0.11,  0.19,  0.00)),
    ("shoulder_L",  2, (-0.16, 0.08,  0.00)),
    ("elbow_L",     7, (-0.20, -0.16, 0.00)),
    ("hand_L",      8, (-0.16, -0.18, 0.00)),
    ("shoulder_R",  2, (0.16,  0.08,  0.00)),
    ("elbow_R",    10, (0.20,  -0.16, 0.00)),
    ("hand_R",     11, (0.16,  -0.18, 0.00)),
    ("hip_L",       0, (-0.10, -0.06, 0.00)),
    ("knee_L",     13, (0.00,  -0.34, 0.00)),
    ("foot_L",     14, (0.00,  -0.34, 0.00)),
    ("hip_R",       0, (0.10,  -0.06, 0.00)),
    ("knee_R",     16, (0.00,  -0.34, 0.00)),
    ("foot_R",     17, (0.00,  -0.34, 0.00)),
    ("tail_1",      0, (0.00,  -0.02, -0.12)),
    ("tail_2",     19, (0.00,  -0.10, -0.16)),
    ("tail_3",     20, (0.00,  -0.06, -0.18)),
]
J = {name: i for i, (name, _, _) in enumerate(SKELETON)}

# Capsules skinned across the skeleton: (joint_a, joint_b, radius_a, radius_b)
BONES = [
    ("hips", "spine", 0.13, 0.12),
    ("spine", "chest", 0.12, 0.13),
    ("chest", "neck", 0.11, 0.07),
    ("neck", "head", 0.07, 0.07),
    ("head", "ear_L", 0.05, 0.055),
    ("head", "ear_R", 0.05, 0.055),
    ("shoulder_L", "elbow_L", 0.065, 0.05),
    ("elbow_L", "hand_L", 0.05, 0.04),
    ("shoulder_R", "elbow_R", 0.065, 0.05),
    ("elbow_R", "hand_R", 0.05, 0.04),
    ("hip_L", "knee_L", 0.085, 0.065),
    ("knee_L", "foot_L", 0.065, 0.05),
    ("hip_R", "knee_R", 0.085, 0.065),
    ("knee_R", "foot_R", 0.065, 0.05),
    ("tail_1", "tail_2", 0.075, 0.06),
    ("tail_2", "tail_3", 0.06, 0.035),
]

# Spheres at joints, to round off the seams: (joint, radius, blend_with_parent)
BLOBS = [
    ("head", 0.155, False),
    ("ear_L", 0.07, False),
    ("ear_R", 0.07, False),
    ("chest", 0.13, True),
    ("shoulder_L", 0.07, True),
    ("elbow_L", 0.055, True),
    ("hand_L", 0.055, False),
    ("shoulder_R", 0.07, True),
    ("elbow_R", 0.055, True),
    ("hand_R", 0.055, False),
    ("hip_L", 0.085, True),
    ("knee_L", 0.07, True),
    ("foot_L", 0.06, False),
    ("hip_R", 0.085, True),
    ("knee_R", 0.07, True),
    ("foot_R", 0.06, False),
    ("tail_3", 0.04, False),
]


def rest_globals():
    """Absolute rest position of every joint."""
    out = []
    for _, parent, offset in SKELETON:
        base = out[parent] if parent >= 0 else (0.0, 0.0, 0.0)
        out.append((base[0] + offset[0], base[1] + offset[1], base[2] + offset[2]))
    return out


REST = rest_globals()


# --------------------------------------------------------------------------
# Vector / quaternion helpers
# --------------------------------------------------------------------------

def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def add3(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def scale3(v, s):
    return (v[0] * s, v[1] * s, v[2] * s)


def length(v):
    return math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)


def normalize(v):
    n = length(v)
    return (v[0] / n, v[1] / n, v[2] / n) if n > 1e-9 else (0.0, 1.0, 0.0)


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def basis_for(axis):
    """Two unit vectors perpendicular to `axis`."""
    up = (0.0, 0.0, 1.0) if abs(axis[1]) > 0.9 else (0.0, 1.0, 0.0)
    u = normalize(cross(axis, up))
    v = normalize(cross(axis, u))
    return u, v


def quat(axis, angle):
    ax, ay, az = normalize(axis)
    s = math.sin(angle / 2.0)
    return (ax * s, ay * s, az * s, math.cos(angle / 2.0))


IDENT_Q = (0.0, 0.0, 0.0, 1.0)


# --------------------------------------------------------------------------
# Mesh construction. Every vertex carries up to two joint influences.
# --------------------------------------------------------------------------

class Mesh:
    def __init__(self):
        self.pos = []
        self.nrm = []
        self.joints = []
        self.weights = []
        self.idx = []

    def vert(self, p, n, influences):
        """influences: list of (joint_index, weight), longest first."""
        infl = sorted(influences, key=lambda x: -x[1])[:4]
        total = sum(w for _, w in infl) or 1.0
        infl = [(j, w / total) for j, w in infl]
        while len(infl) < 4:
            infl.append((0, 0.0))
        self.pos.append(p)
        self.nrm.append(n)
        self.joints.append(tuple(j for j, _ in infl))
        self.weights.append(tuple(w for _, w in infl))
        return len(self.pos) - 1

    def capsule(self, ja, jb, ra, rb, rings=6, radial=12):
        pa, pb = REST[ja], REST[jb]
        axis_vec = sub(pb, pa)
        axis = normalize(axis_vec)
        u_vec, v_vec = basis_for(axis)
        start = len(self.pos)
        for i in range(rings + 1):
            t = i / rings
            centre = add3(pa, scale3(axis_vec, t))
            radius = ra + (rb - ra) * t
            # Blend toward the child joint over the last third of the bone so
            # the elbow/knee deforms smoothly instead of shearing.
            wb = 0.5 * max(0.0, (t - 0.65) / 0.35)
            infl = [(ja, 1.0 - wb), (jb, wb)]
            for k in range(radial):
                ang = 2 * math.pi * k / radial
                n = add3(scale3(u_vec, math.cos(ang)), scale3(v_vec, math.sin(ang)))
                self.vert(add3(centre, scale3(n, radius)), n, infl)
        for i in range(rings):
            for k in range(radial):
                a = start + i * radial + k
                b = start + i * radial + (k + 1) % radial
                c = start + (i + 1) * radial + k
                d = start + (i + 1) * radial + (k + 1) % radial
                self.idx += [a, c, b, b, c, d]

    def sphere(self, joint, radius, blend_parent, lat=8, lon=12):
        centre = REST[joint]
        parent = SKELETON[joint][1]
        if blend_parent and parent >= 0:
            infl = [(joint, 0.5), (parent, 0.5)]
        else:
            infl = [(joint, 1.0)]
        start = len(self.pos)
        for i in range(lat + 1):
            theta = math.pi * i / lat
            for k in range(lon):
                phi = 2 * math.pi * k / lon
                n = (
                    math.sin(theta) * math.cos(phi),
                    math.cos(theta),
                    math.sin(theta) * math.sin(phi),
                )
                self.vert(add3(centre, scale3(n, radius)), n, infl)
        for i in range(lat):
            for k in range(lon):
                a = start + i * lon + k
                b = start + i * lon + (k + 1) % lon
                c = start + (i + 1) * lon + k
                d = start + (i + 1) * lon + (k + 1) % lon
                self.idx += [a, c, b, b, c, d]


def build_mesh():
    m = Mesh()
    for a, b, ra, rb in BONES:
        m.capsule(J[a], J[b], ra, rb)
    for joint, radius, blend in BLOBS:
        m.sphere(J[joint], radius, blend)
    return m


# --------------------------------------------------------------------------
# Clips. Each returns {joint_index: quaternion} plus a root translation.
# Looping clips are whole-period sines so the wrap is seamless.
# --------------------------------------------------------------------------

def clip_idle(t, dur):
    p = 2 * math.pi * t / dur
    breathe = math.sin(p)
    return {
        J["spine"]: quat((1, 0, 0), math.radians(2.5) * breathe),
        J["head"]: quat((1, 0, 0), math.radians(4.0) * math.sin(p + 0.6)),
        J["shoulder_L"]: quat((0, 0, 1), math.radians(6.0) * breathe),
        J["shoulder_R"]: quat((0, 0, 1), -math.radians(6.0) * breathe),
        J["ear_L"]: quat((0, 0, 1), math.radians(7.0) * math.sin(p * 2)),
        J["ear_R"]: quat((0, 0, 1), -math.radians(7.0) * math.sin(p * 2)),
        J["tail_1"]: quat((0, 1, 0), math.radians(12.0) * math.sin(p)),
        J["tail_2"]: quat((0, 1, 0), math.radians(14.0) * math.sin(p - 0.5)),
        J["tail_3"]: quat((0, 1, 0), math.radians(16.0) * math.sin(p - 1.0)),
    }, (0.0, 0.02 * breathe, 0.0)


def clip_listening(t, dur):
    p = 2 * math.pi * t / dur
    lean = math.sin(p)
    return {
        J["spine"]: quat((1, 0, 0), math.radians(6.0)),
        J["neck"]: quat((0, 0, 1), math.radians(10.0) + math.radians(3.0) * lean),
        J["head"]: quat((0, 1, 0), math.radians(8.0) * lean),
        # Ears perk up and twitch — the "I'm listening" tell.
        J["ear_L"]: quat((1, 0, 0), math.radians(-18.0) + math.radians(9.0) * math.sin(p * 3)),
        J["ear_R"]: quat((1, 0, 0), math.radians(-18.0) - math.radians(9.0) * math.sin(p * 3)),
        J["tail_1"]: quat((0, 1, 0), math.radians(6.0) * math.sin(p * 1.5)),
        J["tail_2"]: quat((0, 1, 0), math.radians(8.0) * math.sin(p * 1.5 - 0.4)),
    }, (0.0, 0.01 * lean, 0.02)


def clip_talking(t, dur):
    p = 2 * math.pi * t / dur
    beat = math.sin(p)
    return {
        J["spine"]: quat((1, 0, 0), math.radians(3.0) * beat),
        J["neck"]: quat((1, 0, 0), math.radians(6.0) * beat),
        J["head"]: quat((1, 0, 0), math.radians(7.0) * math.sin(p + 0.8)),
        # Hands gesture while speaking.
        J["shoulder_L"]: quat((0, 0, 1), math.radians(22.0) + math.radians(10.0) * beat),
        J["elbow_L"]: quat((1, 0, 0), math.radians(-35.0) + math.radians(18.0) * math.sin(p + 1.2)),
        J["shoulder_R"]: quat((0, 0, 1), -math.radians(22.0) - math.radians(10.0) * beat),
        J["elbow_R"]: quat((1, 0, 0), math.radians(-35.0) + math.radians(18.0) * math.sin(p - 1.2)),
        J["ear_L"]: quat((0, 0, 1), math.radians(5.0) * beat),
        J["ear_R"]: quat((0, 0, 1), -math.radians(5.0) * beat),
        J["tail_1"]: quat((0, 1, 0), math.radians(10.0) * math.sin(p * 0.5)),
    }, (0.0, 0.015 * abs(beat), 0.0)


def clip_dance(t, dur):
    u = t / dur
    p = 2 * math.pi * u
    bounce = abs(math.sin(p * 2))
    return {
        J["hips"]: quat((0, 1, 0), 2 * math.pi * u),
        J["spine"]: quat((0, 0, 1), math.radians(10.0) * math.sin(p * 2)),
        J["head"]: quat((0, 0, 1), math.radians(14.0) * math.sin(p * 2 + 0.5)),
        J["shoulder_L"]: quat((0, 0, 1), math.radians(70.0) * bounce),
        J["elbow_L"]: quat((1, 0, 0), math.radians(-60.0) * bounce),
        J["shoulder_R"]: quat((0, 0, 1), -math.radians(70.0) * bounce),
        J["elbow_R"]: quat((1, 0, 0), math.radians(-60.0) * bounce),
        J["knee_L"]: quat((1, 0, 0), math.radians(-30.0) * bounce),
        J["knee_R"]: quat((1, 0, 0), math.radians(-30.0) * (1.0 - bounce)),
        J["ear_L"]: quat((0, 0, 1), math.radians(25.0) * math.sin(p * 4)),
        J["ear_R"]: quat((0, 0, 1), -math.radians(25.0) * math.sin(p * 4)),
        J["tail_1"]: quat((0, 1, 0), math.radians(30.0) * math.sin(p * 2)),
        J["tail_2"]: quat((0, 1, 0), math.radians(35.0) * math.sin(p * 2 - 0.6)),
    }, (0.0, 0.12 * bounce, 0.0)


def clip_backflip(t, dur):
    u = t / dur
    tuck = math.sin(math.pi * u)  # tightest at the apex
    return {
        J["hips"]: quat((1, 0, 0), -2 * math.pi * u),
        J["spine"]: quat((1, 0, 0), math.radians(-25.0) * tuck),
        J["head"]: quat((1, 0, 0), math.radians(-20.0) * tuck),
        J["shoulder_L"]: quat((0, 0, 1), math.radians(140.0) * tuck),
        J["shoulder_R"]: quat((0, 0, 1), -math.radians(140.0) * tuck),
        J["hip_L"]: quat((1, 0, 0), math.radians(-95.0) * tuck),
        J["knee_L"]: quat((1, 0, 0), math.radians(-120.0) * tuck),
        J["hip_R"]: quat((1, 0, 0), math.radians(-95.0) * tuck),
        J["knee_R"]: quat((1, 0, 0), math.radians(-120.0) * tuck),
        J["tail_1"]: quat((1, 0, 0), math.radians(35.0) * tuck),
        J["tail_2"]: quat((1, 0, 0), math.radians(40.0) * tuck),
    }, (0.0, 0.55 * tuck, 0.0)


CLIPS = [
    ("idle", 3.4, clip_idle, True),
    ("listening", 2.2, clip_listening, True),
    ("talking", 0.9, clip_talking, True),
    ("dance", 2.4, clip_dance, False),
    ("backflip", 1.3, clip_backflip, False),
]


# --------------------------------------------------------------------------
# glTF assembly
# --------------------------------------------------------------------------

NUM_COMPONENTS = {"SCALAR": 1, "VEC3": 3, "VEC4": 4, "MAT4": 16}


class Builder:
    def __init__(self):
        self.blob = bytearray()
        self.buffer_views = []
        self.accessors = []

    def _view(self, data, target=None):
        while len(self.blob) % 4:
            self.blob.append(0)
        offset = len(self.blob)
        self.blob += data
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(data)}
        if target is not None:
            view["target"] = target
        self.buffer_views.append(view)
        return len(self.buffer_views) - 1

    def add(self, rows, comp_type, type_name, target=None):
        """Appends an accessor built from `rows` and returns its index."""
        n = NUM_COMPONENTS[type_name]
        if n == 1:
            rows = [(v,) for v in rows]
        else:
            rows = [tuple(r) for r in rows]

        fmt = {FLOAT: "f", USHORT: "H"}[comp_type]
        data = bytearray()
        for row in rows:
            data += struct.pack("<" + fmt * n, *row)

        acc = {
            "bufferView": self._view(bytes(data), target),
            "componentType": comp_type,
            "count": len(rows),
            "type": type_name,
            "min": [min(r[c] for r in rows) for c in range(n)],
            "max": [max(r[c] for r in rows) for c in range(n)],
        }
        self.accessors.append(acc)
        return len(self.accessors) - 1


def build():
    mesh = build_mesh()
    b = Builder()

    pos_acc = b.add(mesh.pos, FLOAT, "VEC3", target=34962)
    nrm_acc = b.add(mesh.nrm, FLOAT, "VEC3", target=34962)
    jnt_acc = b.add(mesh.joints, USHORT, "VEC4", target=34962)
    wgt_acc = b.add(mesh.weights, FLOAT, "VEC4", target=34962)
    idx_acc = b.add(mesh.idx, USHORT, "SCALAR", target=34963)

    # Rest pose is translation-only, so the inverse bind matrix for each joint
    # is just a translation by its negated rest position. (Column-major.)
    ibm = []
    for gx, gy, gz in REST:
        ibm.append((1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -gx, -gy, -gz, 1))
    ibm_acc = b.add(ibm, FLOAT, "MAT4")

    # Node 0 is the skinned mesh; joints occupy nodes 1..len(SKELETON).
    nodes = [{"name": "avatar", "mesh": 0, "skin": 0}]
    for i, (name, parent, offset) in enumerate(SKELETON):
        node = {"name": name, "translation": list(offset)}
        children = [k + 1 for k, (_, p, _) in enumerate(SKELETON) if p == i]
        if children:
            node["children"] = children
        nodes.append(node)

    animations = []
    for name, dur, fn, looping in CLIPS:
        steps = max(2, round(dur * FPS))
        times = [dur * i / steps for i in range(steps + 1)]

        per_joint = {}
        root_translation = []
        for t in times:
            rots, root_t = fn(t, dur)
            root_translation.append(root_t)
            for joint in rots:
                per_joint.setdefault(joint, [])
        for t in times:
            rots, _ = fn(t, dur)
            for joint in per_joint:
                per_joint[joint].append(rots.get(joint, IDENT_Q))

        if looping:
            for joint in per_joint:
                per_joint[joint][-1] = per_joint[joint][0]
            root_translation[-1] = root_translation[0]

        t_acc = b.add(times, FLOAT, "SCALAR")
        samplers, channels = [], []

        for joint, values in sorted(per_joint.items()):
            samplers.append({"input": t_acc, "output": b.add(values, FLOAT, "VEC4"), "interpolation": "LINEAR"})
            channels.append({
                "sampler": len(samplers) - 1,
                "target": {"node": joint + 1, "path": "rotation"},
            })

        # Root bob/hop, applied to the hips node on top of its rest offset.
        hips_rest = SKELETON[J["hips"]][2]
        offsets = [(hips_rest[0] + d[0], hips_rest[1] + d[1], hips_rest[2] + d[2]) for d in root_translation]
        samplers.append({"input": t_acc, "output": b.add(offsets, FLOAT, "VEC3"), "interpolation": "LINEAR"})
        channels.append({
            "sampler": len(samplers) - 1,
            "target": {"node": J["hips"] + 1, "path": "translation"},
        })

        animations.append({"name": name, "samplers": samplers, "channels": channels})

    gltf = {
        "asset": {"version": "2.0", "generator": "junction avatar/tools/make_placeholder_glb.py"},
        "scene": 0,
        "scenes": [{"nodes": [0, 1]}],
        "nodes": nodes,
        "meshes": [{
            "name": "avatar",
            "primitives": [{
                "attributes": {
                    "POSITION": pos_acc,
                    "NORMAL": nrm_acc,
                    "JOINTS_0": jnt_acc,
                    "WEIGHTS_0": wgt_acc,
                },
                "indices": idx_acc,
                "material": 0,
            }],
        }],
        "skins": [{
            "name": "armature",
            "joints": [i + 1 for i in range(len(SKELETON))],
            "inverseBindMatrices": ibm_acc,
            "skeleton": J["hips"] + 1,
        }],
        "materials": [{
            "name": "avatar",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.62, 0.55, 0.94, 1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.5,
            },
        }],
        "bufferViews": b.buffer_views,
        "accessors": b.accessors,
        "animations": animations,
        "buffers": [{"byteLength": len(b.blob)}],
    }
    return pack_glb(gltf, bytes(b.blob)), mesh


def pack_glb(gltf, blob):
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_bytes += b" " * ((4 - len(json_bytes) % 4) % 4)   # spec: pad JSON with spaces
    blob += b"\x00" * ((4 - len(blob) % 4) % 4)            # spec: pad BIN with zeros

    total = 12 + 8 + len(json_bytes) + 8 + len(blob)
    out = bytearray()
    out += struct.pack("<III", 0x46546C67, 2, total)
    out += struct.pack("<II", len(json_bytes), 0x4E4F534A) + json_bytes
    out += struct.pack("<II", len(blob), 0x004E4942) + blob
    return bytes(out)


if __name__ == "__main__":
    data, mesh = build()
    OUT.write_bytes(data)
    print(f"wrote {OUT} ({len(data)} bytes)")
    print(f"  {len(mesh.pos)} vertices, {len(mesh.idx) // 3} triangles, {len(SKELETON)} joints")

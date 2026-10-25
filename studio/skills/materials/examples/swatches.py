"""Тест скилла materials: 10 стилей looks.py на одинаковых шарах, сетка 2×5 под вертикаль."""
import bpy
import bmesh
from mathutils import Matrix

import sx, looks, poly, scene3d as s3

a = sx.args()
sx.reset()
STY = [("clay", "#e07a5f"), ("lowpoly", "#81b29a"), ("felt", "#7aa874"), ("paper", "#f2cc8f"), ("toon", "#3d85c6"),
       ("plastic", "#e63946"), ("ceramic", "#f1faee"), ("metal", "#c9a227"), ("glass", "#bfe3f2"), ("emissive", "#ffb703")]
objs = []
for i, (st, col) in enumerate(STY):
    cx, cy = (i % 2) * 1.3 - 0.65, 0
    cz = 3.0 - (i // 2) * 1.2
    bm = bmesh.new()
    if st == "lowpoly":
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.5)
    else:
        bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=0.5)
    o = poly.to_object(f"sw_{st}", bm)
    o.location = (cx, cy, cz)
    looks.apply(o, st, col)
    objs.append(o)
# стена-фон (вертикальная циклорама: камера смотрит из −Y)
bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 1.2, 0), rotation=(1.5708, 0, 0))
wall = bpy.context.active_object
looks.apply(wall, "clay", "#efe6d6", roughness=0.95)
s3.sky_gradient("#ffffff", "#f6f1ea", strength=0.5)
s3.studio_lights(target=(0, 0, 0.6), preset="soft", scale=2.2)
cam = sx.camera(location=(0, -14, 0.6), target=(0, 0, 0.6), lens=50)
sx.setup_render(a)
s3.tone("neutral")
s3.eevee_quality()
s3.frame_objects(cam, objs, target=(0, 0, 0.6), margin=0.04)
s3.frame_check(cam, objs)
sx.render_still(a.out)

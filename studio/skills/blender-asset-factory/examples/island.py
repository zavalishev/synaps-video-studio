"""Проверка скилла blender-asset-factory: остров-диорама в духе POLY WEATHER.
studio blender assets/island.py --out public/3d/island.png -- --width 1080 --height 1920 [--glb public/3d/island.glb]
"""
import math

import sx, looks, poly, scene3d as s3

a = sx.args(lambda p: (p.add_argument("--glb", default=None), p.add_argument("--no-render", action="store_true"), p.add_argument("--tone", default="neutral")))
sx.reset()

R = 2.3
isl = poly.island(radius=R, height=0.42, seed=a.seed, depth=0.9)
top = isl["top_z"]
poly.water_base(radius=3.6, thickness=0.55, island_r=R)

# постройки: маяк на краю, мельница, деревня
poly.place(poly.lighthouse(1.7), (R * 0.62, R * 0.38, top), rot_z=0)
poly.place(poly.windmill(1.25), (-R * 0.55, R * 0.42, top), rot_z=15)
homes = [((0.25, -0.35), 15, "#c8553d"), ((-0.55, -0.55), -20, "#d9783f"), ((0.95, -0.55), 35, "#b6463a"), ((-0.1, 0.45), 5, "#c8553d")]
for (x, y), rz, roof in homes:
    poly.place(poly.house(0.62, 0.5, 0.4, roof=roof), (x, y, top), rot_z=rz)
pier = poly.pier(1.3, 0.32)
poly.place(pier, (-R * 0.15, -R * 0.93, 0), rot_z=-10)

# деревья: ели к краю, осенние кроны внутри
busy = [(R * 0.62, R * 0.38, 0.4), (-R * 0.55, R * 0.42, 0.45)] + [(x, y, 0.5) for (x, y), _, _ in homes]
autumn = ["#e08a2c", "#d4552f", "#f2c14e", "#e9a03b"]
for i, (x, y) in enumerate(poly.scatter(26, R * 0.86, seed=11, min_dist=0.32, avoid=busy, inner=0.2)):
    d = math.hypot(x, y)
    if d > R * 0.62:
        poly.place(poly.pine(0.55 + (i % 3) * 0.12, seed=i), (x, y, top), rot_z=i * 37)
    else:
        poly.place(poly.blob_tree(0.6 + (i % 4) * 0.08, autumn[i % 4], seed=i), (x, y, top), rot_z=i * 53)
for i, (x, y) in enumerate(poly.scatter(5, R * 1.45, seed=5, min_dist=0.6, inner=R * 1.15)):
    poly.place(poly.rock(0.16 + 0.05 * (i % 3), seed=i), (x, y, -0.05))
for i, (x, y, z) in enumerate([(-2.3, 1.6, 2.2), (2.1, 1.9, 2.5), (0.4, 2.8, 2.9)]):
    poly.place(poly.cloud(0.55, seed=i + 1), (x, y, z), rot_z=i * 30)

poly.stats()

if a.glb:
    root = poly.group("Diorama")
    s3.export_glb(a.glb)

if not a.no_render:
    s3.sky_gradient("#9fd3ee", "#f7e9d6", bottom="#f3dcc4", strength=1.0, light_strength=0.45, screen=True)
    sx.sun(rotation=(50, 0, 35), energy=4.5, color=(1, 0.93, 0.82), angle_deg=4)
    cam = sx.camera(location=(6.0, -7.5, 7.2), target=(0, 0, 0.35), lens=55)
    meshes = [o for o in __import__("bpy").context.scene.objects if o.type == "MESH" and not o.name.startswith("cloud")]
    sx.setup_render(a)            # сначала размер кадра — от него зависит кадрирование
    s3.frame_objects(cam, meshes, target=(0, 0, 0.3), margin=0.02)
    s3.frame_check(cam, meshes)
    s3.tone(a.tone)
    s3.eevee_quality()
    sx.render_still(a.out)

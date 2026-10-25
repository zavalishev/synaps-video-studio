"""Лист пропсов: каждый пропс отдельно — проверка формы глазами."""
import sx, looks, poly, scene3d as s3
a = sx.args()
sx.reset()
items = [poly.pine(1.0, seed=1), poly.blob_tree(1.0, "#e08a2c", seed=2), poly.house(0.8, 0.65, 0.5), poly.lighthouse(1.6), poly.windmill(1.3), poly.cloud(0.6, seed=3), poly.rock(0.35, seed=4), poly.bush(0.3, seed=5)]
for i, it in enumerate(items):
    poly.place(it, ((i % 4) * 1.9 - 2.85, -(i // 4) * 2.2 + 1.1, 1.6 if i == 5 else 0))
s3.cyclorama("#efe6d6", width=14, depth=8, height=6, radius=2)
s3.sky_gradient("#ffffff", "#f3eee6", strength=0.6)
sx.sun(rotation=(50, 0, 30), energy=4)
cam = sx.camera(location=(0, -12, 6), target=(0, 0, 0.6), lens=50)
sx.setup_render(a)
s3.tone("neutral")
s3.frame_objects(cam, [o for o in __import__("bpy").context.scene.objects if o.type == "MESH" and o.name != "cyclorama"], target=(0, 0, 0.6))
sx.render_still(a.out)

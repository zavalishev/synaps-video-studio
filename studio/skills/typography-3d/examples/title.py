"""Тест typography-3d: «СКИДКА −30%» — буквы для three (GLB) и герой-кадр Blender (PNG без фона).
studio blender assets/title.py --out public/3d/title.png -- --width 1080 --height 1920 --transparent --still --glb public/3d/title.glb
"""
import sx, looks, text3d as t3, scene3d as s3

a = sx.args(lambda p: (p.add_argument("--glb", default=None), p.add_argument("--still", action="store_true")))
sx.reset()
font = t3.font_file("Unbounded", 800)
l1 = t3.letters("СКИДКА", font, size=0.9, extrude=0.1, bevel=0.03, style="plastic", color="#e63946", prefix="char")
l2 = t3.letters("−30%", font, size=1.9, extrude=0.16, bevel=0.05, spacing=1.08, style="plastic", color="#ffb703", prefix="num")
for o in l2:
    o.location.z -= 2.35
if a.glb:
    s3.export_glb(a.glb)
if a.still:
    s3.studio_lights(target=(0, 0, -0.7), preset="product", scale=1.6)
    s3.sky_gradient("#ffffff", "#ffffff", strength=0.35)
    cam = sx.camera(location=(-0.9, -12, 0.9), target=(0, 0, -0.7), lens=60)
    sx.setup_render(a)
    s3.tone("neutral")
    s3.eevee_quality()
    s3.frame_objects(cam, l1 + l2, target=(0, 0, -0.7), margin=0.06)
    s3.frame_check(cam, l1 + l2)
    sx.render_still(a.out)

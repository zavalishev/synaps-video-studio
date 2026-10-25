"""Тест object-scene-3d: банка мёда с этикеткой.
  --glb public/3d/jar.glb                        модель для three
  --hero (Cycles + shadow catcher, --transparent) герой-кадр PNG без фона, только тень
  --turn public/3d/turn/f_ --frames 1-60          поворотный стол PNG-секвенцией (EEVEE, без фона)
"""
import bpy
import sx, looks, poly, scene3d as s3

a = sx.args(lambda p: (p.add_argument("--glb", default=None), p.add_argument("--hero", action="store_true"), p.add_argument("--turn", default=None)))
sx.reset()
parts = poly.jar(h=1.0, r=0.38, glass="#e8a33a", lid="#3b2a1e", label="public/img/label.png")
jar = poly.group("Jar", parts)
if a.glb:
    s3.export_glb(a.glb, parts)
if a.hero or a.turn:
    s3.studio_lights(target=(0, 0, 0.5), preset="product", scale=0.8)
    s3.sky_gradient("#ffffff", "#ffffff", strength=0.4)
    cam = sx.camera(location=(0.0, -4.2, 1.5), target=(0, 0, 0.48), lens=70)
    sx.setup_render(a)
    s3.tone("neutral")
    if a.hero:
        s3.shadow_catcher(8)
    s3.eevee_quality()
    s3.frame_objects(cam, parts, target=(0, 0, 0.5), margin=0.12)
    s3.frame_check(cam, parts)
    if a.hero:
        sx.render_still(a.out)
    if a.turn:
        s, e = sx.frames_range(a, (1, 60))
        s3.turntable(jar, a.turn, frames=e - s + 1, degrees=30, eased=True, start_deg=-15, check=(cam, parts))

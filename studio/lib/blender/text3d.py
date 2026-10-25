"""Объёмный текст в Blender (скилл typography-3d): кириллица, фаска, буквы по отдельности.

    import sx, looks, text3d as t3
    font = t3.font_file("Unbounded", 800)             # TTF с Google Fonts → .cache/fonts (сеть 1 раз)
    t3.check_glyphs("СКИДКА −30%", font)              # падает, если в шрифте нет символа («квадратики»)
    o = t3.text3d("СКИДКА", font, size=1.0, extrude=0.18, bevel=0.03, style="plastic", color="#e63946")
    ls = t3.letters("ПОГОДА", font, size=1.0, ...)     # список объектов char_00, char_01 … (для анимации в three)

Все объекты: начало координат — центр низа надписи (базовая линия ≈ z=0 после поворота стоя),
текст стоит вертикально лицом к −Y (камера из −Y видит его прямо). Размер size — высота
заглавной буквы ≈ size (Blender: размер кегля; заглавные ≈ 0.7–0.75 кегля, мы компенсируем).

Почему Blender, а не TextGeometry в three: кириллица из любого TTF без конвертации шрифта в
typeface.json, честная фаска, проверка глифов. В three надпись приезжает GLB (s3.export_glb).
"""
import os
import re
import urllib.parse
import urllib.request

import bmesh
import bpy
from mathutils import Vector

import looks

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
FONT_CACHE = os.path.join(ROOT, ".cache", "fonts")
CAP = 0.72   # доля кегля, которую занимает заглавная (типично 0.68–0.75)


def font_file(family, weight=700, italic=False):
    """Путь к TTF семейства Google Fonts (с кириллицей — проверьте `studio fonts`). Скачивается
    один раз в .cache/fonts; дальше работает без сети. Локальный путь к .ttf/.otf — вернётся как есть."""
    if os.path.isfile(family):
        return family
    os.makedirs(FONT_CACHE, exist_ok=True)
    weight = int(weight)
    safe = re.sub(r"[^A-Za-z0-9_-]", "", family)
    if not safe:
        raise ValueError(f"text3d: странное имя шрифта {family!r}")
    tag = f"{safe}-{weight}{'i' if italic else ''}.ttf"
    path = os.path.join(FONT_CACHE, tag)
    if os.path.isfile(path) and os.path.getsize(path) > 1000:
        return path
    fam = urllib.parse.quote(family, safe=" ").replace(" ", "+")
    axis = f"ital,wght@1,{weight}" if italic else f"wght@{weight}"
    url = f"https://fonts.googleapis.com/css2?family={fam}:{axis}"
    css = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Mozilla/4.0"}), timeout=30).read().decode()
    m = re.search(r"url\((https://fonts\.gstatic\.com/[^)]+\.ttf)\)", css)
    if not m:
        raise RuntimeError(f"text3d: нет TTF для {family} {weight} (ответ: {css[:200]})")
    data = urllib.request.urlopen(m.group(1), timeout=60).read()
    with open(path, "wb") as f:
        f.write(data)
    print(f"SX_INFO шрифт {family} {weight} → {path}")
    return path


def _font(font):
    return bpy.data.fonts.load(font, check_existing=True) if isinstance(font, str) else font


def _curve(body, font, size, extrude=0.0, bevel=0.0, bevel_res=3, spacing=1.0, name="Text"):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    cu.font = _font(font)
    cu.size = size / CAP
    cu.extrude = extrude
    cu.bevel_depth = bevel
    cu.bevel_resolution = bevel_res
    cu.space_character = spacing
    cu.align_x = "LEFT"
    cu.align_y = "BOTTOM_BASELINE"
    cu.resolution_u = 6
    o = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(o)
    return o


def _to_mesh(o):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    name = o.name
    bpy.data.objects.remove(o, do_unlink=True)
    m = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(m)
    return m


def check_glyphs(body, font):
    """Каждый видимый символ body должен дать геометрию в этом шрифте. Иначе — исключение со
    списком: замените шрифт (studio fonts) или символ (например «−» → «-»)."""
    missing = []
    for ch in sorted(set(body)):
        if ch.isspace():
            continue
        o = _curve(ch, font, 1.0, name="__glyph")
        m = _to_mesh(o)
        if len(m.data.vertices) == 0:
            missing.append(ch)
        bpy.data.objects.remove(m, do_unlink=True)
    if missing:
        raise RuntimeError(f"text3d: в шрифте нет символов {missing!r} — «квадратики»; другой шрифт или символ")
    return True


def _finish(o, style, color, upright, smooth_bevel=True, **look_kw):
    if upright:
        o.rotation_euler = (1.5708, 0, 0)  # лицом к −Y
        bpy.context.view_layer.update()
    if color:
        looks.apply(o, style, color, smooth=False, **look_kw)
    if smooth_bevel and o.type == "MESH":
        # фаска гладкая, лицо буквы плоское: сглаживание по углу 30°
        for p in o.data.polygons:
            p.use_smooth = True
        try:
            o.data.set_sharp_from_angle(angle=0.52)
        except AttributeError:
            pass
    return o


def _recenter(objs, anchor="bottom"):
    """Сдвинуть объекты так, чтобы центр низа всей надписи стал (0, 0, 0)."""
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    cx = (min(p.x for p in pts) + max(p.x for p in pts)) / 2
    cy = (min(p.y for p in pts) + max(p.y for p in pts)) / 2
    z0 = min(p.z for p in pts) if anchor == "bottom" else (min(p.z for p in pts) + max(p.z for p in pts)) / 2
    for o in objs:
        o.location -= Vector((cx, cy, z0))
    bpy.context.view_layer.update()


def text3d(body, font, size=1.0, extrude=0.15, bevel=0.025, bevel_res=3, spacing=1.0, style="plastic", color="#e63946",
           upright=True, name="title", anchor="bottom", **look_kw):
    """Надпись одним мешем. extrude — полутолщина (глубина = 2·extrude), bevel — фаска.
    Стартовые значения: extrude 0.12–0.2·size, bevel 0.02–0.04·size; больше фаска — «мультяшнее»."""
    check_glyphs(body, font)
    o = _to_mesh(_curve(body, font, size, extrude, bevel, bevel_res, spacing, name))
    _finish(o, style, color, upright, **look_kw)
    _recenter([o], anchor)
    # применить поворот, чтобы в GLB узел был без вращения
    o.data.transform(o.matrix_basis)
    o.matrix_basis.identity()
    o.location = (0, 0, 0)
    _recenter([o], anchor)
    return o


def letters(body, font, size=1.0, extrude=0.15, bevel=0.025, bevel_res=3, spacing=1.0, style="plastic", color="#e63946",
            upright=True, prefix="char", anchor="bottom", **look_kw):
    """Надпись по буквам: объекты char_00, char_01 … (пробелы пропускаются, номер = индекс в body).
    Начало координат каждой буквы — центр её низа: в three буква вращается/растёт «из себя».
    Кернинг сохранён: буквы вырезаются из целой надписи по границам префиксов."""
    check_glyphs(body, font)
    full = _to_mesh(_curve(body, font, size, extrude, bevel, bevel_res, spacing, "__full"))
    # правая граница чернил префикса body[:i+1] — граница между буквами
    edges = []
    for i in range(len(body)):
        pre = body[: i + 1]
        if not pre.strip():
            edges.append(-1e9)
            continue
        m = _to_mesh(_curve(pre, font, size, extrude, bevel, bevel_res, spacing, "__pre"))
        xs = [v.co.x for v in m.data.vertices]
        edges.append(max(xs) if xs else -1e9)
        bpy.data.objects.remove(m, do_unlink=True)
    # связные куски полного меша → буква по центру куска
    bm = bmesh.new()
    bm.from_mesh(full.data)
    bm.verts.ensure_lookup_table()
    seen, parts = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, comp = [v], []
        seen.add(v.index)
        while stack:
            u = stack.pop()
            comp.append(u.index)
            for e in u.link_edges:
                w = e.other_vert(u)
                if w.index not in seen:
                    seen.add(w.index)
                    stack.append(w)
        parts.append(comp)
    bins = {}
    for comp in parts:
        cx = sum(bm.verts[i].co.x for i in comp) / len(comp)
        k = next((i for i, e in enumerate(edges) if cx <= e + 1e-4 and not body[i].isspace()), len(body) - 1)
        bins.setdefault(k, []).extend(comp)
    out = []
    for k in sorted(bins):
        keep = set(bins[k])
        b2 = bm.copy()
        b2.verts.ensure_lookup_table()
        bmesh.ops.delete(b2, geom=[v for v in b2.verts if v.index not in keep], context="VERTS")
        me = bpy.data.meshes.new(f"{prefix}_{k:02d}")
        b2.to_mesh(me)
        b2.free()
        o = bpy.data.objects.new(f"{prefix}_{k:02d}", me)
        bpy.context.scene.collection.objects.link(o)
        out.append(o)
    bm.free()
    bpy.data.objects.remove(full, do_unlink=True)
    for o in out:
        _finish(o, style, color, upright, **look_kw)
        o.data.transform(o.matrix_basis)
        o.matrix_basis.identity()
    _recenter(out, anchor)
    # начало координат каждой буквы — центр её низа (для вращения/роста «из себя»)
    for o in out:
        o.data.transform(o.matrix_basis)
        o.matrix_basis.identity()
        vs = [v.co for v in o.data.vertices]
        c = Vector(((min(v.x for v in vs) + max(v.x for v in vs)) / 2, (min(v.y for v in vs) + max(v.y for v in vs)) / 2, min(v.z for v in vs)))
        o.data.transform(__import__("mathutils").Matrix.Translation(-c))
        o.location = c
    bpy.context.view_layer.update()
    return out

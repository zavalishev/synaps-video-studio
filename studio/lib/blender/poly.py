"""Низкополигональный набор для диорам и объектов (скилл blender-asset-factory).

Всё строится из примитивов bmesh, детерминированно от seed, 1 юнит = 1 м, ось Z вверх
(в GLB станет Y вверх). Каждая функция возвращает объект(ы) с ИМЕНАМИ-ГРУППАМИ — three
находит их по префиксу и перекрашивает/анимирует (снег, ночь, вращение лопастей):

    ground_*  земля/трава       foliage_*  кроны       roof_*  крыши      wall_*  стены
    window_emissive_*  окна     lamp_emissive_*  лампы  water_*  вода     rock_*  камни
    cloud_*  облака             trunk_*  стволы         blades_*  вращающиеся части (ось = локальная X/Y)

    import sx, looks, poly
    isl = poly.island(radius=2.4, seed=3)                 # {"ground", "cliff", "top_z"}
    poly.water_base(radius=5.2)
    for (x, y) in poly.scatter(14, 2.0, seed=4, min_dist=0.45, avoid=[(0, 0, 0.8)]):
        poly.place(poly.pine(1.0, seed=x), (x, y, isl["top_z"]))
    h = poly.house(0.8, 0.7, 0.55, wall="#f4e9d8", roof="#c8553d")
    poly.place(h, (0.3, -0.2, isl["top_z"]), rot_z=20)
    root = poly.group("Diorama")                          # всё под одного родителя (для GLB)

Цвета — '#RRGGBB'; стиль материала — style= (по умолчанию "lowpoly", см. looks.py).
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

import looks

STYLE = "lowpoly"   # общий стиль по умолчанию; poly.STYLE = "clay" — всё в глину


# ---------------------------------------------------------------- база

def _link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def to_object(name, bm, mats=(), smooth=False):
    """bmesh → объект сцены. mats — список материалов по material_index граней."""
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = smooth
    return _link(bpy.data.objects.new(name, me))


def mat(color, style=None, **kw):
    return looks.look(style or STYLE, color, **kw)


def jitter(bm, amount, seed, axes=(1, 1, 1), skip=None):
    r = random.Random(seed)
    for v in bm.verts:
        if skip and skip(v):
            continue
        v.co.x += (r.random() * 2 - 1) * amount * axes[0]
        v.co.y += (r.random() * 2 - 1) * amount * axes[1]
        v.co.z += (r.random() * 2 - 1) * amount * axes[2]


def place(obj_or_list, loc=(0, 0, 0), rot_z=0.0, scale=1.0):
    """Поставить объект (или список/словарь объектов как одно целое) в точку, повернуть по Z (°)."""
    objs = list(obj_or_list.values()) if isinstance(obj_or_list, dict) else (obj_or_list if isinstance(obj_or_list, (list, tuple)) else [obj_or_list])
    objs = [o for o in objs if hasattr(o, "location")]
    bpy.context.view_layer.update()   # иначе matrix_world не знает о только что заданном location
    M = Matrix.Translation(Vector(loc)) @ Matrix.Rotation(math.radians(rot_z), 4, "Z") @ Matrix.Scale(scale, 4)
    for o in objs:
        o.matrix_world = M @ o.matrix_world
    return obj_or_list


def group(name="Diorama", objs=None):
    """Пустышка-родитель для всех (или переданных) объектов без родителя — один узел в GLB."""
    e = _link(bpy.data.objects.new(name, None))
    for o in (objs or list(bpy.context.scene.objects)):
        if o is e or o.parent is not None or o.type not in {"MESH", "EMPTY", "CURVE", "FONT"}:
            continue
        mw = o.matrix_world.copy()
        o.parent = e
        o.matrix_world = mw
    return e


def join(objs, name):
    """Слить объекты в один меш (меньше узлов в GLB, одна группа для three)."""
    objs = [o for o in objs if o.type == "MESH"]
    if not objs:
        return None
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o


# ---------------------------------------------------------------- примитивы

def ring_mesh(name, rings, sides, seed=1, jitter_r=0.06, cap_top=True, cap_bottom=True, mats=(), top_jitter_z=0.0, smooth=False, jitter_a=0.12):
    """Тело из колец: rings = [(радиус, z, material_index), …] сверху вниз. Неровный край —
    радиальный шум jitter_r (доля), одинаковый для всех колец по углу + свой у каждого кольца.
    Это основа острова, скалы, ствола, кроны-конуса."""
    r = random.Random(seed)
    base = [1 + (r.random() * 2 - 1) * jitter_r for _ in range(sides)]
    bm = bmesh.new()
    loops = []
    for k, (rad, z, mi) in enumerate(rings):
        loop = []
        for i in range(sides):
            a = 2 * math.pi * i / sides + (r.random() - 0.5) * jitter_a
            rr = rad * (base[i] + (r.random() * 2 - 1) * jitter_r * 0.4) if rad > 0 else 0
            loop.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z)))
        loops.append((loop, mi))
    for k in range(len(loops) - 1):
        (a, _), (b, mi) = loops[k], loops[k + 1]
        for i in range(sides):
            j = (i + 1) % sides
            f1 = bm.faces.new((a[i], b[i], b[j]))
            f2 = bm.faces.new((a[i], b[j], a[j]))
            f1.material_index = f2.material_index = mi  # полоса между кольцами — материал нижнего
    if cap_top and rings[0][0] > 0:
        top, mi = loops[0]
        c = bm.verts.new((0, 0, rings[0][1] + (r.random() * 2 - 1) * top_jitter_z))
        for i in range(sides):
            f = bm.faces.new((c, top[(i + 1) % sides], top[i]))
            f.material_index = mi
    if cap_bottom and rings[-1][0] > 0:
        bot, mi = loops[-1]
        bm.faces.new(list(reversed(bot))).material_index = mi
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return to_object(name, bm, mats, smooth)


def cone(name, r=0.4, h=1.0, sides=7, color="#3f7d4e", seed=1, z0=0.0, style=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=sides, radius1=r, radius2=0.0, depth=h,
                          matrix=Matrix.Translation((0, 0, z0 + h / 2)))
    jitter(bm, r * 0.06, seed)
    return to_object(name, bm, [mat(color, style)])


def cylinder(name, r=0.1, h=0.4, sides=6, color="#7a5236", z0=0.0, r2=None, style=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=sides, radius1=r, radius2=r if r2 is None else r2, depth=h,
                          matrix=Matrix.Translation((0, 0, z0 + h / 2)))
    return to_object(name, bm, [mat(color, style)])


def blob(name, r=0.5, color="#e0a23a", seed=1, subdiv=1, squash=0.85, z0=0.0, style=None, rough=0.12):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    jitter(bm, r * rough, seed)
    for v in bm.verts:
        v.co.z = v.co.z * squash + z0 + r * squash
    return to_object(name, bm, [mat(color, style)])


def box(name, w=1, d=1, h=1, color="#dddddd", z0=0.0, style=None, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= w
        v.co.y *= d
        v.co.z = v.co.z * h + h / 2 + z0
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect="EDGES", profile=0.5)
    return to_object(name, bm, [mat(color, style)])


# ---------------------------------------------------------------- пропсы

def pine(h=1.0, color="#2f6b4a", trunk="#6b4a33", seed=1, tiers=3, name="foliage_pine"):
    """Ель из 2–3 конусов на стволе. Основание — z=0."""
    r = random.Random(seed)
    parts = [cylinder(f"trunk_{name}", h * 0.06, h * 0.22, 5, trunk)]
    for t in range(tiers):
        k = 1 - t / (tiers + 0.6)
        parts.append(cone(f"{name}_{t}", h * 0.32 * k * (0.92 + r.random() * 0.16), h * 0.5 * k, 7, color, seed + t, z0=h * (0.16 + 0.24 * t)))
    return join(parts, f"{name}")


def blob_tree(h=1.0, color="#e08a2c", trunk="#6b4a33", seed=1, name="foliage_tree"):
    """Лиственное дерево: ствол + «облако»-крона (икосфера с шумом). Осень: #e08a2c #d4552f #f2c14e."""
    t = cylinder(f"trunk_{name}", h * 0.06, h * 0.45, 5, trunk, r2=h * 0.04)
    c = blob(f"{name}_crown", h * 0.32, color, seed, subdiv=1, squash=0.9, z0=h * 0.35)
    return join([t, c], name)


def bush(r=0.25, color="#5f9a4f", seed=1, name="foliage_bush"):
    return blob(name, r, color, seed, subdiv=1, squash=0.7)


def rock(size=0.3, color="#8b8178", seed=1, name="rock"):
    o = blob(name, size, color, seed, subdiv=1, squash=0.6, rough=0.22)
    return o


def house(w=0.8, d=0.65, h=0.5, wall="#f3e6d3", roof="#c8553d", window="#ffd27a", door="#7a4a2e", seed=1, name="house", windows=True):
    """Домик: стены, двускатная крыша со свесом, окна (window_emissive_* — ночью светятся), дверь."""
    walls = box(f"wall_{name}", w, d, h, wall)
    # крыша-призма со свесом
    bm = bmesh.new()
    ow, od, rh = w * 0.58, d * 0.62, h * 0.62
    vs = [bm.verts.new(p) for p in [(-ow, -od, h), (ow, -od, h), (ow, od, h), (-ow, od, h), (-ow, 0, h + rh), (ow, 0, h + rh)]]
    for f in [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5), (0, 3, 2, 1)]:
        bm.faces.new([vs[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    rf = to_object(f"roof_{name}", bm, [mat(roof)])
    parts = [walls, rf]
    if windows:
        wm = looks.look("emissive", window, strength=0.0, name=f"window_{window.lstrip('#')}")
        for sx in (-1, 1):
            win = box(f"window_emissive_{name}_{sx}", w * 0.18, 0.02, h * 0.28, window, z0=h * 0.38)
            win.data.materials[0] = wm
            win.location = (sx * w * 0.24, -d / 2 - 0.005, 0)
            parts.append(win)
        dr = box(f"door_{name}", w * 0.16, 0.02, h * 0.45, door)
        dr.location = (0, -d / 2 - 0.006, 0)
        parts.append(dr)
    return parts


def lighthouse(h=1.6, c1="#f4efe6", c2="#d9483b", lamp="#ffe08a", cap="#2f3e4e", stripes=4, name="lighthouse"):
    """Маяк в полоску: башня-усечённый конус, галерея, фонарь (lamp_emissive_*), купол."""
    parts = []
    r0, r1 = h * 0.16, h * 0.10
    seg = h * 0.72 / stripes
    for i in range(stripes):
        ra = r0 + (r1 - r0) * i / stripes
        rb = r0 + (r1 - r0) * (i + 1) / stripes
        parts.append(cylinder(f"wall_{name}_{i}", ra, seg, 10, c1 if i % 2 == 0 else c2, z0=i * seg, r2=rb))
    top = h * 0.72
    parts.append(cylinder(f"wall_{name}_deck", r1 * 1.45, h * 0.035, 10, cap, z0=top))
    lampo = cylinder(f"lamp_emissive_{name}", r1 * 0.8, h * 0.12, 8, lamp, z0=top + h * 0.035)
    lampo.data.materials[0] = looks.look("emissive", lamp, strength=2.0, name=f"lamp_{lamp.lstrip('#')}")
    parts.append(lampo)
    parts.append(cone(f"roof_{name}", r1 * 1.1, h * 0.12, 10, cap, z0=top + h * 0.155))
    return parts


def windmill(h=1.3, body="#efe2c8", roof="#8a5a3b", blades="#f3e7cf", spar="#6b4a33", name="windmill"):
    """Мельница: башня, крыша-конус и ОТДЕЛЬНЫЙ объект blades_<name> (паруса + тёмные лонжероны —
    читаются на светлом фоне) с началом координат в оси. Ось вращения — локальная Y Blender
    (в three: spinLocal(node, base, "-z", угол))."""
    parts = [cylinder(f"wall_{name}", h * 0.2, h * 0.65, 8, body, r2=h * 0.13),
             cone(f"roof_{name}", h * 0.17, h * 0.25, 8, roof, z0=h * 0.65)]
    bm = bmesh.new()
    for k in range(4):
        a = k * math.pi / 2 + math.radians(20)
        R = Matrix.Rotation(a, 4, "Y")
        sail = R @ Matrix.Translation((h * 0.06, 0, h * 0.3)) @ Matrix.Diagonal((h * 0.12, 0.012, h * 0.4, 1))
        bmesh.ops.create_cube(bm, size=1.0, matrix=sail)
    for f in bm.faces:
        f.material_index = 0
    n0 = len(bm.faces)
    for k in range(4):
        a = k * math.pi / 2 + math.radians(20)
        R = Matrix.Rotation(a, 4, "Y")
        sp = R @ Matrix.Translation((0, -0.012, h * 0.26)) @ Matrix.Diagonal((h * 0.025, 0.03, h * 0.52, 1))
        bmesh.ops.create_cube(bm, size=1.0, matrix=sp)
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=h * 0.05, radius2=h * 0.05, depth=0.08, matrix=Matrix.Rotation(math.pi / 2, 4, "X"))
    for f in list(bm.faces)[n0:]:
        f.material_index = 1
    bl = to_object(f"blades_{name}", bm, [mat(blades), mat(spar)])
    bl.location = (0, -h * 0.2, h * 0.72)
    parts.append(bl)
    return parts


def pier(length=1.4, width=0.35, color="#9b7653", posts="#6b4a33", name="pier", z=0.06):
    parts = []
    n = max(3, int(length / 0.12))
    for i in range(n):
        b = box(f"{name}_board_{i}", width, length / n * 0.85, 0.03, color, z0=z)
        b.location.y = -i * length / n
        parts.append(b)
    for i in range(0, n, 3):
        for sx in (-1, 1):
            p = cylinder(f"{name}_post_{i}_{sx}", 0.025, z + 0.35, 5, posts, z0=-0.3)
            p.location = (sx * width * 0.45, -i * length / n, 0)
            parts.append(p)
    return join(parts, name)


def cloud(size=0.6, color="#ffffff", seed=1, name="cloud"):
    """Облако из 3–5 сплюснутых икосфер (мягкое, без текстуры)."""
    r = random.Random(seed)
    parts = []
    n = 3 + r.randint(0, 2)
    for i in range(n):
        s = size * (0.45 + r.random() * 0.35) * (1.2 if i == n // 2 else 1)
        b = blob(f"{name}_{i}", s, color, seed * 10 + i, subdiv=2, squash=0.72, style="clay", rough=0.03)
        b.location = ((i - (n - 1) / 2) * size * 0.55, (r.random() - 0.5) * size * 0.3, (r.random() - 0.5) * size * 0.1)
        parts.append(b)
    o = join(parts, name)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def island(radius=2.4, height=0.45, sides=18, seed=1, grass="#86b85f", grass_side="#6f9e4c", soil="#a8774f", rock="#7d6a5c", depth=1.6, name="island"):
    """Остров-диорама: фасетная трава сверху, земляной обрыв, каменный низ, сходится к точке
    (если depth > height — «парящий» остров; иначе стоит в воде water_base). Верх — z=top_z."""
    m_g, m_gs, m_s, m_r = mat(grass), mat(grass_side), mat(soil), mat(rock)
    R = radius
    rings = [(R, height, 0), (R * 0.99, height - 0.12, 1), (R * 0.95, height - 0.3, 2), (R * 0.86, height - 0.3 - depth * 0.35, 2),
             (R * 0.62, height - 0.3 - depth * 0.62, 3), (R * 0.28, height - 0.3 - depth * 0.88, 3), (R * 0.05, height - 0.3 - depth, 3)]
    o = ring_mesh(f"ground_{name}", rings, sides, seed, jitter_r=0.07, cap_top=False, mats=(m_g, m_gs, m_s, m_r))
    # верх: два кольца + центр, лёгкий шум по z — фасетная трава
    r = random.Random(seed + 99)
    bm = bmesh.new()
    me = o.data
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    top = sorted([v for v in bm.verts if abs(v.co.z - height) < 1e-4], key=lambda v: math.atan2(v.co.y, v.co.x))
    inner = []
    for i, v in enumerate(top):
        p = v.co * 0.55
        inner.append(bm.verts.new((p.x, p.y, height + (r.random() * 2 - 1) * 0.03)))
    c = bm.verts.new((0, 0, height + 0.02))
    n = len(top)
    for i in range(n):
        j = (i + 1) % n
        for f in ((top[i], top[j], inner[j]), (top[i], inner[j], inner[i]), (inner[i], inner[j], c)):
            bm.faces.new(f).material_index = 0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return {"ground": o, "top_z": height}


def water_base(radius=5.0, thickness=0.5, top="#4fc3c9", side="#2a6f9e", shallow="#8fe0d6", island_r=2.4, sides=48, name="water"):
    """Круглое «блюдо» воды с видимой толщиной (диорама) и светлым мелководьем вокруг острова.
    Верх воды — z=0."""
    w = ring_mesh(f"water_{name}", [(radius, 0.0, 0), (radius, -thickness, 1)], sides, jitter_r=0.0, jitter_a=0.0,
                  mats=(looks.look("plastic", top, roughness=0.25, coat=0.3), mat(side)))
    bm = bmesh.new()
    k = sides
    rr = random.Random(7)
    a = [bm.verts.new((island_r * 0.9 * math.cos(2 * math.pi * i / k), island_r * 0.9 * math.sin(2 * math.pi * i / k), 0.004)) for i in range(k)]
    b = [bm.verts.new((island_r * (1.28 + rr.random() * 0.1) * math.cos(2 * math.pi * i / k), island_r * (1.28 + rr.random() * 0.1) * math.sin(2 * math.pi * i / k), 0.004)) for i in range(k)]
    for i in range(k):
        j = (i + 1) % k
        bm.faces.new((a[i], b[i], b[j], a[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    sh = to_object(f"water_{name}_shallow", bm, [looks.look("plastic", shallow, roughness=0.3, coat=0.3)])
    return {"water": w, "shallow": sh}


def scatter(n, radius, seed=1, min_dist=0.4, avoid=(), inner=0.0, tries=4000):
    """n точек (x, y) в круге radius (и вне inner), не ближе min_dist друг к другу и вне
    кругов avoid=[(x, y, r)]. Детерминированно (seed). Может вернуть меньше n — проверьте len."""
    r = random.Random(seed)
    pts = []
    for _ in range(tries):
        if len(pts) >= n:
            break
        a = r.random() * 2 * math.pi
        d = math.sqrt(r.random() * (radius ** 2 - inner ** 2) + inner ** 2)
        x, y = d * math.cos(a), d * math.sin(a)
        if any((x - px) ** 2 + (y - py) ** 2 < min_dist ** 2 for px, py in pts):
            continue
        if any((x - ax) ** 2 + (y - ay) ** 2 < ar ** 2 for ax, ay, ar in avoid):
            continue
        pts.append((x, y))
    return pts


def stats():
    """Треугольники и объекты сцены (чеклист: ≤ 50 тыс. треугольников)."""
    dg = bpy.context.evaluated_depsgraph_get()
    tris = 0
    n = 0
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            n += 1
            me = o.evaluated_get(dg).to_mesh()
            tris += sum(len(p.vertices) - 2 for p in me.polygons)
            o.evaluated_get(dg).to_mesh_clear()
    print(f"SX_STATS objects={n} tris={tris}")
    return {"objects": n, "tris": tris}


# ---------------------------------------------------------------- предметы (object-scene-3d)

def lathe(name, profile, sides=64, mats=(), smooth=True, cap_top=True, cap_bottom=True):
    """Тело вращения по профилю [(радиус, z, material_index), …] сверху вниз — банка, бутылка,
    стакан, флакон. Без шума (jitter 0), гладкое."""
    return ring_mesh(name, profile, sides, seed=1, jitter_r=0.0, jitter_a=0.0, cap_top=cap_top, cap_bottom=cap_bottom, mats=mats, smooth=smooth)


def label_band(name, radius, z0, z1, image, sides=96, arc=360.0, style="label", **kw):
    """Цилиндрическая этикетка с UV (u — по окружности, v — по высоте) чуть поверх тела предмета:
    картинка image (путь от папки ролика, PNG) оборачивается arc градусов, центр — к −Y (к камере)."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    a0 = -math.pi / 2 - math.radians(arc) / 2
    cols = []
    for i in range(sides + 1):
        a = a0 + math.radians(arc) * i / sides
        cols.append((bm.verts.new((radius * math.cos(a), radius * math.sin(a), z0)), bm.verts.new((radius * math.cos(a), radius * math.sin(a), z1)), i / sides))
    for i in range(sides):
        (b0, t0, u0), (b1, t1, u1) = cols[i], cols[i + 1]
        f = bm.faces.new((b0, b1, t1, t0))
        for loop, (u, v) in zip(f.loops, ((u0, 0), (u1, 0), (u1, 1), (u0, 1))):
            loop[uv].uv = (u, v)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:  # нормали наружу
        c = f.calc_center_median()
        if f.normal.dot(Vector((c.x, c.y, 0))) < 0:
            f.normal_flip()
    return to_object(name, bm, [looks.look(style, "#ffffff", image=image, **kw)], smooth=True)


def jar(h=1.0, r=0.38, glass="#f2a93b", lid="#2f3e4e", label=None, name="jar", body_style="ceramic"):
    """Банка (мёд/варенье/крем): тело с плечом, крышка с рифлением, опционально этикетка-лента.
    Основание z=0. Возвращает список объектов: body_<name>, lid_<name>, label_<name>."""
    prof = [(r * 0.86, h * 0.86, 0), (r * 0.98, h * 0.8, 0), (r, h * 0.72, 0), (r, h * 0.08, 0), (r * 0.94, 0.0, 0)]
    body = lathe(f"body_{name}", prof, 64, mats=(looks.look(body_style, glass),))
    lp = [(r * 0.84, h, 0), (r * 0.9, h * 0.985, 0), (r * 0.9, h * 0.86, 0), (r * 0.86, h * 0.85, 0)]
    lidm = lathe(f"lid_{name}", lp, 64, mats=(looks.look("plastic", lid, roughness=0.4),))
    parts = [body, lidm]
    if label:
        parts.append(label_band(f"label_{name}", r * 1.006, h * 0.2, h * 0.66, label, arc=300))
    return parts

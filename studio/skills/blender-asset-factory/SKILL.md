---
name: blender-asset-factory
description: Процедурные 3D-ассеты в Blender без окна (studio blender + poly/looks/scene3d): низкополигональные диорамы и пропсы (остров, домики, маяк, мельница, деревья, вода, облака), GLB для three, герой-кадры и PNG-секвенции. Брать, когда в ролике нужен 3D-объект или мир, которого нет готовым, и бесплатно.
---

# blender-asset-factory — 3D-ассеты из кода

## Карточка

**Зачем**: процедурные 3D-ассеты в Blender без окна (бесплатно, секунды): диорамы и пропсы из
примитивов → GLB для three, PNG-кадр, PNG-секвенция.

**Запуск**: `studio blender assets/x.py --out public/3d/x.png -- --width 1080 --height 1920 [--transparent] [--frames 1-120]`.
Модули в скрипте: `sx` (основа, камера, свет, рендер), `poly` (island, house, lighthouse,
windmill, pine, blob_tree, rock, cloud, jar, lathe, label_band, scatter, place…), `looks`
(материалы-виды), `scene3d as s3` (sky_gradient, studio_lights, cyclorama, shadow_catcher,
frame_objects/frame_check, render_sequence, turntable, export_glb), `text3d`.

**Правила**:
- Имена материалов — группы (`ground_*`, `foliage_*`, `roof_*`, `window_emissive_*`, `water_*`…):
  их перекрашивают scene-state и three.
- Ступень — самая дешёвая, что держит замысел: 3D в three → кадры Blender + параллакс → 2.5D → 2D.
- Богатство видно с телефона: крупные силуэты, контраст масс, свет; мелкая деталь — шум.
- Читай `SX_WARN` (вылезло из кадра, быстрый поворот) и `SX_STATS`.

**Ловушки**: Cycles 11–16 с/кадр (+85 с первая компиляция) — секвенции на EEVEE; персонаж с
лицом из примитивов не выразителен — generated-imagery.

## Подробности (читать по нужде: `studio skill blender-asset-factory --section <раздел>`)

Blender здесь — фабрика ассетов и офлайн-рендер: скрипт bpy собирает модель из примитивов,
назначает материалы-«виды» и отдаёт **GLB** (для `@remotion/three`), **PNG** (герой-кадр, фон) или
**PNG-секвенцию** (поворот, проезд). Бесплатно, детерминированно, секунды на кадр.

Это знание и стартовые точки, не рецепт. Что строить, в каком стиле, как снимать — решаешь ты по
концепту и theme.json. Ступень выбирай самую дешёвую, что держит замысел: 3D в three → кадры
Blender + параллакс → 2.5D → 2D (лестница отказа в CLAUDE.md).

## Когда брать

- Мир-диорама «как POLY WEATHER»: остров/городок/комната, по которому ездит камера.
- Предмет, которого нет фото: лампа, маяк, коробка, банка (для реального товара клиента — сначала
  `object-scene-3d`, ступень 2.5D с его фото).
- Нужна одна и та же модель в нескольких сценах с разной камерой/светом/сезоном — GLB один раз.

Не брать: плоский объяснительный ролик без пространства; персонаж с лицом (примитивы не дают
выразительного лица — это `generated-imagery`); когда 3D не добавляет смысла кадру.

## Что получаешь

| Выход | Как | Где дальше |
|---|---|---|
| `public/3d/x.glb` + `x.json` (паспорт: бокс в координатах three, центр, радиус, имена узлов) | `s3.export_glb(path)` | `<AnimatedGltf>` / `<Gltf>` в `@studio/three-d` |
| `public/3d/x.png` (кадр, можно `--transparent`) | `sx.render_still(a.out)` | `<Img>` / фон / слой |
| `public/3d/seq/f_0001.png …` | `s3.render_sequence` / `s3.turntable` | `<BlenderSeq>` |

## Инструменты (studio/lib/blender — `import` прямо в скрипте)

- `sx` (основа): `args`, `reset`, `camera`, `sun`, `area`, `setup_render`, `render_still`, `frames_range`.
- `poly` — низкополигональный набор (всё детерминированно от `seed`, 1 юнит = 1 м, Z вверх):
  `island`, `water_base`, `pine`, `blob_tree`, `bush`, `rock`, `cloud`, `house`, `lighthouse`,
  `windmill`, `pier`, `jar`, `lathe` (тело вращения по профилю), `label_band` (этикетка с UV),
  `cone`/`cylinder`/`blob`/`box`/`ring_mesh` (свои формы), `scatter` (точки без пересечений),
  `place` (поставить/повернуть группу), `join`, `group`, `stats` (треугольники).
- `looks` — материалы-виды, те же токены, что в three: `looks.apply(obj, "clay", "#e07a5f")` — см. скилл `materials`.
- `scene3d as s3` — `sky_gradient(top, horizon, screen=True)`, `studio_lights(target, preset)`,
  `cyclorama`, `shadow_catcher` (Cycles), `tone("neutral")`, `eevee_quality()`,
  `frame_objects` / `frame_check` (всё в безопасной зоне), `render_sequence`, `turntable`, `export_glb`.

Запуск (из папки ролика): `studio blender assets/x.py --out public/3d/x.png -- --width 1080 --height 1920 [--transparent] [свои флаги]`.
Строки `SX_WARN …` (вылезло из кадра, слишком быстрый поворот) и `SX_STATS` печатаются — читай их.

### Имена-группы (контракт с three и scene-state)

`ground_*` земля/трава, `foliage_*` кроны, `roof_*` крыши, `wall_*` стены, `window_emissive_*` окна,
`lamp_emissive_*` лампы, `water_*` вода, `rock_*`, `cloud*`, `trunk_*`, `blades_*` вращающиеся части.
В three: `recolor(scene, /^ground|^roof/, "#f2f4f7", 0.8)` — снег; `glow(scene, /emissive/, "#ffd27a", 3)` — ночь;
`spinLocal(node, base, "-z", угол)` — лопасти. Новые пропсы называй по тем же префиксам.

## Как (минимальный скрипт)

```python
import math, sx, poly, scene3d as s3
a = sx.args(lambda p: p.add_argument("--glb", default=None))
sx.reset()
R = 2.3
top = poly.island(radius=R, height=0.42, seed=a.seed, depth=0.9)["top_z"]
poly.water_base(radius=3.6, island_r=R)
poly.place(poly.lighthouse(1.7), (R * .62, R * .38, top))
for i, (x, y) in enumerate(poly.scatter(20, R * .86, seed=11, min_dist=.32, avoid=[(R*.62, R*.38, .4)])):
    poly.place(poly.pine(.6, seed=i) if math.hypot(x, y) > R * .6 else poly.blob_tree(.65, "#e08a2c", seed=i), (x, y, top), rot_z=i * 37)
poly.stats()
if a.glb:
    poly.group("Diorama"); s3.export_glb(a.glb)             # GLB + паспорт .json
s3.sky_gradient("#9fd3ee", "#f7e9d6", strength=1.0, light_strength=0.45, screen=True)
sx.sun(rotation=(50, 0, 35), energy=4.5, color=(1, .93, .82), angle_deg=4)
cam = sx.camera(location=(6, -7.5, 7.2), target=(0, 0, .35), lens=55)
sx.setup_render(a)                 # СНАЧАЛА размер кадра — от него зависит кадрирование
s3.tone("neutral")                 # цвета ≈ hex палитры (AgX делает диораму серой)
s3.eevee_quality()
meshes = [o for o in __import__("bpy").context.scene.objects if o.type == "MESH"]
s3.frame_objects(cam, meshes, target=(0, 0, .3), margin=.02); s3.frame_check(cam, meshes)
sx.render_still(a.out)
```

Готовые проверенные стартовые точки (необязательны, копируй и меняй):
- `examples/island.py` — остров-диорама (маяк, мельница, деревня, осенние деревья, вода, облака), GLB + кадр.
- `examples/IslandOrbit.tsx` — этот GLB в three: орбита 30° + наезд за 5 с, лопасти, дрейф облаков, `InFrame`.
- `examples/props_sheet.py` — лист пропсов: посмотреть формы глазами до сборки мира.

### Стартовые пресеты (по выбору)

- Камера диорамы: высота 30–40°, `lens` 50–60 (миниатюра), один непрерывный дубль: орбита ≤ 30° за 5 с + наезд 10 %.
- Свет: `sun` energy 4–5, angle 4–6° (мягкая тень), мир `light_strength` 0.4–0.6. Ночь — `studio_lights(preset="night")`, окна через `glow`.
- Палитра осени: `#e08a2c #d4552f #f2c14e #e9a03b`, хвоя `#2f6b4a`, трава `#86b85f`, вода `#4fc3c9/#8fe0d6/#2a6f9e`.

## Подводные камни (проверено)

- `setup_render` ставит размер кадра; `frame_objects` до него кадрирует под 1920×1080 → в вертикали вылезает.
- Тон-маппинг: `sx.setup_render` ставит AgX — плоские цвета серые и блёклые. Для стилизации — `s3.tone("neutral")`
  (Khronos PBR Neutral; в three тот же — `<Tone mode="neutral" />`).
- Небо-градиент по направлению взгляда при камере сверху видно только «низом» — `screen=True`.
  Нужен точный цвет фона как у 2D — рендерь `--transparent`, фон рисуй в Remotion.
- Секвенции — через `render_sequence(update)` / `turntable`, без ключей Blender (API анимации в 5.x менялся).
- Cycles: первый запуск компилирует Metal-ядра ~85 с, дальше 1080×1920 64 сэмпла ≈ 11–16 с. EEVEE-кадр ≈ 0.2–1 с.
- `Matrix.Diagonal`, не `Matrix.Diag`. Тело вращения — `lathe` (без углового шума, иначе шов).
- Лопасти/колёса вращаются вокруг своей оси только если это отдельный объект с началом в оси (`windmill` так и сделан).

## Диорама: богатство, которое видно с телефона

- Главная достопримечательность — самый крупный силуэт; масштаб зданий подчинён ей
  (типовые коробки не выше башни).
- Земля с рельефом (холм, берег, перепад), а не плоская плита; края с фаской.
- AO / контактные тени включены — без них форма «плавает» даже в пасмурном свете.
- Хотя бы одна деталь героя читается на плитке 360 px (флаг, часы, огни окон, лодка).
- Сравнение с референсом брифа (если назван) — 2–3 черты, оценка своего кадра по каждой в notes.md.

## Чеклист качества (самопроверка)

- [ ] Превью/лист пропсов посмотрен глазами до сборки сцены: форма читается, нет «дыр», нет z-fighting.
- [ ] Диорама: иерархия масштаба, рельеф, AO; деталь героя читается на плитке телефона.
- [ ] `SX_STATS`: ≤ 50 тыс. треугольников на сцену (диорама из примера — 3.4 тыс.).
- [ ] `frame_check` без `SX_WARN`; в three — `<InFrame>` без `outside-safe-3d` в guard.json.
- [ ] Цвета — из theme.json, тон `neutral`; 3D и 2D рядом выглядят одним миром (сравни кадр с 2D-сценой).
- [ ] Детерминизм: всё от `seed`; повторный запуск даёт тот же PNG.
- [ ] Имена узлов по префиксам-группам, если сцене нужны снег/ночь/вращение.
- [ ] Движение камеры: орбита ≤ 12°/с на пике (у плавной пик ≈ 1.9× средней), наезд плавный; `studio probe` PASS.

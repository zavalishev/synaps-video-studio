---
name: materials
description: Материалы-«виды» с одинаковым видом в Blender (looks.py) и three (look() из @studio/three-d): clay, lowpoly, felt, paper, toon, plastic, ceramic, metal, glass, emissive, label; перекраска групп (снег, сезон), свечение окон, тон-маппинг. Брать вместе с любым 3D-скиллом.
---

# materials — один токен стиля для Blender и three

## Карточка

**Зачем**: материал-«вид» с одинаковым видом в Blender (`looks.py`) и three (`look()` из
`@studio/three-d`): clay, lowpoly, felt, paper, toon, plastic, ceramic, metal, glass, emissive, label.

**API**: Blender — `looks.apply(obj, "felt", "#7aa874")`, `looks.look("emissive", color, strength=2)`;
three — `look("clay", color)`, `applyLook(scene, /^foliage/, "felt", color)`, `recolor` (снег,
сезон), `glow` (окна ночью), `enableShadows`, `<Tone mode="neutral"/>`, `StudioEnv`.

**Правила**: токен материала — в theme.json (`material`) и в `imagePromptSuffix`: 2D, 3D и
картинки — один мир; тон-маппинг одинаковый с обеих сторон; свет — половина материала.

**Ловушки**: metal без окружения — чёрный; glass дорогой; flatShading у lowpoly обязателен;
перекраска идёт по префиксам имён материалов (см. blender-asset-factory).

## Подробности (читать по нужде: `studio skill materials --section <раздел>`)

Стиль материала — часть стиль-библии (theme.json, например `"material": "clay"`). Один и тот же
токен даёт **одинаковый вид** в Blender-ассетах и в `@remotion/three`, а 2D-сцены и промпты картинок
берут тот же стиль — так 2D и 3D становятся одним миром. Проверено: `examples/` рендерит 10 видов на
шарах в обоих движках, вид совпадает (кадр сравнения — в отчёте теста).

Пресеты ниже — стартовые значения, а не правило. Меняй параметры под концепт.

## Виды

| Токен | Blender (`looks.look`) | three (`look`) | Где хорош |
|---|---|---|---|
| `clay` | Principled, rough 0.85, SSS 0.05 | Physical, rough 0.85, sheen 0.3 | мягкий «пластилин», герои, предметы |
| `lowpoly` | rough 0.8, плоские грани | Standard, `flatShading` | диорамы, POLY WEATHER |
| `felt` | rough 1, sheen, шумовой бамп | Physical, sheen 1, normalMap из сида | детское, сказка, «войлок» |
| `paper` | rough 1, тонкий бамп | Standard, слабая normalMap | бумага/картон в 3D |
| `toon` | ступени по N·L к ключу (как MeshToon) | MeshToon + gradientMap | мультяшно, плоско, 2–4 ступени |
| `plastic` | rough 0.32, лак 0.6 | Physical clearcoat | упаковка, игрушки, 3D-надписи |
| `ceramic` | rough 0.18, лак 0.4 | Physical | посуда, банки, глазурь |
| `metal` | metallic 1, rough 0.3 | Standard metalness 1 | крышки, детали (нужно окружение) |
| `glass` | transmission 1, ior 1.45 | Physical transmission | стекло; дорого — крупно и коротко |
| `emissive` | Emission strength 1.5 | emissive ×2 | окна, лампы, неон |
| `label` | матовый с картинкой `image=` | Standard с `map` | этикетки, вывески |

```python
import looks
looks.apply(obj, "felt", "#7aa874")                  # материал + плоское/гладкое затенение по виду
m = looks.look("emissive", "#ffd27a", strength=2)
m = looks.look("label", "#ffffff", image="public/img/label.png")
looks.look("toon", "#3d85c6", steps=3, light_dir=(-0.45, -0.54, 0.71))
```

```tsx
import { look, applyLook, recolor, glow, enableShadows, StudioEnv, Tone } from "@studio/three-d";
<mesh material={look("clay", theme.palette.accent)}><sphereGeometry args={[0.5, 64, 32]} /></mesh>
// внутри <AnimatedGltf setup={(s) => { enableShadows(s); applyLook(s, /^foliage/, "felt", "#7aa874"); }}
//   animate={(n, f) => { if (n === f.root) { recolor(n, /^ground|^roof/, "#f2f4f7", snow(f.frame)); glow(n, /emissive/, "#ffd27a", night(f.frame) * 3); } }} />
```

## Свет и тон — половина материала

- **Тон-маппинг одинаковый с обеих сторон**: Blender `s3.tone("neutral")`, three `<Tone mode="neutral" />`
  (Khronos PBR Neutral: цвет материала ≈ hex палитры). `flat` — точный hex, жёсткий пересвет;
  `film` — AgX, реалистично, но гасит насыщенность (диорама становится серой — проверено).
- Свет — `studio_lights` / `<StudioLights>` с одинаковыми пресетами `soft | product | golden | night`.
- `metal`, `plastic`, `ceramic`, `glass` без окружения в three выглядят чёрно-плоско → `<StudioEnv intensity={0.4–0.7} />`.
- Emission сильнее ~2 уходит в белый (тон-маппинг). Ореол — не силой, а bloom или размытой
  копией слоя в Remotion (`filter: blur`).

## Перекраска и состояние сцены

`recolor(root, шаблон, цвет, доля)` смешивает цвет материалов узлов к цвету (снег, сезон, ночь) —
материал клонируется один раз, вызывать можно на каждом кадре; `glow(root, шаблон, цвет, сила)` —
окна и лампы. Шаблоны — префиксы имён из `blender-asset-factory`. Плавность смены состояния
(24–36 кадров) и пресеты дня/ночи — скилл `scene-state`.

## Подводные камни (проверено)

- Тон в Blender ставь ПОСЛЕ `sx.setup_render` (он перезаписывает на AgX).
- Бамп войлока в Blender тоньше, чем normalMap в three: при крупном плане three-войлок с `bump` 0.3 выглядит
  «штукатуркой» — держи 0.2–0.35; бумага 0.06–0.12.
- Toon по яркости ламп (Shader to RGB) «плывёт» от мощности света — поэтому toon сделан по N·L.
  Свет не с той стороны — передай `light_dir` (направление НА свет, Z вверх).
- `glass` в three светлее и мутнее, чем в Blender (нет преломления сцены за ним) — для героя-стекла бери кадр Blender.
- Плоское/гладкое затенение — часть вида: `lowpoly` плоское, остальные гладкие (`looks.apply` ставит сам).
- Шум текстур — из сида (`noiseNormalMap(seed)`), никакого `Math.random`: от кадра к кадру не «кипит».

## Чеклист качества

- [ ] Вид из theme.json; одинаковый токен у всех 3D-объектов сцены (не смешивать clay и glossy без замысла).
- [ ] Нет пересвета: белое пятно на ≥ 20 % объекта = брак → `intensity` света 0.7–0.9 или меньше лака.
- [ ] Тёмные материалы читаются на фоне (силуэт виден), светлые не сливаются с фоном.
- [ ] Металл/лак/стекло — с `StudioEnv`; без него проверь, что не чёрные.
- [ ] Текстура/этикетка не зеркальная, не растянута (смотри кадр Read-ом).
- [ ] 3D рядом с 2D той же сцены: цвета совпадают по палитре (сравни один кадр).

Примеры: `examples/swatches.py` (Blender, 10 видов) и `examples/Swatches.tsx` (те же в three).

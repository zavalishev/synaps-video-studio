---
name: object-scene-3d
description: Товар или предмет героем кадра — студийный свет, тень, фон-циклорама, поворотный стол, наезд. Три ступени — 2.5D из фото клиента, прокси-3D (банка/коробка/бутылка с этикеткой) в @remotion/three, офлайн-кадр Blender (Cycles, тень без фона). Брать для продуктовых роликов малого бизнеса и герой-кадров.
---

# object-scene-3d — предмет как герой кадра

## Карточка

**Зачем**: товар или предмет героем кадра — студийный свет, тень, циклорама, поворотный стол, наезд.
Верность важнее эффектности.

**Ступени** (бери самую дешёвую): **2.5D** из фото клиента (вырезка + фон + тень + параллакс:
`PhotoLayers`/`Cutout`) → **прокси-3D** в three (`poly.jar`/`lathe`/`box` + `label_band` → GLB →
`<Turntable>`) → **кадр Blender** (Cycles + `shadow_catcher`, `--transparent`).

**API** (`@studio/three-d`): `Tone`, `StudioEnv`, `StudioLights preset="product"`, `Turntable`,
`ShadowFloor`, `ContactShadow`, `InFrame` (страховка кадра для 3D), `fitBox(meta.bbox, fov, W, H, fill)`,
`AnimatedGltf`, `BlenderSeq`.

**Правила**: этикетка читается; предмет стоит (тень касается пола); движение медленное, без
перелёта; наезд — `frameSubject3D` (camera-choreography) к нужной части.
**Герой виден проверке**: 3D-героя помечай пустой обёрткой `<div data-hero>` с коробкой,
спроецированной из холста, на каждом плане, где он движется — review меряет его размер,
поздний вход, срез краем и текст на нём (`text-on-hero`; надпись на предмете нарочно —
`data-over-hero`). **Лицо на корпусе** (экран, этикетка, вывеска) — `roundedFace(w, h, r)`: та
же форма, что корпус, утоплена на 2–3 %; прямоугольник поверх скруглённых углов торчит
«наклейкой». **Экран-развязка** — правдоподобное включённое состояние (экран блокировки,
интерфейс текстурой из canvas), не заливка одним цветом. Финальный кадр героя — один
`studio still` в полном размере: углы и швы на листе не видны.

**Ловушки**: генерация 3D по фото (Tripo, Meshy) — только с «да» владельца; стекло дорого —
крупно и коротко; один `ThreeCanvas` на сцену, рендер `--concurrency 3`.

## Подробности (читать по нужде: `studio skill object-scene-3d --section <раздел>`)

Цель кадра — показать предмет **верно и красиво**: этикетка читается, предмет стоит (тень касается
пола), свет мягкий, движение медленное. Эффектность вторична: у реального товара клиента верность
важнее 3D.

## Выбор ступени (решаешь ты; бери самую дешёвую, что держит замысел)

| Ступень | Когда | Как | Цена |
|---|---|---|---|
| **2.5D** (по умолчанию для товара клиента) | есть фото товара | вырезка (studio image / фото без фона) + фон + мягкая тень + параллакс 2–4 слоёв (`Guarded`, `CoverImage`) | секунды |
| **Прокси-3D в three** | нужен поворот/наезд, форма простая (банка, коробка, бутылка, кружка) | `poly.jar`/`lathe`/`box` + `label_band` с картинкой этикетки → GLB → `<Turntable>` | ~0.5 с на секунду ролика |
| **Кадр/секвенция Blender** | обложка, финальный кадр, стекло, «дорогой» свет | Cycles + `shadow_catcher` (`--transparent`) или EEVEE-секвенция `s3.turntable` → `<BlenderSeq>` | Cycles 11–16 с/кадр (1080×1920); EEVEE ~0.2 с/кадр |

Генерация 3D-модели по фото (Tripo, Meshy) — только с явного «да» владельца.

## Что получаешь

- GLB предмета + паспорт `.json` (бокс в координатах three) → кадрирование `fitBox(meta.bbox, fov, W, H, fill)`.
- Сцена three: `<Tone>`, `<StudioEnv>`, `<StudioLights preset="product">`, `<Turntable>`, `<ShadowFloor>` +
  `<ContactShadow>` (падающая + контактная тень на 2D-фоне), `<InFrame>` (страховка кадра для 3D).
- PNG без фона с тенью (Cycles) — для обложки/финала поверх 2D-фона того же цвета.

## Как — прокси-3D (проверено, examples/)

Blender (`examples/jar.py`): тело вращения по профилю + крышка + этикетка-лента с UV.

```python
import sx, poly, scene3d as s3
a = sx.args(lambda p: p.add_argument("--glb"))
sx.reset()
parts = poly.jar(h=1.0, r=0.38, glass="#e8a33a", lid="#3b2a1e", label="public/img/label.png")
s3.export_glb(a.glb, parts)
# свои формы: poly.lathe("body_bottle", [(0.12, 1.6, 0), (0.12, 1.2, 0), (0.33, 0.95, 0), (0.35, 0.05, 0), (0.32, 0, 0)])
#             poly.label_band("label_bottle", 0.352, 0.25, 0.8, "public/img/label.png", arc=300)
```

Remotion (`examples/ProductTurntable.tsx`, суть):

```tsx
const R = fitBox(meta.bbox, fov, W, H, 0.62);              // предмет ≈ 35–60 % высоты кадра
const cam = orbit(frame, { start: 0, end: D - 1, azimuth0: 0, dAzimuth: 0, elevation: 14, target: [0, .5, 0],
                           radius: tween(frame, [[0, R * 1.08], [D - 1, R]]) });   // медленный наезд 8 %
<AbsoluteFill style={{ background: BG }}>                   {/* фон — 2D, тот же, что у других сцен */}
  <ThreeCanvas width={W} height={H} camera={{ fov }} shadows>
    <Tone mode="neutral" /><StudioEnv intensity={0.5} />
    <StudioLights preset="product" target={[0, .5, 0]} scale={0.8} intensity={0.9} />
    <CameraRig position={cam.position} target={cam.target} fov={fov} />
    <InFrame id="jar">
      <Turntable start={0} end={D - 1} degrees={30} from={-15}>
        <AnimatedGltf src={staticFile("3d/jar.glb")} setup={(s) => enableShadows(s, true, false)} />
      </Turntable>
    </InFrame>
    <ShadowFloor opacity={0.22} color="#5a3a14" />
    <ContactShadow radius={0.6} inner={0.6} opacity={0.6} color="#3b2412" />
  </ThreeCanvas>
  <Caption />                                                {/* текст — 2D, через Guarded + useTextCheck */}
</AbsoluteFill>
```

Офлайн-кадр Blender без фона, только тень (Cycles):
`studio blender assets/jar.py --out public/3d/jar_hero.png -- --engine cycles --samples 64 --transparent --hero`
(в скрипте `s3.shadow_catcher(8)` + `s3.frame_objects(cam, parts, margin=0.12)`).

Секвенция поворота (EEVEE, без фона): `s3.turntable(obj, "public/3d/turn/f_", frames=150, degrees=30, eased=True, start_deg=-15, check=(cam, parts))`
→ `<BlenderSeq prefix="3d/turn/f_" count={150} mode="clamp" />` + тень CSS-эллипсом (`filter: blur(24px)`, opacity 0.35) под дном.

Этикетка для теста — `examples/label.mjs` (SVG → PNG через sharp, кириллица). В ролике клиента —
его фото этикетки (выпрямленное) или `studio image`; пропорция картинки ≈ длина дуги / высота ленты
(для банки r 0.38, дуга 300°, высота 0.46 → ≈ 4.3:1).

### Стартовые пресеты (по выбору)

- Камера: fov 24–30, высота 10–18°, наезд 5–10 % за сцену, поворот предмета 20–40° за 5 с (пик ≤ 12°/с).
- Свет `product`: ключ слева сверху, контровой сзади (блик по краю), заполняющий справа. Тёплый вариант — `golden`.
- Фон: радиальный градиент из палитры (светлее за предметом), тень того же оттенка, что фон, но темнее (не чистый чёрный).

## Подводные камни (проверено)

- Этикетка-лента зеркалилась при u = 1 − t — исправлено в `label_band`; всё равно смотри кадр.
- `lathe` без углового шума; `ring_mesh` с шумом даёт шов на гладком теле.
- `ContactShadow` без `inner` почти не виден (спад начинается от центра) — `inner` ≈ радиус дна / radius.
- Поворот с плавностью: пик скорости ≈ 1.9× средней; `s3.turntable` и `<Turntable>` предупреждают о > 12°/с.
- Cycles: первый запуск компилирует Metal-ядра ~85 с — не принимай за зависание (сторож `--timeout 600`).
- Прозрачный PNG с `shadow_catcher` работает только в Cycles; в EEVEE тень рисуй сам (CSS/ContactShadow).
- `fitDistance` по радиусу шара даёт мелкий предмет у вытянутых форм — бери `fitBox` по паспорту.

## Чеклист качества

- [ ] Предмет 35–60 % высоты кадра; в `<InFrame>` нет `outside-safe-3d` ни на одном кадре.
- [ ] Этикетка читается хотя бы в одном кадре (не зеркальна, не в блике, не на ребре поворота).
- [ ] Тень касается пола без зазора; предмет не «парит».
- [ ] Нет мерцания теней (shadow-bias −0.0005, normalBias 0.02 — уже в StudioLights) — смотри ленту движения.
- [ ] Нет пересвета на крышке/лаке (белое пятно ≤ 20 % объекта) — `intensity` 0.8–0.9, `StudioEnv` ≤ 0.6.
- [ ] Цвет фона под 3D совпадает с 2D-сценами; текст — 2D поверх, `useTextCheck` без замечаний.
- [ ] `studio probe` PASS; поворот и наезд — одно движение, без смены направления.

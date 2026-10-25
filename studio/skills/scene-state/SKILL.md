---
name: scene-state
description: Слой «Wetter» — время суток, погода, сезон как параметры сцены (SceneState → Look) с плавной сменой по ключам; одинаково для 2D-картинок (цветокор, огни, небо), three (свет, небо, дымка, перекраска модели по группам) и Blender; реальная погода из Open-Meteo. Брать, когда у сцены есть настроение или его смена («свет погас», «сделай ночь», «пошёл снег»).
---

# scene-state — настроение сцены как данные

## Карточка

**Зачем**: время суток, погода, сезон как параметры сцены (`SceneState → Look`) с плавной
сменой по ключам; одинаково для 2D, three и Blender; реальная погода из Open-Meteo.

**API** (`@studio/scene-state`): `resolveLook({time, weather, season, overrides, mute})`,
`lookAt(frame, [{f, state, dur}])`, `mixLook`, `mixColor`, `flicker`, `sunDirection`,
`wmoToWeather`, `timeOfDayAt`; 2D — `Sky`, `Graded`, `GlowSpots`, `WeatherFx`;
`@studio/scene-state/three` — `StateLights`, `SkyDome`, `StateModel`, `useLookOnModel`;
`fetch-weather.ts` (реальные данные), `scene_state.py` (Blender).

**Правила**:
- Состояние видно на предмете, а не только в воздухе: мокрые крыши, свет в окнах, снег на земле.
- Погода гасит краски времени суток: «пасмурно» не бывает розовым рассветом (`mute` 1 по
  умолчанию; 0 — нарочная стилизация, почему — в notes.md).
- Небо — градиент/купол, а не плоская заливка; смена света на весь кадр — не «вылет» (3D-холст
  с `data-world`, probe понимает общую смену света).

**Ловушки**: оверлей, который делает тёплый момент серым; данные и картинка противоречат
(карточка «сухо» под тучей) — сверяй каждую смену.

## Подробности (читать по нужде: `studio skill scene-state --section <раздел>`)

«Blender + three.js + Wetter»: Wetter — это погода. Модель (или картинка) одна, а «ночь»,
«дождь», «зима» — правка параметров, а не новая сцена и не новая генерация. Смена
состояния — тоже данные: ключи по кадрам, плавное смешивание.

Брать, когда: свет — часть сюжета (погас → свечи → снова светло); один и тот же мир в разное
время; пользователь просит «сделай ночь/дождь/зиму»; ролик про погоду или место (реальные
данные). Не брать ради «красивости» — если настроение не меняется и не важно, хватит
art-direction.

## Что есть (`studio/lib/scene-state/`)

- `presets.json` — **стартовые** значения: время (`dawn day golden evening night`), погода
  (`clear cloudy fog rain storm snow` — поправки), сезон (`spring summer autumn winter` —
  цвета групп). Любое поле переопределяется `overrides`.
- `@studio/scene-state` (чистые функции + 2D):
  - `resolveLook({time, weather, season, overrides}) → Look` — все цвета и числа света;
  - `lookAt(frame, [{f, state, dur}])` — к кадру `f` сцена приходит в `state`, смена
    начинается в `f − dur` (по умолчанию 30 кадров; 24–40 — естественно);
  - `mixLook`, `mixColor` (смесь в линейном свете), `flicker` («свет гаснет»), `sunDirection`;
  - `wmoToWeather(code)`, `timeOfDayAt(hour, sunrise, sunset)` — из реальной погоды;
  - 2D: `<Sky look>` (градиент, солнце/луна, звёзды, облака), `<Graded look>` (цветокор
    любой картинки/сцены под состояние), `<GlowSpots spots amount>` (тёплые окна/лампы),
    `<WeatherFx look area clipPath>` (дождь/снег/туман из `@studio/fx`).
- `@studio/scene-state/three`: `<StateLights look scale skyRange>` (небо-купол, дымка,
  полусферный свет, солнце/луна с тенью, экспозиция), `<SkyDome>`, `<StateModel src look>`,
  `useLookOnModel(root, look)`.
- `look.ts` — Look в JSON (для Blender или посмотреть числа).
- `scene_state.py` — то же для Blender: `apply(look)` = небо, солнце, перекраска групп, дымка.
- `.claude/skills/scene-state/fetch-weather.ts` — реальная погода (Open-Meteo, без ключа).
- `.claude/skills/scene-state/examples/island.py` — пример модели с группами материалов.

### Группы материалов (договорённость с blender-asset-factory)

Перекраска идёт по **имени материала** (префикс): `ground*` — земля (сезон + снег),
`foliage*` — листва (сезон + снег), `roof*` — крыши (снег), `water*` — вода,
`window*` / `glow*` / `lamp*` — свечение (`look.windowGlow`), `snow*` — видно только при
снеге. Остальные материалы не трогаются. Назовите материалы так при сборке модели — и одна
модель отыграет любое состояние в three и в Blender.

## Как

### 3D (three внутри Remotion)

```tsx
import { lookAt, type LookKey } from "@studio/scene-state";
import { StateLights, StateModel } from "@studio/scene-state/three";
import { Rain3D, Snow3D, Stars3D, Clouds3D } from "@studio/fx/three";

const KEYS: LookKey[] = [
  { f: 0, state: { time: "day", season: "summer" } },
  { f: 100, state: { time: "evening", season: "autumn" }, dur: 40 },
  { f: 190, state: { time: "night", weather: "rain", season: "autumn" }, dur: 40 },
];
const look = lookAt(frame, KEYS);
<ThreeCanvas width={W} height={H} shadows camera={{ fov: 30 }}>
  <CameraRig {...cam} />
  <StateLights look={look} scale={8} skyRange={[-0.26, 0.02]} />  {/* камера сверху → небо у горизонта */}
  <StateModel src={staticFile("3d/island.glb")} look={look} />
  <pointLight position={[1.7, 2.8, -0.9]} color="#ffcc66" intensity={look.windowGlow * 18} distance={6} />
  <Stars3D opacity={look.stars} />
  <Clouds3D center={[0, 6.2, -10]} span={36} color={look.cloudTint} opacity={0.25 + look.clouds} />  {/* за героем */}
  <Rain3D opacity={0.5 * look.rain} /> <Snow3D opacity={look.snow} />
</ThreeCanvas>
```

Частицы и облака всегда в дереве, их видимость — от `look` (плавно появляются в переходе).

### 2D / 2.5D (картинка, сгенерированный фон, бумага)

```tsx
const look = lookAt(frame, [{ f: 0, state: { time: "day" } }, { f: 120, state: { time: "night", weather: "rain" }, dur: 36 }]);
<Graded look={look}><CoverImage src={staticFile("img/street.png")} /></Graded>
<GlowSpots amount={look.windowGlow * flicker(frame, { start: 200, dur: 30 })} spots={[{ x: 320, y: 610, r: 140 }]} />
<WeatherFx look={look} />            {/* или area + clipPath — дождь только в окне */}
```

`Graded` делает из дневной картинки вечер/ночь без новой генерации (экспозиция,
насыщенность, тон multiply, дымка снизу). Окна загораются через `GlowSpots` по координатам
окон на картинке (посмотрите кадр и впишите точки).

### «Свет погас»

```ts
const glow = look.windowGlow * flicker(frame, { start: 150, dur: 30 });            // мигает и гаснет
const relit = look.windowGlow * flicker(frame, { start: 260, dur: 24, mode: "in" }); // загорается
```
Перед «погасло» ~1 с мерцания; переход экспозиции — через `lookAt` (24–36 кадров), не скачком.

### Blender

```bash
npx tsx ../../studio/lib/scene-state/look.ts --time evening --season autumn --out assets/look.json
studio blender .claude/skills/scene-state/examples/island.py --out out/evening.png -- --look assets/look.json --render
```
В своём bpy-скрипте: `sys.path.insert(0, os.path.join(os.path.dirname(sx.__file__), "..", "scene-state"))`,
`import scene_state`, затем `scene_state.apply(scene_state.load(a.look))`, после
`sx.setup_render(a)` — `scene_state.exposure(look)`. Дымка (`fog_volume`) дороже — только
когда `look.fog > 0.3`.

### Реальная погода

```bash
npx tsx .claude/skills/scene-state/fetch-weather.ts --lat 55.75 --lon 37.62 --place Москва --out public/data/weather.json
```
→ `{state: {time, weather, season}, current: {temp, code, wind…}, attribution}`. Файл — кэш:
рендер не зависит от сети. **Атрибуция «Open-Meteo.com, CC BY 4.0» — в кадре обязательно.**

## Состояния должны различаться — на предмете, а не только в воздухе

- В диораме погода видна **на объекте**: мокрая земля темнее и блестит (ниже шероховатость,
  темнее альбедо), рябь и лужи на воде, деревья качаются, у дождя своё облако над героем —
  а не только полоски поверх всего кадра (и под парящим островом). Это знание, а не пресет:
  материалы three/Blender читают `look.rain`, а частицы можно ограничить объёмом над
  предметом (`center`/`size` у `Rain3D`).
- Каждое состояние отличимо на плитке телефона от соседних; одинаковые состояния (открытие
  и «воскресенье днём») — с причиной. Сравните первый и последний кадр каждой смены рядом.
- Цвет говорит то же, что голос: «солнце нагрело воду» — теплее, а не серее; «наверху
  холодно» — заметно холоднее предыдущего неба. Оверлей поверх палитры легко делает тёплый
  момент грязно-серым — проверяйте полосой «до → после» (art-direction).
- Пасмурно — не значит плоско: мягкий направленный ключ + AO/контактные тени, чтобы форма
  читалась.
- Смена состояния — это событие для камеры и звука: подъезд, смена атмосферы (sound-design).

## Стартовые точки (необязательно)

- Ночь не чёрная: полусферный свет 0.6–0.8 холодный синий, тёплые точки у окон/ламп; силуэт
  героя должен читаться (пресет `night` так и настроен).
- Смена «день → ночь» за 30–40 кадров читается как время; за 6–10 — как выключатель (так и
  надо, только если в сюжете щёлкнул выключатель).
- Облака — за героем и выше; облако перед героем закрывает главное.
- Зима = снег на `ground/roof/foliage` + `Snow3D`; новой модели не нужно.

## Чеклист

- [ ] Состояния и их смена — в `lookAt`-ключах (данные), а не в разных сценах.
- [ ] Каждое состояние отличимо на плитке телефона; погода видна на самом объекте; цвет
      смены совпадает со смыслом (тепло теплее, холод холоднее).
- [ ] На самом тёмном кадре виден силуэт героя; подпись читается (`readableOn(цвет, look.skyBottom)`).
- [ ] Переход света без скачка экспозиции: лента кадров (`studio sheet --frames a-b`) через переход.
- [ ] Свечение не пересвечивает лица и текст; облака не перекрывают героя.
- [ ] Модель названа по группам (иначе перекраска её не заденет — проверьте still каждого состояния).
- [ ] Реальные данные: файл в `public/data/`, атрибуция в кадре.

### Известное про probe

Смена освещения всего кадра (день → вечер) даёт `edge-crossing` (края кадра «меняются») и
`cover-gap` на ровном небе — это ложные срабатывания пиксельной проверки, а не вылет. Смотрите
ленту кадров перехода глазами; настоящий вылет — это объект, уходящий за один край.

## Проверено

Проверочный ролик: остров из `examples/island.py` (GLB 0.8 с), один дубль 320
кадров, день·лето → вечер·осень → ночь·дождь → зима·снег; черновик 0.45 с на секунду ролика.
Кадры: `out/stills/f0030.png`, `f0100.png`, `f0190.png`, `f0300.png`, лист `out/sheet-states.png`;
Blender-кадр вечера: `out/blender-evening.png`. Погода: `public/data/weather.json` (Москва).

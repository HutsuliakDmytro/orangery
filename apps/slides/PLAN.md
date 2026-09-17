# PLAN.md — Orangery Slides

План для Claude Code. Фази по порядку, задачі по порядку. Оцінка для одного розробника + Claude Code. Кожна фаза shippable сама по собі.

Статуси: `[ ]` · `[x]` · `[~]` · `[-]` (з причиною).

---

## Фаза 0 — Монорепа і каркас (тижні 1–2)

Мета: Docs працює як раніше, але з `apps/docs`; Slides — порожнє вікно з тими ж меню й темою.

### 0.1 Монорепа
- [x] ADR `0001-monorepo.md`: pnpm workspace + cargo workspace, чому спільні пакети
      — лежить у корені (`docs/adr/`), бо стосується всього воркспейсу, а не одного аппа
- [ ] Перенести `orangery-docs` у `apps/docs` без змін, CI зелений
- [ ] Витягти `packages/ooxml-core`: zip, rels, content types, XML parse/serialize, passthrough-утиліти
- [ ] Витягти `packages/ooxml-drawingml`: усе, що Docs уже парсить із `a:*`/`wp:*`/`pic:*` (картинки, anchor, transforms)
- [ ] Витягти `packages/editor-text`: ProseMirror-схема run/paragraph, команди форматування — без `w:`-специфіки в ядрі; Docs підключає `wordprocessing`-адаптер
- [ ] Витягти `packages/ui-kit`: tokens, теми, тулбар/дропдаун/діалог, command registry, palette
- [ ] Витягти `packages/platform` і `packages/tauri-shared` (atomic fs, autosave, recent, updater, menu builder)
- [ ] Docs після витягування: `pnpm --filter docs check` зелений, 1446 тестів на місці, round-trip корпус проходить
- [x] Root `pnpm check` ганяє всі пакети; CI матриця по apps
      — `pnpm check` у корені: prettier по репо + `pnpm -r check` по кожному пакету. У `build.yml` з'явилась вісь `app`, додати Slides — це дописати слово в список; тег `docs-v*`/`slides-v*` визначає, чиї артефакти публікуються

### 0.2 Skeleton Slides
- [ ] `apps/slides`: Tauri 2 + React, вікно, native menu, тема, welcome screen
- [ ] Layout-каркас: filmstrip (ліво) / canvas (центр) / properties (право) / notes (низ), resizable панелі
- [ ] `tests/fixtures/pptx/`: 20+ реальних дек — PowerPoint mac/win, Google Slides export, Keynote export, LibreOffice Impress; з анімаціями, діаграмами, відео, SmartArt, таблицями, групами
- [ ] Bundled fonts: Carlito, Liberation Sans/Serif, Inter

**DoD:** обидва апи запускаються з одного репо, Docs без регресій.

---

## Фаза 1 — PPTX рідний формат (тижні 3–5)

Мета: відкрити чужу деку, побачити її правильно, зберегти без змін — PowerPoint не помічає різниці.

### 1.1 Пакет
- [ ] ADR `0002-pptx-roundtrip.md`: per-shape passthrough, що моделюємо в MVP, що ні
- [ ] `ooxml-presentation`: читання `presentation.xml`, `slides/*`, `slideLayouts/*`, `slideMasters/*`, `theme/*`, `notesSlides/*`, `notesMaster`, `handoutMaster`, `tableStyles`, `viewProps`, `presProps`, comments — усе в `PptxPackage`
- [ ] Порядок слайдів з `sldIdLst`, rels на layout/master/notes/media
- [ ] Модель: `Presentation → Master[] → Layout[] → Slide[]`, `spTree`, EMU-координати
- [ ] Серіалізатор: перегенеровуються тільки змодельовані частини; `p:timing`, `p:transition` (поки), `mc:AlternateContent`, невідомі елементи — verbatim
- [ ] Round-trip тест: open → save без правок → структурний diff XML на всьому корпусі
- [ ] CI: LibreOffice headless → PDF до/після, render-diff

### 1.2 DrawingML → модель
- [ ] `sp`: `spPr` (xfrm, prstGeom 180+ пресетів — таблиця path-ів, custGeom), fill (solid/gradient/pattern/picture/none), line (width, dash, caps, arrows), effects (shadow базово; решта passthrough)
- [ ] `txBody`: `bodyPr` (insets, anchor, wrap, autofit, columns), `lstStyle`, `a:p`/`a:r`/`a:pPr`/`a:rPr` → ProseMirror через `editor-text`
- [ ] Bullets: `buChar`, `buAutoNum`, `buBlip`, `buNone`, рівні 0–8 з lstStyle успадкуванням
- [ ] `pic`: blip, crop (`srcRect`), transforms
- [ ] `grpSp`: вкладені трансформи (chOff/chExt), `cxnSp`: конектори з прив'язкою до фігур
- [ ] `graphicFrame`: таблиці (`a:tbl`) повністю; діаграми, SmartArt, OLE — як bounding box + passthrough (діаграми — рендер у 1.4)
- [ ] Placeholder-резолвер: `p:ph` type/idx → layout → master, злиття властивостей; тести на кожен рівень
- [ ] Theme: `clrScheme`, `fontScheme` (major/minor, latin/ea/cs), `fmtScheme`; `schemeClr` з `lumMod/lumOff/tint/shade/alpha`

### 1.3 Рендер (read-only)
- [ ] SVG-рендерер слайда: фон (solid/gradient/picture, з master), фігури, текст (через ProseMirror у режимі read-only або статичний HTML), картинки, таблиці, групи
- [ ] Autofit: вимірювання тексту після рендеру, `fontScale`/`lnSpcReduction` як у PowerPoint (±1 pt допуск)
- [ ] Filmstrip з thumbnail-ами (offscreen render → bitmap, кеш)
- [ ] Notes панель показує `notesSlide`
- [ ] Банер warnings для непідтримуваного, як у Docs

### 1.4 Діаграми read-only
- [ ] `c:chart` парсер: bar/col, line, pie/doughnut, scatter, area; серії, категорії, підписи, легенда, осі
- [ ] SVG-рендер із кольорами теми; решта типів — bounding box "Chart"
- [ ] На save — passthrough, `c:*` не чіпаємо

**DoD:** 20 дек корпусу — 0 регресій round-trip; візуально ≥ 95 % збіг із PowerPoint на скріншотах.

---

## Фаза 2 — Редактор (тижні 6–9)

Мета: створити деку з нуля або відредагувати чужу — на рівні Google Slides.

### 2.1 Виділення і трансформації
- [ ] Клік/Shift-клік/marquee, вибір у групі (подвійний клік входить у групу)
- [ ] Move/resize (8 ручок)/rotate, Shift/Alt-модифікатори, стрілки nudge
- [ ] Smart guides: центр слайда, краї, інші фігури, рівні відстані; лінійки й направляючі (drag з лінійки)
- [ ] Z-order: вперед/назад/на передній/на задній план
- [ ] Align/distribute (до слайда або до виділення), flip H/V
- [ ] Group/ungroup зі збереженням трансформів
- [ ] Copy/paste/duplicate (`Mod+D`) фігур між слайдами й деками; paste зберігає позицію або зміщує
- [ ] Undo/redo транзакційний, 100+ кроків

### 2.2 Фігури
- [ ] Панель вставки: пресети (прямокутник, еліпс, стрілки, callouts, зірки, блок-схема) — малювання drag-ом
- [ ] Лінії та конектори з прив'язкою до точок фігур; редагування точок
- [ ] Fill/line/shadow редактори в properties панелі, кольори теми + custom, gradient editor
- [ ] Текст у будь-якій фігурі; `bodyPr` — anchor, insets, wrap, autofit (Shrink on overflow / Resize shape / None)
- [ ] Картинки: вставка з файлу/буфера/drag, crop (двоклік → crop mode), заміна, прозорість, скидання
- [ ] Таблиці: вставка N×M, рядки/стовпці, об'єднання, стилі з `tableStyles`
- [ ] Іконки (bundled SVG-набір) — вставляються як `sp` з `custGeom`, щоб пережити PowerPoint

### 2.3 Текст
- [ ] Редагування тексту в фігурі через `editor-text`: B/I/U/S, шрифт, розмір, колір, підсвітка, superscript, caps, spacing
- [ ] Абзаци: вирівнювання, рівні (Tab/Shift+Tab), інтервали, відступи, bullets (символ, нумерація, картинка), колонки
- [ ] Placeholder-текст ("Click to add title") зникає при наборі, порожній placeholder не пишеться в файл
- [ ] Find & Replace по всій деці
- [ ] Автозаміна як у Docs (лапки, тире), spell-check — `[-]` до появи в Docs

### 2.4 Слайди
- [ ] Новий слайд (з layout поточного), дублювати, видалити, drag-reorder у filmstrip, multi-select
- [ ] Зміна layout зі збереженням контенту placeholder-ів (mapping за type/idx як у PowerPoint)
- [ ] Секції (`p14:sectionLst`) — назви, згортання у filmstrip
- [ ] Фон слайда: колір/градієнт/картинка, "приховати графіку master"
- [ ] Заголовки слайдів у outline-режимі (панель Outline: заголовки+текст placeholder-ів, редагування там же)
- [ ] Notes: редагування, зберігається в `notesSlide` з правильним master
- [ ] Slide size: 16:9 / 4:3 / custom, масштабування контенту при зміні
- [ ] Zoom canvas 25–400 %, fit, `Mod+0`

### 2.5 Master і теми
- [ ] Перегляд master/layouts (Slide Master view): редагування placeholder-ів, фонів, шрифтів теми
- [ ] Галерея тем: "Orangery" (чорний/оранжевий, Inter) + 6 нейтральних; застосування теми до деки перефарбовує через `schemeClr`
- [ ] Шрифти теми (major/minor) у дропдауні як "Heading / Body"
- [ ] Збереження власної теми як `.thmx` — `[-]` до запиту

**DoD:** зробити 15-слайдову деку з нуля без миші там, де це можливо; відкрити її у PowerPoint — все на місці, включно з placeholder-ами й темою.

---

## Фаза 3 — Показ і вивід (тижні 10–11)

### 3.1 Слайд-шоу
- [ ] Окреме вікно на весь екран на вибраному дисплеї (Tauri multi-window), `F5` з початку, `Shift+F5` з поточного
- [ ] Навігація: клік/space/стрілки/PgUp/PgDn/Home/End, `N`+Enter, `B`/`W`, `Esc`
- [ ] Presenter view на іншому дисплеї: поточний, наступний, нотатки (масштабований шрифт), таймер, годинник, сітка слайдів для стрибка
- [ ] Транзиції: none/fade/push/wipe з тривалістю з файлу; решта → fade, `p:transition` зберігається
- [ ] Анімації: не грають, об'єкти у фінальному стані; `p:timing` verbatim
- [ ] Відео/аудіо: playback з media parts, автоплей за `p:timing` — базово; клік запускає
- [ ] Гіперпосилання на слайд/URL клікабельні в показі
- [ ] Тест на проекторі/другому моніторі на macOS: перемикання дисплеїв, sleep не вбиває вікно

### 3.2 Експорт
- [ ] PDF: слайди, з нотатками, handouts 2/3/6 на сторінку; шрифти вбудовані
- [ ] PNG/JPEG кожен слайд або поточний; SVG поточного
- [ ] ODP імпорт/експорт (свій шар, passthrough-підхід)
- [ ] Друк через системний діалог

### 3.3 Файли
- [ ] New/Open/Save/Save As/Close, recent, `.pptx`/`.odp` "Open with", drag-and-drop, кілька вікон
- [ ] Atomic write, `.bak`, autosave, відновлення після краху — з `tauri-shared`
- [ ] Медіа > 20 МБ: пропозиція стиснути картинки при збереженні (як PowerPoint)
- [ ] Шаблони при створенні: порожня, з темою, 5 стартових дек (pitch, лекція, звіт, захист диплому, портфоліо)

**DoD:** лекція на 40 слайдів із відео проведена з presenter view на проекторі без збоїв.

---

## Фаза 4 — Реліз MVP macOS (тижні 12–13)

- [ ] `docs/qa-checklist.md` для Slides (за зразком Docs, + блок "показ на проекторі")
- [ ] Продуктивність: 300 слайдів з картинками — filmstrip 60 fps, відкриття < 3 с, пам'ять < 800 МБ
- [ ] E2E: відкрити чужу деку → додати слайд → фігура+текст → зберегти → перевідкрити → PDF; показ від початку до кінця клавіатурою
- [ ] Іконка, DMG universal, updater (endpoint спільний з Docs)
- [ ] Підпис/нотаризація — `[-]` разом із Docs
- [ ] Лендинг оновити: Docs + Slides
- [ ] Beta 5–10 людей зі своїми деками, зібрати зламані файли в корпус
- [ ] `slides-v0.1.0` pre-release

---

## Update 1 — Windows + Linux (тижні 14–16)

- [ ] Аудит: OS-специфіка тільки в `packages/platform`
- [ ] Windows: Ctrl, F5/Shift+F5, повноекран на другому моніторі через WebView2, NSIS
- [ ] Linux: WebKitGTK повноекран на Wayland/X11 (тут будуть сюрпризи), відео-кодеки (GStreamer) — записати вимоги, AppImage + .deb
- [ ] Шрифти: metric-compatible fallback на всіх ОС, autofit не дрейфує
- [ ] CI матриця, QA-чекліст на трьох ОС, `slides-v0.2.0`

---

## Update 2 — Дистрибуція suite (після Update 1 обох аппів, 1–2 тижні)

Мета: окремі завантаження лишаються за замовчуванням; з'являється один інсталятор "Orangery" з вибором, що ставити.

### Спільне
- [ ] ADR `000N-suite-distribution.md`: окремі бінарники, окремі bundle id, окремі теги (`docs-vX`, `slides-vX`), спільна версія suite (`suite-vX`) як snapshot сумісних версій
- [ ] Updater: один endpoint, канали по апп; suite-оновлення = оновлення кожного встановленого аппа окремо
- [ ] Асоціації файлів не перетинаються: `.docx/.odt/.rtf` → Docs, `.pptx/.odp` → Slides; жоден інсталятор не реєструє чуже
- [ ] Спільна тека налаштувань `<appdata>/Orangery/{docs,slides}`, спільні bundled fonts (один раз на диску)
- [ ] Лендинг: три кнопки на апп + "Завантажити все"

### Windows
- [ ] Один NSIS `.exe` з components page: Docs ☑, Slides ☑ (пізніше Sheets); Tauri NSIS-шаблон розширити
- [ ] Спільні файли (шрифти, runtime) ставляться раз; uninstall кожного аппа окремо
- [ ] winget: окремі манифести на апп

### macOS
- [ ] Один DMG з обома `.app` і ярликом Applications — людина тягне що хоче; без `.pkg` з галочками
- [ ] Окремі DMG лишаються основним шляхом
- [ ] Homebrew casks: `orangery-docs`, `orangery-slides`

### Linux
- [ ] Окремі `.deb`/AppImage на апп + мета-пакет `orangery-suite` (Depends на всі)
- [ ] Спільний пакет `orangery-fonts` для bundled шрифтів
- [ ] Flathub — за запитом

**DoD:** на Windows один інсталятор ставить вибрані аппи, на macOS обидва варіанти працюють, на Linux `apt install orangery-suite` тягне все.

---

## Після Update 2

- **Анімації: playback** (entrance/exit/emphasis/motion path, порядок, тригери) — великий шматок, окремий план
- **Анімації: редагування** — після playback
- **Редагування діаграм** — таблиця даних → `c:*` регенерація зі збереженням стилю
- **SmartArt** — рендер із `dgm:*` layout-алгоритмами хоча б для базових; редагування — навряд
- **Pen/laser/highlighter** у показі, збереження ink
- **Recording** нарації, авто-таймінги, експорт у відео
- **Embedded fonts** (`p:embeddedFontLst`)
- **Колаборація** — разом із Docs (Yjs), одна інфраструктура
- **Keynote import** (`.key` — zip з protobuf, є reverse-engineered спека) — за запитом
- **Морфінг-транзиція** (PowerPoint Morph) — маркетингова фіча, дорога
- **Import з Docs**: outline → дека

---

## Ризики

| Ризик | Мітигація |
|---|---|
| Витягування пакетів із Docs зламає Docs | Фаза 0.1 має DoD "1446 тестів + корпус зелені"; ніяких змін логіки, тільки переміщення |
| DrawingML більший, ніж здається (пресети, ефекти, 3D) | Список підтримуваного жорстко в ADR; решта — passthrough + bounding box; пресети — таблиця, не 180 ручних path-ів |
| Autofit не збігається з PowerPoint | ±1 pt допуск у тестах, bundled metric-compatible шрифти, порівняння на корпусі |
| Fullscreen на другому дисплеї у Tauri | Прототип у фазі 0 на всіх ОС — 1 день, щоб знати, у що впремося |
| Placeholder-успадкування трирівневе | Резолвер + тести в 1.2 до будь-якого редагування |
| Анімації люди чекають одразу | Чесно в лендингу: "зберігаються, не грають (поки)"; passthrough гарантує, що нічого не втратиться |

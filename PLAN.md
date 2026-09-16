# PLAN.md — Orangery Docs

План розробки для Claude Code. Працюємо фазами, задачі виконуються по порядку. Оцінка — для одного розробника + Claude Code, повний робочий час. Тижні орієнтовні.

Статуси: `[ ]` не почато · `[x]` зроблено · `[~]` в роботі · `[-]` відкладено (з причиною).

---

## Фаза 0 — Каркас (тиждень 1)

Мета: порожній вікно-редактор запускається на macOS, CI зелений.

- [x] Ініціалізувати Tauri 2 + React 19 + TS strict + Vite + pnpm
- [x] Tailwind + `src/styles/tokens.css` з темою dark (default) та light за палітрою з CLAUDE.md
- [x] ESLint + Prettier + `pnpm check` (lint, tsc, vitest)
- [x] Vitest + RTL, один smoke-тест; `cargo test` з одним тестом
- [x] Структура папок за CLAUDE.md, `docs/adr/0001-tech-stack.md`
- [x] Tauri: одне вікно, титул, мінімальний native menu bar (App / File / Edit / View / Help)
- [x] `src/platform/`: `keys.ts` (Mod), `paths.ts` (app data dir), `os.ts`
- [x] GitHub Actions: `check` на кожен PR, `build-macos` (без підпису поки що)
- [x] Tiptap з `StarterKit`, редактор на весь екран, тема застосована
- [~] `tests/fixtures/docx/` — зібрати 20+ реальних DOCX (Word mac/win, Google Docs export, LibreOffice, резюме, курсова з таблицями, документ із колонтитулами)
      — 16 синтетичних. П'ять справжніх документів були в корпусі тимчасово й прибрані з історії: вони особисті. Вони знайшли вісім дефектів, усі виправлення лишились; чекліст того, що потрібно замість них — у `tests/fixtures/docx/README.md`

**Definition of done:** `pnpm tauri dev` відкриває вікно, можна набирати текст, CI зелений.

---

## Фаза 1 — Ядро редактора (тижні 2–4)

Мета: базове форматування на рівні Google Docs, всі команди через registry.

### 1.1 Registry команд і клавіатура

- [x] `src/editor/commands/registry.ts` — тип команди, реєстрація, `isActive/isEnabled`
- [x] Хук `useCommand(id)` для тулбару та меню
- [x] Native menu (Tauri) генерується з registry — пункти + shortcuts + enabled-стан
- [x] Command palette (`Mod+Shift+P`) з пошуком по registry

### 1.2 Текстове форматування

- [x] Bold / Italic / Underline / Strikethrough (`Mod+B/I/U/Shift+X`)
- [x] Superscript / Subscript
- [x] Колір тексту, колір виділення (highlight) — палітра + custom
- [x] Шрифт (список системних + bundled) і розмір (пресети + input)
- [x] Clear formatting (`Mod+\`)

### 1.3 Параграфи

- [x] Заголовки H1–H6 + Normal + Title/Subtitle (стилі як у Docs)
- [x] Вирівнювання L/C/R/J (`Mod+Shift+L/E/R/J`)
- [x] Міжрядковий інтервал (1, 1.15, 1.5, 2, custom), відступи до/після абзацу
- [x] Indent / Outdent (`Tab` / `Shift+Tab` поза списками, `Mod+]` / `Mod+[`)
- [x] Bulleted / numbered / checklist списки, вкладеність, зміна маркера
- [x] Blockquote, горизонтальна лінія, розрив сторінки (`Mod+Enter`)

### 1.4 Навігація та редагування

- [x] Undo/Redo з коректною групуванням (набір тексту не по одному символу)
- [x] Find & Replace (`Mod+F` / `Mod+H`), підсвітка збігів, regex опційно
- [x] Посилання: вставка/редагування/відкриття (`Mod+K`), автолінк URL
- [x] Вставка з буфера: HTML → ProseMirror з очищенням, plain text через `Mod+Shift+V`
- [x] Статистика: слова / символи / сторінки (approx) у статус-барі
- [x] Input rules: `- `, `1. `, `# `, `---`, `**bold**`

### 1.5 Тести

- [x] Unit-тести на кожну команду (ProseMirror doc до/після)
- [x] Тест реєстру: жодної команди без label і без shortcut-колізій

**DoD:** можна написати й відформатувати курсову з заголовками, списками та посиланнями без миші.

---

## Фаза 2 — DOCX як рідний формат (тижні 5–7)

Мета: відкрити чужий DOCX, відредагувати, зберегти — і Word не помітить різниці там, де ми не чіпали. Це ядро продукту.

### 2.1 OOXML-шар (`src/ooxml/`)

- [x] ADR `0003-docx-native-roundtrip.md`: чому не mammoth/docx-npm, стратегія passthrough (номер 0002 зайнятий реєстром команд)
- [x] Читання пакета: JSZip, `[Content_Types].xml`, rels, `document.xml`, `styles.xml`, `numbering.xml`, `settings.xml`, `theme`, `fontTable`, headers/footers, media — усе тримати в пам'яті як `DocxPackage`
- [x] Схема ProseMirror за OOXML-семантикою: `paragraph{pPr}`, `run{rPr}`, `numbering{numId,ilvl}`, `sectPr`, `styleId`, `passthrough` node/mark
- [x] Парсер `document.xml` → ProseMirror: абзаци, run-и, стилі (успадкування через styles.xml), нумерація, breaks, гіперпосилання, bookmarks
- [x] Серіалізатор ProseMirror → `document.xml`; невідоме пишеться назад verbatim з passthrough
- [x] Round-trip тести на всьому корпусі: open → save без правок → структурне порівняння XML (ігноруючи `rsid`, порядок атрибутів)
- [x] CI: LibreOffice headless → PDF до/після, піксельний diff з порогом
- [x] Стилі документа читаються з `styles.xml` і рендеряться (Normal, Heading 1–6, Title, List Paragraph, Quote тощо); дропдаун стилів у тулбарі бере список саме звідти
- [x] Нумерація за `numbering.xml` (abstractNum/lvl, маркери, формати, restart); нові списки створюють коректні numbering-інстанси
- [x] Шрифти: mapping OOXML → системні/bundled, theme fonts

### 2.2 Життєвий цикл документа

- [x] Zustand `documentStore`: path, format, dirty, warnings[], lastSaved
- [x] New (порожній DOCX з дефолтним `styles.xml` нашого шаблону) / Open / Save / Save As / Close (`Mod+N/O/S/Shift+S/W`), системні діалоги
- [x] Атомний запис + `.bak`
- [x] Індикатор незбережених змін (macOS dirty dot), prompt при закритті
- [x] Recent files, реєстрація `.docx`/`.odt`/`.rtf`/`.txt`/`.md` як типів, відкриття подвійним кліком / drag-and-drop
- [x] Автозбереження внутрішнього снапшоту кожні 5 с бездіяльності; відновлення після краху при старті
- [x] Банер "деякі елементи можуть відображатись некоректно" з розгорнутим списком warnings
- [x] Кілька вікон = кілька документів

### 2.3 Інші формати

- [x] TXT, Markdown, HTML — import + export
- [x] RTF — import + export (базове форматування)
- [x] ODT — import + export через той самий підхід (пакет + passthrough), мінімум: текст, стилі, списки, таблиці
      — текст, заголовки, стилі, посилання, списки, таблиці та зображення; тип списку читається з `text:list-style` у `styles.xml` і `content.xml`
- [x] «Зберегти як» між будь-якими форматами: документ без власного пакета конвертується в DOCX/ODT із шаблону, зображення переносяться в пакет
      — конвертований документ не стає сесією нового формату до перевідкриття, тож кожне збереження перебудовує пакет заново; на вміст файлу це не впливає
- [-] PDF — тільки експорт (відкладено: за планом робиться у Фазі 4 разом із друком)
- [-] `.doc` (binary) — post-MVP, read-only

**DoD:** 20+ файлів корпусу проходять round-trip без візуальних відмінностей. Курсова з таблицями та колонтитулами після редагування тексту відкривається у Word без ремонту файлу.

---

## Фаза 3 — Інтерфейс (тижні 8–9)

Мета: виглядає як звичний редактор документів, у чорно-оранжевій темі.

- [x] Layout: menu bar (native) → toolbar → ruler → сторінка по центру на сірому фоні → статус-бар
- [x] Toolbar у стилі Docs: undo/redo, zoom, стилі абзацу, шрифт, розмір, B/I/U, колір, лінк, списки, вирівнювання, інтервал
- [x] Всі кнопки прив'язані до registry, стан active/disabled живий
- [x] Горизонтальна лінійка: поля сторінки та відступи абзацу, drag
- [x] Page view: біла "сторінка" A4/Letter з полями, візуальні межі сторінок (approx по висоті), zoom 50–200 % (`Mod+=/-/0`)
- [x] Вибір формату сторінки та полів (Page setup dialog), орієнтація
- [x] Бічна панель Outline (структура заголовків, клік → перехід)
- [x] Перемикач теми Dark/Light + follow system; збереження в settings
- [x] Settings dialog: тема, шрифт за замовчуванням, автозбереження, мова UI (uk/en)
- [x] Локалізація UI: en + uk через `i18next`, всі рядки в json
- [x] Welcome screen: нові / останні документи / шаблони (порожній, лист, звіт)
- [x] Доступність: фокус-кільце (orange), aria на тулбарі, навігація клавіатурою по меню
- [ ] Перевірка на Retina, 13" ноутбук, повноекранний режим macOS
      — ручна перевірка, потребує вашого екрана: скриншот зняти не можу (macOS не дає дозволу на запис екрана)

**DoD:** людина, що користується Docs, сідає і працює без пояснень.

---

## Фаза 4 — Складний контент (тижні 10–12)

- [x] Таблиці: вставка (сітка), додати/видалити рядок/стовпець, об'єднання, ширина стовпців drag, стиль меж, фон комірок
- [~] Зображення: вставка з файлу / буфера / drag, зберігання в `media/`, resize з ручками, вирівнювання, обтікання (inline / wrap / break)
      — усе готове, окрім `wrapNone` (зображення за текстом): у CSS немає еквівалента, тож воно лишається passthrough. Вставка працює в DOCX, ODT і в конвертованих документах
- [x] Колонтитули (header/footer): один на документ, номер сторінки, дата
- [x] Виноски (footnotes) — базово
- [x] Зміст (Table of contents) з заголовків, оновлення по кліку
- [x] Спецсимволи / емодзі діалог
- [x] Друк (`Mod+P`) через webview + `print.css`; експорт PDF через Tauri print-to-PDF
- [x] OOXML: таблиці (`tbl/tr/tc`, `tblPr`, merges, borders, widths) у обидва боки
- [~] OOXML: зображення (`drawing`, inline + anchor/wrap), media parts, rels
      — inline і anchor із wrapSquare/Tight/Through/TopAndBottom у обидва боки; `wrapNone` лишається passthrough
- [x] OOXML: header/footer parts, `sectPr` (поля, орієнтація, розмір), page numbers via fields
- [~] OOXML: footnotes.xml, TOC як `fldSimple`/complex field з кешованим результатом
      — footnotes.xml у обидва боки; TOC записується як complex field Word із кешованим результатом. Читання чужого TOC назад у редаговану ноду не робиться: він і так зберігається дослівно, а розбір ризикував би зламати round-trip
- [~] Розширити корпус фікстур під усе вище, round-trip зелений
      — 16 синтетичних проходять round-trip. Справжні документи прибрані з репозиторію як особисті; `real/` порожня і чекає на файли, які не шкода тримати в git
- [x] Продуктивність: документ 200 сторінок — набір тексту без лагів, профілювання, віртуалізація decorations
- [~] E2E (Playwright): відкрити чужий docx → відредагувати → таблиця → зберегти → перевідкрити → PDF
      — 14 браузерних e2e (редагування, тулбар, таблиці, палітра, пошук, діалоги, мова) + CI-джоба; сценарій із відкриттям файлу потребує `tauri-driver`, який на macOS не підтримується (TODO в його README) — тому shell-рівень лише в CI на Linux, див. `tests/e2e/README.md`

**DoD:** реферат із таблицею, картинками та змістом експортується в PDF і DOCX і виглядає адекватно.

---

## Фаза 5 — Реліз MVP macOS (тиждень 13)

- [ ] Apple Developer: сертифікат Developer ID Application, notarization у CI (секрети в GitHub)
- [x] Іконка застосунку (чорна плитка, оранжевий знак)
- [~] Universal binary (arm64 + x86_64), DMG з drag-to-Applications
      — конфіг DMG і universal target готові; сам артефакт збирається лише в CI, локально не перевірявся
- [~] Tauri updater: endpoint, підпис оновлень, перевірка при старті
      — конфіг є, `active: false`; потребує реального endpoint і ключа підпису
- [x] Crash reporting — тільки локальний лог у app data (без телеметрії)
- [~] Ручний QA-чеклист (`docs/qa-checklist.md`) пройдено на macOS 14 і 15
      — чекліст написаний; проходження потребує вашої машини
- [ ] Beta для 5–10 користувачів, зібрати фідбек, полагодити blockers
- [ ] Тег `v1.0.0`, GitHub Release, коротка сторінка-лендинг

**DoD:** незнайома людина завантажує DMG, ставить, працює без Gatekeeper-попереджень.

---

## Update 1 — Windows + Linux (тижні 14–17)

- [x] Аудит `src/platform/`: усі OS-залежності лише там (paths, shortcuts, dialogs, menu accelerators)
- [ ] Windows: Ctrl замість Cmd, `Alt`-меню, WebView2 bootstrapper в інсталяторі
- [ ] Windows: NSIS/MSI інсталятор, підпис коду (Azure Trusted Signing або сертифікат), реєстрація `.docx`/`.odt` як "Open with" (не за замовчуванням, щоб не бісити людей з Word)
- [ ] Linux: AppImage + .deb, WebKitGTK, перевірка на Ubuntu 24.04 і Fedora
- [x] Bundled fonts (Inter, Liberation Sans/Serif/Mono) — однаковий вигляд документа на всіх ОС
- [ ] Друк/PDF на Windows та Linux — перевірити webview-друк, за потреби Rust-fallback
- [x] Тема: Windows title bar / Linux CSD — рішення, ADR (`docs/adr/0004-window-chrome.md`)
- [x] CI: матриця macOS / Windows / Ubuntu, e2e на всіх трьох
- [ ] Updater endpoints для трьох платформ
- [ ] QA-чеклист на трьох ОС, реліз `v1.1.0`

---

## Після Update 1 (беклог, пріоритет за фідбеком)

- Справжня пагінація (page-flow layout) — найбільший технічний борг
- Legacy `.doc`, `.pages` (read-only)
- Track changes і коментарі — `w:ins/w:del/w:comment` уже є в OOXML, тому це природне продовження фази 2
- Перевірка орфографії (Hunspell через Rust, uk + en словники)
- Коментарі та track changes
- Спільне редагування (Yjs + власний sync-сервер або локальна мережа)
- Хмарна синхронізація (свій бекенд або iCloud/Drive)
- Формули (KaTeX), діаграми
- Стилі документа (custom styles, style sheet)
- Плагіни / скрипти
- Автотести на регресію продуктивності

---

## Ризики

| Ризик                                             | Вплив                                                  | Мітигація                                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Пагінація в ProseMirror — немає готового рішення  | Не буде точного "як у Word" вигляду                    | MVP: візуальні межі сторінок approx; справжня пагінація — окремий етап після релізу                                             |
| DOCX fidelity — тепер це ядро продукту            | Зламали чужий документ = втратили користувача назавжди | Passthrough усього невідомого, корпус реальних файлів, render-diff у CI, чіткий список того, що редагуємо, а що лише зберігаємо |
| Складність OOXML (стилі, нумерація, поля, sectPr) | Фаза 2 розповзається                                   | Жорсткий scope на фазу: тільки те, що є в корпусі; решта — passthrough                                                          |
| Продуктивність на великих документах              | Лаги при наборі                                        | Профілювати з фази 1, віртуалізація decorations, бюджети на рендер                                                              |
| Apple notarization / Windows signing              | Блокує реліз                                           | Робити в фазі 0 хоча б unsigned build у CI, підпис — на початку фази 5                                                          |
| Розповзання скоупу (колаборація, хмара)           | Не встигнути MVP                                       | Жорсткий "out of scope" у CLAUDE.md                                                                                             |

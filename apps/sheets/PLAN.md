# PLAN.md — `packages/charts` + Orangery Sheets

Фаза 0 — спільний движок діаграм; він потрібен Docs і Slides уже зараз і є передумовою Sheets. Фази 1+ — сам Sheets. Не починати фазу 1, поки Slides не в релізі (`slides-v0.1.0`), інакше три недороблені аппи.

Статуси: `[ ]` · `[x]` · `[~]` · `[-]` (з причиною).

---

## Фаза 0 — `packages/charts` (тижні 1–4)

Мета: діаграми з PowerPoint/Excel/Word рендеряться правильно у всіх трьох аппах, у Slides і Docs їх можна редагувати, файл після збереження відкривається без втрат.

### 0.1 Модель і парсер
- [x] ADR `0001-charts-model.md`: одна модель для трьох аппів, per-chart passthrough, список типів MVP
- [x] Читання `c:chartSpace`: `c:chart`, `c:plotArea`, типи bar/col (clustered/stacked/100%), line, pie/doughnut, scatter, area, radar; комбіновані (кілька `c:*Chart` в одному plotArea)
- [x] Серії: `c:ser` з `c:tx`, `c:cat`, `c:val`, `c:xVal/yVal`, кешовані значення (`c:numCache`/`c:strCache`) + посилання на дані (`c:f`)
- [x] Осі: `c:catAx`, `c:valAx`, `c:dateAx`, формат чисел, min/max/major unit, обернені, secondary axis
- [~] Легенда, заголовок, підписи даних (`c:dLbls`), лінії тренду (render), error bars (render), таблиця даних (render) — усе прочитано в модель; сам render у 0.2
- [~] Стилі: `c:spPr` через `ooxml-drawingml` ✔, `c:style` (id 1–48) ✔, `schemeClr` символічно ✔; `cs:chartStyle` (`cs:*` parts) — чекає на фікстуру з Excel/PowerPoint, наосліп не пишемо
- [x] Невідомі типи (stock, surface, bubble 3D, sunburst/treemap `cx:*`) → `UnsupportedChart` з bounding box, XML verbatim

### 0.2 Рендер
- [x] SVG-рендерер: `c:layout` (manual plot area, edge-режим) ✔, default gaps/overlap/маркери як у Office ✔ (gap 150, overlap −27/100, маркер 5), stacked/100 %, шкала осей із файлу, пропуски за `c:dispBlanksAs`, radar ✔. `factor`-режим `c:layout` читається як «автоматично» — це зсув від власного розкладу Office, і застосувати його точно може лише той, хто той розклад повторює
- [x] Кольори з теми, `accent1..6` циклом; `c:varyColors`; колір серії й окремої точки (`c:dPt`) переважає тему
- [ ] Тести-скріншоти проти PowerPoint/Excel render на 30 діаграмах корпусу (LibreOffice як проксі в CI, ручна перевірка на macOS)
- [x] Render у Docs (`w:drawing` → chart part) і Slides (`graphicFrame`) замість bounding box

### 0.3 Редагування
- [x] Модель редагування: тип, серії, дані, заголовок, легенда, осі, підписи, кольори серій
- [x] Серіалізатор: перезапис тільки змодельованих елементів усередині оригінального `c:chartSpace`; невідоме на місці
- [x] Джерело даних: embedded workbook `embeddings/Microsoft_Excel_Sheet1.xlsx` — читання/запис через мінімальний `ooxml-spreadsheet` (sharedStrings, один sheet, числа/рядки) — це зародок фази 1
- [x] Редактор даних: невеликий grid (`packages/grid`, canvas, віртуалізований — основа сітки Sheets) у діалозі "Edit data" у Slides
- [x] Панель властивостей діаграми у Slides та Docs: тип, серії, легенда, осі, підписи (спільний `ChartProperties` у `packages/charts`)
- [x] Вставка нової діаграми з шаблону (5 типів) з дефолтними даними — як у PowerPoint; працює і в Slides, і в Docs
- [x] Round-trip тести: open → save без правок → XML diff; open → змінити одне число → save → змінилося лише `c:numCache` і embedded xlsx

**DoD:** 30 діаграм корпусу — 0 регресій round-trip; у Slides можна вставити, відредагувати дані й тип; PowerPoint відкриває результат і показує ті самі числа.

**Стан фази 0 (2026-09-19):** усе зроблено, крім трьох пунктів, які впираються в те саме — у репозиторії немає жодного справжнього файлу з Office, усі фікстури синтетичні:
- `cs:chartStyle` (`cs:*` parts) — парсер наосліп писати не можна;
- скріншот-тести проти 30 діаграм корпусу (і LibreOffice render-diff у CI);
- сам DoD «PowerPoint відкриває результат» — перевірено нашим читачем і структурним діфом, живим Office ще ні.

Потрібно: 10–15 `.pptx`/`.xlsx`/`.docx` з діаграмами з Excel/PowerPoint (mac і win), Google Sheets export і LibreOffice → `tests/fixtures/office/` (див. README там же; приватні файли — через `ORANGERY_CORPUS`). Харнес готовий: `packages/charts/src/corpus.test.ts` підхоплює все, що покладуть, і без файлів пропускається; `pnpm --filter charts corpus` друкує, що в корпусі є.

---

## Фаза 1 — XLSX рідний формат (тижні 5–8)

Мета: відкрити чужу книгу, побачити її правильно (значення з кешу), зберегти без змін — Excel не помічає різниці.

### 1.1 Пакет
- [x] ADR `0002-xlsx-roundtrip.md`: що моделюємо, що passthrough (pivotCache/pivotTable, slicers, queryTables, connections, vbaProject, customXml, externalLinks, metadata, richData)
- [~] `ooxml-spreadsheet`: `workbook.xml` ✔ (sheets зі станом, definedNames, calcPr, date1904, activeTab), `worksheets/*` ✔ (dimension, sheetViews з панелями й масштабом, cols, sheetData, mergeCells, autoFilter, tabColor), `sharedStrings` ✔. `styles` ✔ (numFmts, fonts, fills, borders, cellXfs/cellStyleXfs із каскадом `apply*`, dxfs). Лишилось: `theme`, `tables/*`, `comments`/`threadedComments`/`persons`, `vmlDrawing`, conditionalFormatting/dataValidations/hyperlinks/pageSetup (поки лишаються verbatim через текстову підстановку)
- [x] Стрімінговий парсер `sheetData` (власний сканер) — файл на 500k рядків не будує DOM; тест на 100k комірок
- [~] Модель: sparse cells ✔, row metadata ✔, column metadata ✔, merged ranges ✔, freeze/split panes ✔, zoom ✔; style index → resolved style ✔ (`resolveStyle`; кешує викликач — грид питає це на кожну видиму комірку)
- [ ] Shared/array formulas розгортаються; при незмінності — згортаються назад
- [ ] Rich text у комірках (`<r>` runs у sharedStrings/inlineStr)
- [ ] Серіалізатор: `sheetData` регенерується; стилі дедупляться у `cellXfs`; `calcChain` перебудовується або видаляється (Excel відновлює); невідомі частини verbatim
- [ ] `tests/fixtures/xlsx/` — 30+ реальних книг: Excel mac/win, Google Sheets export, LibreOffice, з pivot, макросами (`.xlsm`), умовним форматуванням, таблицями, діаграмами, defined names, зовнішніми посиланнями
- [ ] Round-trip: open → save → XML diff; CI LibreOffice render-diff

### 1.2 Формати чисел (`packages/numfmt`)
- [ ] Парсер format-кодів: секції `;`, умови `[>100]`, кольори `[Red]`, локаль `[$-409]`, `#,##0.00`, `0.00E+00`, `# ?/?`, `[h]:mm:ss`, `@`, escape/literal, `*` fill, `_` pad
- [ ] Вбудовані `numFmtId` 0–49 як в Excel
- [ ] Дати: серійні → дати з `date1904`, формати `d/m/yyyy`, `mmm`, `dddd`, `AM/PM`, elapsed
- [ ] Тестова матриця 300+ пар (значення, код) → рядок, звірена з Excel

### 1.3 Read-only рендер (grid v1)
- [ ] Canvas-grid: віртуалізація рядків і стовпців, headers, gridlines, freeze panes, zoom, кілька аркушів (таби)
- [ ] Рендер значень із кешу через `numfmt`, вирівнювання за типом, стилі (шрифт, колір, fill, borders, wrap, merge, indent, rotation базово)
- [ ] Умовне форматування read-only: `cellIs`, `containsText`, `colorScale`, `dataBar`, `iconSet` — обчислюється тільки для видимого діапазону
- [ ] Діаграми через `packages/charts`, картинки через drawingml
- [ ] Коментарі — індикатор + hover
- [ ] Бюджет: viewport repaint < 8 ms, відкриття книги 200k комірок < 2 с

**DoD:** 30 книг корпусу — 0 регресій round-trip; виглядає як в Excel на скріншотах; читаються кешовані значення, ще без формул.

---

## Фаза 2 — Редагування без формул (тижні 9–11)

- [ ] Виділення: клік, Shift, Mod, marquee, рядки/стовпці цілком, `Mod+A`, `Mod+Shift+Arrows`, Name box
- [ ] Редагування комірки: overlay input, `F2`, `Enter/Tab` напрямки, `Alt+Enter`, `Esc`, автодоповнення значень зі стовпця
- [ ] Введення: авто-визначення типу (число, дата за локаллю, відсоток, булеве, текст з `'`), `Mod+;` дата, `Mod+Shift+;` час
- [ ] Форматування: тулбар (шрифт, розмір, B/I/U, кольори, borders, fill, вирівнювання, wrap, merge, number format дропдаун + custom діалог), Format Cells діалог як у Excel
- [ ] Рядки/стовпці: вставити/видалити/приховати/показати, ширина/висота drag і auto-fit, group/outline
- [ ] Fill handle: серії чисел/дат/днів/місяців, копія, custom lists; подвійний клік — до кінця даних
- [ ] Clipboard: internal, HTML, TSV; Paste Special (values, formats, transpose)
- [ ] Undo/redo транзакційний, 100k комірок paste — один крок
- [ ] Аркуші: додати/видалити/перейменувати/перемістити/дублювати/колір таба/сховати
- [ ] Freeze panes, split, zoom, приховані gridlines, кілька вікон
- [ ] Find & Replace по аркушу/книзі, у значеннях/формулах
- [ ] Sort (по стовпцях, custom), AutoFilter (значення, текст, числа, кольори) — `autoFilter` записується у файл
- [ ] Merge, hyperlinks, коментарі (створити/редагувати/видалити, `threadedComments` за замовчуванням + legacy `comments` для сумісності)
- [ ] Файли: New/Open/Save/Save As, `.xlsx`/`.xlsm` (макроси verbatim, банер "макроси не виконуються")/`.csv`/`.ods` "Open with", autosave, `.bak`, crash recovery
- [ ] CSV import wizard: роздільник, кодування (UTF-8/1251/1252), десятковий, перший рядок — заголовки; export з опціями
- [ ] ODS import/export базовий

**DoD:** можна вести таблицю обліку без формул, Excel відкриває без ремонту.

---

## Фаза 3 — Формульний движок (тижні 12–16)

`crates/formula`, Rust. Чиста бібліотека, без I/O.

### 3.1 Ядро
- [ ] ADR `0003-formula-engine.md`: власний Rust, чому не HyperFormula; precision rules
- [ ] Lexer/parser: A1 refs, `$`, ranges, whole row/col, 3D, `Sheet name`!, структуровані `Table[#Headers]`, defined names, оператори (`+ - * / ^ & = <> < > <= >= : , space`), масиви `{1,2;3,4}`, `%`, unary
- [ ] Типи значень: Number, String, Bool, Error, Empty, Array (2D), Reference; coercion як в Excel
- [ ] Граф залежностей: комірка→прецеденти; діапазони через interval tree; вставка/видалення рядків зсуває посилання
- [ ] Інкрементальний перерахунок: dirty set → topological order; volatile завжди; `#SPILL!`/`#CALC!`; циклічні посилання — виявлення, повідомлення
- [ ] Dynamic arrays: spill range, `@` implicit intersection, `_xlfn.`/`_xlws.` префікси і `cm` metadata на записі
- [ ] Precision: 15 significant digits display, Excel subtraction rounding, `ROUND` half-away-from-zero
- [ ] Bridge: Tauri commands `set_cell`, `recalc`, `get_values(range)`; batch API; WASM build для web viewer
- [ ] Бенчмарки: 1M формул — повний recalc < 2 с, одна правка з 10k залежних < 50 ms

### 3.2 Функції (кожна з ≥ 5 Excel-верифікованими тестами)
- [ ] Math: SUM, SUMIF/S, PRODUCT, ROUND/UP/DOWN, INT, MOD, ABS, SQRT, POWER, EXP, LN, LOG, PI, RAND/BETWEEN, CEILING/FLOOR (.MATH), TRUNC, SUMPRODUCT, SUBTOTAL, AGGREGATE (базово), SEQUENCE
- [ ] Stats: AVERAGE/IF/S, COUNT/A/BLANK/IF/S, MIN/MAX/IFS, MEDIAN, MODE, STDEV.S/P, VAR.S/P, RANK, LARGE, SMALL, PERCENTILE, QUARTILE, CORREL, FORECAST.LINEAR
- [ ] Logical: IF, IFS, AND, OR, NOT, XOR, IFERROR, IFNA, SWITCH, TRUE/FALSE, LET, LAMBDA (базово)
- [ ] Lookup: VLOOKUP, HLOOKUP, XLOOKUP, INDEX, MATCH, XMATCH, LOOKUP, OFFSET, INDIRECT, CHOOSE, ROW/S, COLUMN/S, ADDRESS, FILTER, SORT, SORTBY, UNIQUE, TRANSPOSE
- [ ] Text: LEFT/RIGHT/MID, LEN, FIND/SEARCH, SUBSTITUTE, REPLACE, TRIM, CLEAN, UPPER/LOWER/PROPER, TEXT (через `numfmt`), VALUE, CONCAT/TEXTJOIN, REPT, CHAR/CODE/UNICODE, TEXTSPLIT/BEFORE/AFTER, EXACT, T, N
- [ ] Date/Time: TODAY, NOW, DATE, TIME, YEAR/MONTH/DAY, HOUR/MINUTE/SECOND, WEEKDAY, WEEKNUM, EOMONTH, EDATE, DATEDIF, NETWORKDAYS(.INTL), WORKDAY(.INTL), DAYS, DATEVALUE, TIMEVALUE
- [ ] Financial: PMT, IPMT, PPMT, PV, FV, NPER, RATE, NPV, IRR, XNPV, XIRR, SLN, DB
- [ ] Info: ISBLANK/NUMBER/TEXT/ERROR/NA/LOGICAL/FORMULA, TYPE, CELL (частково), NA, ERROR.TYPE, SHEET/S
- [ ] Engineering/DB — `[-]` до запиту
- [ ] Реєстр: невідома функція → `#NAME?`, але формула зберігається verbatim

### 3.3 UI формул
- [ ] Formula bar: підсвітка посилань кольорами на гриді під час редагування, клік/drag вибирає діапазон
- [ ] Автодоповнення функцій з підказкою сигнатури, `Tab` вставляє
- [ ] `F4` цикл `$`, `F9` перерахунок, Calculate options (auto/manual)
- [ ] Показ помилок з поясненням, trace precedents/dependents (стрілки) — базово
- [ ] Вставка/видалення рядків і стовпців коректно зсуває формули, defined names, умовне форматування, validations, таблиці
- [ ] Корпус формул: 20 реальних книг з формулами → наші результати = кеш Excel на 100 % (зберігаємо як тест)

**DoD:** 250+ функцій зелені; 20 книг корпусу перераховуються з тими ж результатами, що в Excel.

---

## Фаза 4 — Фічі рівня Excel (тижні 17–19)

- [ ] Умовне форматування — редагування всіх правил з 1.3 + formula-based; менеджер правил
- [ ] Data validation: список (dropdown у комірці), число/дата/довжина/custom formula, повідомлення
- [ ] Таблиці (`Table1`): створити/розширити, стилі з `tableStyles`, structured refs в автодоповненні, total row
- [ ] Defined names: менеджер, scope (book/sheet)
- [ ] Діаграми: вставка з виділення, редагування через `packages/charts`, дані з діапазону з живим оновленням
- [ ] Картинки, фігури на аркуші (з drawingml, прив'язка `twoCellAnchor`)
- [ ] Sparklines — render read-only, passthrough
- [ ] Pivot — render кешованих значень, passthrough; банер "оновіть у Excel"
- [ ] Друк/PDF: page setup (області друку, масштаб fit-to, повторювані заголовки, header/footer, орієнтація), розриви сторінок, print preview
- [ ] Захист аркуша/книги — read + respect (заблоковані комірки), запис пароля-хешу як є
- [ ] Group/outline (`+/-`), subtotals
- [ ] Text to columns, Remove duplicates, Flash Fill — `[-]`
- [ ] Goal Seek — дешево, ефектно; Solver — `[-]`
- [ ] Шаблони: бюджет, інвойс, облік, графік, ДСТУ-таблиця (для дипломів)

**DoD:** місячний бюджет із умовним форматуванням, dropdown-ами, таблицею, діаграмою і друком у PDF — без відкриття Excel.

---

## Фаза 5 — Реліз MVP macOS (тижні 20–21)

- [ ] `docs/qa-checklist.md` для Sheets (+ блок "перерахунок збігається з Excel на своїх файлах")
- [ ] Продуктивність: 1M рядків — скрол 60 fps, відкриття < 5 с, пам'ять < 1 ГБ; 100k формул — recalc < 1 с
- [ ] E2E: чужа книга → правка → формула → сорт/фільтр → діаграма → save → reopen → PDF
- [ ] Іконка, DMG, updater канал `sheets`; підпис — `[-]` разом з рештою
- [ ] Beta зі своїми книгами; зламані — у корпус
- [ ] `sheets-v0.1.0` pre-release

---

## Update 1 — Windows + Linux (тижні 22–24)

- [ ] Ctrl-шорткати, `Alt`-меню; Linux — WebKitGTK canvas продуктивність (перевірити рано, може бути гірше за WebView2)
- [ ] Шрифти: Calibri → Carlito, ширини стовпців у "символах" залежать від шрифту за замовчуванням (`maxDigitWidth`) — перевірити на трьох ОС, інакше ширини "пливуть"
- [ ] CSV: кодування Windows-1251 за замовчуванням для `.csv` з Excel ru/uk
- [ ] CI матриця, QA, `sheets-v0.2.0`
- [ ] Suite-інсталятор (Update 2 у Slides) — додати Sheets як третій компонент

---

## Після Update 1

- Pivot tables редагування (окремий великий план)
- Iterative calc, R1C1, більше функцій (engineering, database, cube — ні)
- Sparklines редагування, slicers
- Power Query — ні; макроси — ні (зберігаються, не виконуються)
- Web viewer: grid + WASM formula engine у браузері
- Колаборація — разом із Docs/Slides
- `.xls` (BIFF8) read-only, `.numbers` — за запитом

---

## Ризики

| Ризик | Мітигація |
|---|---|
| Функції дають інші результати, ніж Excel | Excel-верифіковані тести до реалізації; корпус реальних книг як регресія; `TEXT`/дати/фінанси — з подвоєною увагою |
| `numFmt` — нескінченна |Спека-таблиця + матриця тестів; невідомий код → показати General і warning, не крашитись |
| Canvas на WebKitGTK повільний | Прототип grid на Linux у фазі 1, а не в Update 1 |
| Стрімінг великих sheetData | Парсер без DOM з першого дня; фікстура 500k рядків у CI |
| Charts (фаза 0) затягне | Жорсткі 8 типів; решта passthrough; фазу 1 не починати, поки Slides не в релізі, а не поки charts ідеальні |
| Sheets — найбільший апп, соло | Кожна фаза shippable: 1–2 = "перегляд і легке редагування", вже корисно як viewer |

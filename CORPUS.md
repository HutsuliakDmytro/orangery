# CORPUS.md — реальний корпус файлів

Мета: `tests/fixtures/office/` перестає бути порожньою; три заблоковані пункти плану закриваються; кожен файл, який ламає апп, стає issue з регресійним тестом.

Файли скачано в `~/corpus-raw/` (Apache POI test-data, python-docx/pptx test_files, LibreOffice). Приватні (дипломні, робочі) — окремо в `~/corpus-private/`, у git ніколи.

**Стан на 22.09.2026: кроки 1–3 зроблено.** Що вийшло — `docs/corpus.md` (джерела, ліцензії, як влаштовано, що чим запускати) і `docs/corpus-baseline.md` (числа першого прогону). Два відхилення від плану, обидва в `docs/corpus.md`: SheetJS `test_files` GitHub заблокував (TOS), тому `numfmt_*` немає; матриця має чотири порожні клітинки (`docx/toc`, `docx/math`, `docx/smartart`, `xlsx/dynamicarrays`) — ці фічі є тільки у файлах LibreOffice, а їх MPL не пускає в git. Render-diff працює і прогнаний, але як CI-гейт не ввімкнений: 60 зі 140 файлів дають `diff`, а гейт дозволений тільки на зеленому baseline. Крок 4 не починався — нічого не фіксилось.

Статуси: `[ ]` · `[x]` · `[~]` · `[-]`.

---

## Крок 1 — Інвентаризація (півдня)

- [x] Скрипт `scripts/corpus/inventory.ts`: рекурсивно по `~/corpus-raw/`, для кожного файлу: шлях, розширення, розмір, чи валідний zip, чи є `[Content_Types].xml`, генератор (з `docProps/app.xml` `Application` + `AppVersion`), список частин пакета (щоб знати, у кого є `charts/`, `pivotTables/`, `vbaProject.bin`, `comments`, `embeddings/`)
- [x] Вивід у `corpus-inventory.json` + зведення: скільки файлів по формату, по генератору (Word/Excel/PowerPoint версії, Google, LibreOffice, POI-generated, інше), по фічах
- [x] Викинути: `.xls`/`.doc`/`.ppt` (binary, не наш формат — окремо в `legacy/` на майбутнє), файли з паролем, свідомо пошкоджені з POI (`*-corrupt*`, `*bad*`) — у `hostile/`, вони теж корисні, але окремо
- [x] Ліцензії: по кожному джерелу файл `LICENSES.md` у корпусі; LibreOffice (MPL) і файли з невідомим походженням — тільки через `ORANGERY_CORPUS`, не в git

## Крок 2 — Відбір у публічний корпус (півдня)

Ціль: не "все", а покриття. У git — до ~150 файлів, до ~50 МБ.

- [x] `tests/fixtures/office/{docx,pptx,xlsx}/` за схемою `<generator>-<feature>-<n>.<ext>` (`excel2016win-pivot-01.xlsx`, `gdocs-numbering-03.docx`)
- [~] Для кожного формату матриця фіч × генераторів, мінімум 2 файли на клітинку де є:
  - docx: numbering, tables, images anchor/inline, sections+headers/footers, footnotes, fields/TOC, comments, track changes, styles-heavy, math (OMML), RTL/CJK, форми (`sdt`)
  - pptx: masters/layouts multi, placeholders, groups, tables, charts (кожен тип), SmartArt, media, animations/transitions, notes, sections, custom geometry
  - xlsx: shared strings/inline, styles/numFmt (`numfmt_*` з SheetJS обов'язково), shared/array/dynamic formulas, defined names, tables, cond. formatting, validation, merges, freeze, charts, pivots, macros (`.xlsm`), comments/threaded, external links, 1904, великі (100k+ рядків — один-два)
- [x] Решта валідних файлів → `~/corpus-full/` для `ORANGERY_CORPUS`-прогонів; шлях і опис у `docs/corpus.md`

## Крок 3 — Перший прогін (день)

- [x] `pnpm corpus:run` — новий скрипт: для кожного файлу з обох корпусів `open → save-без-правок → structural XML diff → reopen`, headless, з таймаутом 30 с і лімітом пам'яті; результат у `corpus-report.json`: `ok | diff | crash | timeout | oom`, з deltas і stack trace
- [x] Прогнати на публічному + повному корпусі, зафіксувати baseline у `docs/corpus-baseline.md` (число ok/diff/crash по формату)
- [x] Кожен `crash`/`timeout`/`oom` → GitHub issue з міткою `corpus`, мінімальним репро (файл або опис структури, якщо приватний), без фіксу поки що
- [x] Кожен `diff` → класифікувати: (а) наш баг round-trip, (б) допустима нормалізація (порядок атрибутів, `rsid`, пробіли) — додати у whitelist diff-ера, (в) невідомо → issue
- [x] Формули: для xlsx з `<f>` — окремий прогін `recalc → порівняти з кешованим <v>`; розбіжності → issue з міткою `formula`, у форматі "функція, аргументи, Excel, ми"
- [x] Charts: `packages/charts/src/corpus.test.ts` тепер не skip; render кожної діаграми в SVG → `corpus-charts/` для ручного перегляду проти оригіналу
- [~] Render-diff (LibreOffice → PDF до/після) на публічному корпусі в CI; на повному — локально, раз

## Крок 4 — Фікси (тиждень, паралельно з QA-фідбеком)

Пріоритет: crash > oom/timeout > diff у тому, що ми чіпаємо > formula mismatch > diff у passthrough > візуальні.

- [ ] Кожен фікс іде з регресійним тестом на тому файлі (публічний) або на синтетичному мінімальному репро (приватний)
- [ ] Не розширювати модель заради одного файлу — якщо конструкція рідкісна, правильний фікс — passthrough, не підтримка
- [ ] Після кожних 10 закритих issues — перепрогнати корпус, оновити baseline; baseline не повинен погіршуватись — це тепер CI-гейт на публічному корпусі

## Крок 5 — Закрити пункти плану

- [ ] Sheets `PLAN.md`: 30+ workbooks round-trip → `[x]`, 20 workbooks з формулами → `[x]`, 30 charts render-diff → `[x]`
- [ ] Docs `PLAN-2.md` фаза 7 "Корпус" → `[x]`
- [ ] Slides `PLAN.md` 0.2 фікстури → `[x]`
- [ ] `HANDOFF.md`: секція "Waiting on real files" → замінити на baseline-числа
- [ ] `hostile/` файли з POI — окремий тест "не крашимось на сміттi": кожен має дати зрозумілу помилку за < 5 с

## Постійно

- Кожен файл від тестера, який щось зламав → у приватний корпус + issue + після фіксу синтетичне репро в публічний
- Раз на реліз — повний прогін на `~/corpus-full/`, різниця з baseline у release notes

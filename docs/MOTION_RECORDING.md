# Recording an animation problem

The demo has a small **Запись движения** panel. Recording is opt-in; it does no
pose/probe/snow logging until started. It is diagnostic data, not screen video.

1. Press **F7** while playing, or click **Запись** with the cursor released.
2. Reproduce the problem. Press **F8** as soon as it happens. Up to the last
   20 seconds / 1800 rendered frames are retained, so recording may be started
   before the exact trigger is known.
3. Use the slider or **← / →** to inspect frames. Slow playback and side/front/top
   views help inspect feet. **Как было** uses the captured camera.
4. Select the problematic frame, write a note and click **Отметить кадр**.
5. **Скачать запись** downloads a `.json.gz` file (plain `.json` on browsers without
   gzip compression). Attach that file in chat. Download also marks the current
   frame and saves its note.

**Открыть файл** imports that same recording. It opens on the selected frame,
including notes. Use the same seed, map size and snow-demo/ordinary-game mode.
**Вернуться в игру** restores the live pose/snow rendering and releases the pause.
F8 can reopen the retained recording before it is replaced or the page is closed.
The file is local; this tool has no upload service or automatic network sending.

## What is captured

- The final per-render avatar hierarchy transforms/visibility, after interpolation
  and the IK reach guard, together with the actual selected camera and render alpha.
- Physics tick inputs (keys, mouse deltas, view yaw/pitch), player displacement,
  KCC grounded/movement results, and all locomotion state before/after each tick,
  including private planner counters and complete foot states.
- Foot probe coordinates, surface positions/normals and support identity. Unusually
  large probe/tick batches carry an explicit truncation marker.
- Snow's initial sparse material state and coalesced reversible cell changes,
  including preset resets. Rolling eviction advances the initial snow state so
  the first retained frame still replays correctly.
  Optional cell contact exposures and frame weather exposure preserve gradual
  track burial when seeking forward/backward. Older four-value cells and six-value
  journals still load; new recordings add a fifth cell value and two journal values.
- Scene settings, viewport, build asset identifier, selected frame and notes.

The viewer applies saved transforms; it does not run the gait solver again and
hide a broken interpolated frame behind a newly computed pose. Snow reconstruction
uses a separate field, leaving live player physics, planner state and material
untouched. The file supplies data for investigating the solver separately.

Legacy recordings without a diagnostics block replay the character/camera and snow
against the currently loaded world. New recordings also carry local object and
system snapshots; see DIAG-001 below. Neither is a deterministic replay of every system. A changed character rig is rejected rather than silently misplayed.
Files are versioned, bounded, validated and interpreted only as data. Gzip and raw
input are limited to 64 MiB, including decompressed size.

## Validation

`npm run test:motion-record` checks bounded history, snow baselines/resets, detached
snapshots, input/alpha/notes preservation, malformed data rejection, exact reversible
snow journals and gzip/JSON round trips.

`npm run test:motion-recorder-browser` uses Playwright/Chromium on port 5206 to test
F7/F8, fractional-frame pose preservation, camera views, stepping without changing
live physics, marked download/import and returning to the original game state.
Use `CHROMIUM_PATH` and `NODE_PATH` as for the other browser suites.

## Пакет диагностики мира (DIAG-001)

F7/F8 теперь записывают не только походку. В `.json.gz` добавлен необязательный
блок `diagnostics` версии 1; прежние записи `nimble-motion` версии 1 читаются.

После F8:

- Заполните «Ожидалось» и «Произошло», выберите кадр и нажмите «Отметить кадр».
- Нажмите на мини-карту для отметки места. Голубая точка — игрок, жёлтые —
  объекты, розовые — отметки. Координаты отметки и текст находятся в `notes`.
- Выберите «Свободная камера участка»: мышь вращает камеру, колесо приближает,
  правая кнопка перемещает. «Коллайдеры и контакты» показывает простые формы
  Rapier и нормали точек опоры, сохранённые физическими тиками.
- Раскройте «Объекты, системы и границы восстановления»: там идентификаторы,
  определения предметов, здоровье, влажность, содержимое, дерево, скорости,
  карманы, экипировка, цели действий, огонь, погода, тело и локальное тепло.
- Скачайте файл и приложите в чат. Выход восстанавливает отображение живой игры.

Записанный участок открывается даже при другом seed. Геометрия берётся из файла,
не из новой генерации. При несовпадении seed просмотр текущего мира отключён.
При несовпадении рига доступен участок, но поза несовместимого персонажа не
применяется. Ошибки JavaScript и необработанные Promise во время записи (до 40) находятся
в `context.errors`, с временными отметками. SHA сборки хранится в `context.buildSha`; несовпадение показывает
предупреждение. Пакет локальный, автоматически никуда не отправляется.

### Состав и точность

`frames[].worldSampleId` ссылается на `diagnostics.samples[].id`. Снимки состояния
делаются с интервалом не чаще 250 мс по реальному времени. Геометрия вынесена в
общий словарь `meshes`, каждый экземпляр хранит мировую матрицу. Снимки отсоединены
от игровых объектов. Кольцевой буфер сохраняет предшествующий снимок, чтобы
самый ранний оставшийся кадр продолжал иметь валидную ссылку.

Пределы: радиус 32 м, сетка земли 17×17 с шагом 4 м, 128 объектов,
64 меша и 32 коллайдера на объект, 512 мешей на снимок, 120 тысяч вершин и 128 общих геометрий,
не более 100 снимков. Инвентарь входит независимо от расстояния. Сначала
сохраняются ближайшие сущности, затем доступные локальные опоры Rapier.
Превышение помечается `truncated`; ограничения перечислены в `coverage`.

Это **локальная реконструкция для осмотра**, а не загрузка сохранения и не
детерминированный запуск всей игры. Между снимками состояние не интерполируется.
Не сохраняются полные текстуры, освещение, внешние skinned/instanced-модели,
вся геометрия леса и удалённых сооружений. Сетка земли приблизительная; простые
коллайдеры, trimesh и доступные вершины сложных опор — отдельные данные.
Неподдерживаемые формы остаются описанием, а не выдуманной геометрией.
Снег и походка продолжают использовать точную исходную запись; снег отображается
только в совместимой сцене. Система не возобновляет симуляцию из снимка.

Для разбора без браузера распакуйте gzip и прочитайте JSON: `context` определяет
сборку и настройки генерации, `notes` — проблему и место, `selectedFrameId` —
кадр, `diagnostics.samples` — окружающие объекты и системы, `frames[].ticks` —
ввод, движение и пробы. Импорт проверяет структуру, размеры, числовые данные,
ссылки на геометрию и снимки до изменения режима игры.

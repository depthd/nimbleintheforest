# Проверка истории и сохранности изменений

Проверка выполнена 8 ноября 2026 относительно опубликованной версии `bbe7e4a`.
Проверены все 56 коммитов, доступных из четырёх удалённых веток; 40 из них имеют
автора Claude. Проверка не ограничивалась именем автора: коммиты Alexey и depthd
проверены в том же наборе.

## Результат

В `bbe7e4a` отсутствовал ровно один удалённый коммит: **`450184d` — Keep the frame
rate up with destructible structures**, с соавторством Claude Opus 5.5. Он
сохранился в `claude/dreamy-volta-29zhnf`, но не был объединён с опубликованной
веткой. Остальные 55 коммитов уже присутствовали в её истории.

Исправление включает исходный `450184d` слиянием веток, сохраняя историю и
оптимизации рендера из `bbe7e4a`. `resting.ts`, `merge.ts`, `build/build.ts`,
`build/statics.ts` и `wood/wood.ts` побайтово совпадают с версией Opus.
В `game.ts`, `entities.ts`, `ctx.ts` сохранены обе системы: физика/брёвна и
человеческие тела с карманами одежды.

## Источники проверки

- `claude/dreamy-volta-29zhnf` — `450184d`.
- `claude/friendly-archimedes-onmybq` — опубликованный `bbe7e4a`.
- `claude/friendly-johnson-pkpaj3` — `3adca69`.
- `claude/sleepy-meitner-fy67ds` — `5389330`.
- Полный `git ls-remote origin`: тегов нет; единственный PR ref — PR №1,
  `3adca69`, уже включённый в историю через `a8fcef8` и `5389330`.
- GitHub PR №1 закрыт и объединён. Дополнительных PR-коммитов вне набора нет.
- Репозиторий не shallow. Проверка `git fsck --full --no-reflogs --unreachable`
  нашла три служебных коммита временного stash этой работы; других локальных
  недостижимых коммитов не найдено.

## Проверка содержимого, а не только родительских ссылок

- Для слияния `5389330` проверены обе ветки. 23 уникальных файла деревянной
  ветки совпадают с `a88175c`, 21 уникальный файл ветки гор/пещер — с `a8fcef8`.
  Общие файлы проверены отдельно: сохранены строительство, wood preview,
  cave autostart, пещеры, крыши/снег и отсечение предметов.
- Дерево файлов `a8fcef8` совпадает с `3adca69`.
- В `bbe7e4a` нет удалённых файлов. Его изменения ограничены рендером тел,
  рельефом, группировкой леса, кэшем следов, тестами и документацией.
- Геометрия рельефа сравнена с исходным построителем в 24 сочетаниях участка,
  LOD и снега: массивы совпадают точно. Индексный построитель вынесен в общий
  модуль для Worker и запасного порционного режима.
- Геометрия тел сравнена с `0463253` в 48 сочетаниях варианта и одежды:
  позиции, нормали, UV и материалы совпадают с погрешностью до 3,92×10⁻⁸.
- Модели деревьев, густота, дальность, рубка, короны, коллайдеры и падения
  сохранены; изменено разбиение инстансов для отсечения.
- Погода, материал и детализация снега, восстановление записанных ячеек и
  сохранность следов проверены сравнением с полной пересборкой.
- Тепло, тело игрока, одежда/еда, звук, ввод, генерация мира, животные, квест,
  вода, дом, скалы и пещеры не переписывались оптимизациями `bbe7e4a`.

Дополнительно проверены 242 исторических снимка TypeScript-файлов из 40
коммитов Claude, включая изменения деклараций методов и функций. Исчезнувшие
старые декларации сопоставлены с заменами:

| Коммит | Замена |
|---|---|
| `c2f5882` | Старые `Lake`/`lake.ts` и локальные методы рельефа заменены `Water` и генератором `Region`; это единственное историческое удаление TS-файла в `src`. |
| `ce3c13d` | Старые `Thermal.windowUA/computeParts` заменены моделью объёмного тепла (`windowLeak/step/aggregate`). |
| `87b2083` | Старые `breakTrunk/trunkYields/logMesh/sectorGeo/treeGeometry` заменены системой настоящих кусков дерева и её мешами. |
| `5968c12` | Самим Claude удалён неиспользуемый helper `transverse`. |
| `bbe7e4a` | Индексы `Terrain.makeIndex` строятся в общем `terrain-geometry.ts`; отдельные части тел хранятся вне сцены и объединяются для рендера. |

Необъяснимых удалений в этом сравнении не обнаружено. Это статическая проверка
истории и перечисленные тесты, а не утверждение о выполнении каждого возможного
игрового сценария. Внутренние интерфейсы рендера изменились: `backdrop` теперь
`Group`, а отсечение дальней карты использует маску готовых чанков вместо
`uNearCenter/uNearHalf`. Их прежних внешних потребителей в репозитории нет.

## Проверки совмещённой версии

Сборка; 18 проверок статики; интеграция спящих брёвен с настоящими Rapier и
Three.js (совместный сон, пробуждение, подбор, изменение и распил без остаточной
геометрии); браузерные проверки строительства/обрушений, валки и разделки дерева,
обыска тел и карманов. Проверки геометрии Worker, групп деревьев и модели тел
также выполнены.

## Все проверенные коммиты

Столбец «в bbe7e4a» показывает состояние до исправления. В совмещённой истории
присутствуют все перечисленные коммиты.

| Коммит | Автор | Изменение | В bbe7e4a |
|---|---|---|---|
| [`6f0a647`](https://github.com/depthd/nimbleintheforest/commit/6f0a6474ef921b84a3349a45b01d49669388dcb0) | Claude | Add winter survival sandbox prototype | да |
| [`ce3c13d`](https://github.com/depthd/nimbleintheforest/commit/ce3c13db01b66cccb6cf19e626000e5bb4297034) | Claude | Simulate indoor air as a 3D field; fix stairs and soft items breaking glass | да |
| [`c2f5882`](https://github.com/depthd/nimbleintheforest/commit/c2f5882c7c7549661832781fe9ca05bd43dee101) | Claude | Generate a 3 km region with biomes, rivers, lakes and sea | да |
| [`9004a22`](https://github.com/depthd/nimbleintheforest/commit/9004a220de7160c47ffcf5fdcc1dd04ccfc90ff0) | Claude | Add huts, tower, station radio goal, heavier movement, wind and music, new inventory | да |
| [`12718d5`](https://github.com/depthd/nimbleintheforest/commit/12718d53c68ec65b5d7aab971fe3d3835abeba4d) | Claude | Add mood, reading notes, newspapers and books with skills | да |
| [`3255c38`](https://github.com/depthd/nimbleintheforest/commit/3255c38f7fce98cfc8d13a30c300feb01d8d7aee) | Claude | Give each piece of clothing its own wetness and show how things dry | да |
| [`e1eecd5`](https://github.com/depthd/nimbleintheforest/commit/e1eecd5db8ec59a0a36910d47af38b2c0ff4817a) | Claude | Stash loot in chests, under bunks and in lockers to be searched | да |
| [`5ffbb00`](https://github.com/depthd/nimbleintheforest/commit/5ffbb003555a344517c829fca9114fa9c77e431f) | Claude | Add a map that reveals where you have been, help for the goal, roadmap notes | да |
| [`940f185`](https://github.com/depthd/nimbleintheforest/commit/940f18552553d419a5760c628fb9f3ff8a7b4f07) | Claude | Fix flickering sea ice; add animal rig with procedural gaits | да |
| [`8c3d124`](https://github.com/depthd/nimbleintheforest/commit/8c3d124976a743bf5031bdf654ae55461295f13f) | Claude | Add foxes with senses and behaviour; keep hare, deer and bear models for later | да |
| [`c325db8`](https://github.com/depthd/nimbleintheforest/commit/c325db8fe821a5ae48319763e581f53a942de6c2) | Claude | Run faster: 5.2 m/s sprint, 1.95 m/s walk | да |
| [`b75ab7b`](https://github.com/depthd/nimbleintheforest/commit/b75ab7b39942a20b17845ac8e91c3dc919bba822) | Claude | Fix jerky running; guarantee huts near the house and a reachable goal | да |
| [`cd06d08`](https://github.com/depthd/nimbleintheforest/commit/cd06d0852c94a7600cf29deb325af63beafb3c38) | Claude | More shelters: lean-tos, fishing huts with a boat and old holes, more grottos; clearer ice escape | да |
| [`7079b7b`](https://github.com/depthd/nimbleintheforest/commit/7079b7becd80cc1ea22fe1833032c853ba5e9dda) | Claude | Make every shelter enterable: taller doorways, higher lean-tos, walk-in test | да |
| [`6466d1e`](https://github.com/depthd/nimbleintheforest/commit/6466d1e3da85962eb7961ac7e20cb8de4223a151) | Alexey | Add first-person procedural body, grounded foot IK and independent look | да |
| [`e4aec70`](https://github.com/depthd/nimbleintheforest/commit/e4aec708bd0a4aaba502f78326930c2c31892873) | Alexey | Refine upright posture, running stride and foot-led turning | да |
| [`745f787`](https://github.com/depthd/nimbleintheforest/commit/745f7875721579bab191517fa1960d4efd7b4866) | Alexey | Release sliding foot anchors and enforce fixed leg lengths | да |
| [`805c515`](https://github.com/depthd/nimbleintheforest/commit/805c515d0cf6f758fc0879206ec34e857bc5d226) | Alexey | Add bounded snow experiment driven by continuous boot motion | да |
| [`a3893b8`](https://github.com/depthd/nimbleintheforest/commit/a3893b8b3007e7bef5ce58ab0d36b0febbbae0cc) | Alexey | Add slope-aware snow cover and three small test hills | да |
| [`15bab89`](https://github.com/depthd/nimbleintheforest/commit/15bab89eadbc9fdf7478b073979dc756c123b5b4) | Alexey | Add opt-in motion capture with frame review and annotated export | да |
| [`06fed38`](https://github.com/depthd/nimbleintheforest/commit/06fed3809fe44d61c9421b68cd13c9dea1beb3ce) | Alexey | Fix foot recovery and body tracking during continuous sprint turns | да |
| [`d178331`](https://github.com/depthd/nimbleintheforest/commit/d1783317feabfc5b94bc5383dbc7b49a2e878570) | Alexey | Enable bounded deformable snow throughout ordinary forest gameplay | да |
| [`5a91c88`](https://github.com/depthd/nimbleintheforest/commit/5a91c8843e20c20eafd8a49e2dc4f328b5d629dc) | Alexey | Render persistent smooth trails and gradually bury them with weather | да |
| [`c0c9964`](https://github.com/depthd/nimbleintheforest/commit/c0c996490296b7e6b6fe574902381febf66c25b2) | depthd | Reduce snow trail rendering cost with smooth intermediate LODs | да |
| [`07968b9`](https://github.com/depthd/nimbleintheforest/commit/07968b9df3fdaf39b12c982bd081fdf1f21dab16) | depthd | Retry Pages publication after the previous deployment timed out | да |
| [`01e14b6`](https://github.com/depthd/nimbleintheforest/commit/01e14b6a7f87ec3330f1b74272570f0cb63d226c) | depthd | Add optional FPS counter and frame-time graph | да |
| [`9bda659`](https://github.com/depthd/nimbleintheforest/commit/9bda6592b4ceefa8b0ca3cce44f499b86a74ed25) | depthd | Unify snow cover for buildings and smooth shore transitions | да |
| [`87b2083`](https://github.com/depthd/nimbleintheforest/commit/87b208389d0b439c145a4297ee94bcc0c41aa0c3) | Claude | Chop wood where you hit it: notched trees, real-size pieces | да |
| [`9d30cf8`](https://github.com/depthd/nimbleintheforest/commit/9d30cf8aac584117257271f9bf8888b0a176455b) | Claude | Structures of real pieces that carry loads and collapse | да |
| [`72560b3`](https://github.com/depthd/nimbleintheforest/commit/72560b3fc23ea904f7bf02d1822d5fa383517356) | Claude | Build by hand with the pieces you carry | да |
| [`fd96d08`](https://github.com/depthd/nimbleintheforest/commit/fd96d089589029318ee5d6375ca15ee1c49b206b) | Claude | Document wood, felling, structures and building | да |
| [`d5e7eb1`](https://github.com/depthd/nimbleintheforest/commit/d5e7eb1fefc7615423a0e8885cfdf275c86c5764) | Claude | Draw standing structure parts as one mesh per material | да |
| [`fe740ba`](https://github.com/depthd/nimbleintheforest/commit/fe740ba371c08db3de092dbd1529355d4a952fdb) | Claude | Log huts built from real logs, boards and stones | да |
| [`bbcea36`](https://github.com/depthd/nimbleintheforest/commit/bbcea368e6b09085659490994abb730fbf4ae0d2) | Claude | Document log huts | да |
| [`b812240`](https://github.com/depthd/nimbleintheforest/commit/b8122404759c7feaf5afc11bdc29eb34549eb4be) | Claude | Lay logs into a groove; reach big wood through loose snow | да |
| [`f3ff095`](https://github.com/depthd/nimbleintheforest/commit/f3ff09560cfce1c39394c5c3d689be6bfce271a9) | Claude | Skip static parts in per-frame entity updates | да |
| [`13bed74`](https://github.com/depthd/nimbleintheforest/commit/13bed740bb12ad04facce503a65491405a18b005) | Claude | Loose pieces load structures; a heavy landing hits hard | да |
| [`463cdde`](https://github.com/depthd/nimbleintheforest/commit/463cddec60a19cc5579035045e166ddddd6edc80) | Claude | Porch roof and woodshed of real pieces | да |
| [`24a4546`](https://github.com/depthd/nimbleintheforest/commit/24a4546ad3ccd90b53603c754ea29c1e70df65cf) | Claude | Dig fire pits out of the snow | да |
| [`79c6371`](https://github.com/depthd/nimbleintheforest/commit/79c637137fd472307902187742de7970d93dcedf) | Claude | Draw boughs as one mesh; hide small loose pieces far away | да |
| [`5968c12`](https://github.com/depthd/nimbleintheforest/commit/5968c124c11cda2ecea32d1fab3e93b0a5a3bfea) | Claude | Remove unused statics helper | да |
| [`50c4b8f`](https://github.com/depthd/nimbleintheforest/commit/50c4b8fee7a2982eab97742a8f2f9b9f96075dda) | Claude | Rip logs into boards and hew them into beams | да |
| [`3b9e7d6`](https://github.com/depthd/nimbleintheforest/commit/3b9e7d67427faf77d872c594f9d40c7c890815ae) | Claude | Steep roofs shed snow | да |
| [`0cac893`](https://github.com/depthd/nimbleintheforest/commit/0cac893f95d4fecc3f319be91964a878961b6ab3) | Claude | First-time tips for felling, building and structure parts | да |
| [`ec18abb`](https://github.com/depthd/nimbleintheforest/commit/ec18abb8ce33fb0e56ff14153e3014dedf7b059d) | Claude | Add an overview picture to the wood docs | да |
| [`a88175c`](https://github.com/depthd/nimbleintheforest/commit/a88175c7c9dc6250cac7ca11a31b75a40beef1c4) | Claude | Don't place a piece through the player | да |
| [`3e66c80`](https://github.com/depthd/nimbleintheforest/commit/3e66c80fd20faa593712dac5bac547e8322a8052) | Claude | Make boulders and rock pillars visible again with world snow | да |
| [`22454c3`](https://github.com/depthd/nimbleintheforest/commit/22454c34d738a578f379b3bde7137d100b3fae3e) | Claude | Add cliffs welded into the terrain, with a laboratory at ?cliffs=1 | да |
| [`efc1ea5`](https://github.com/depthd/nimbleintheforest/commit/efc1ea5a6e279569408352580d96f2e8e4978116) | Claude | Dress steep mountain slopes in rock and stream rock by tile | да |
| [`3f3c78c`](https://github.com/depthd/nimbleintheforest/commit/3f3c78cae76237e3f242a1752222a89aa2491e35) | Claude | Add caves: mouths at the foot of steep slopes, interiors behind a fade | да |
| [`3adca69`](https://github.com/depthd/nimbleintheforest/commit/3adca6969935ea5abcbd881e843aa15bb4e698a0) | Claude | Measure the cave flashlight check in linear colour | да |
| [`a8fcef8`](https://github.com/depthd/nimbleintheforest/commit/a8fcef8f3002b4df93074668997586bd61e9e991) | depthd | Mountains in rock, cliffs and caves | да |
| [`5389330`](https://github.com/depthd/nimbleintheforest/commit/538933003c25f6efe216774a4a95853613fb57db) | Claude | Merge mountains, cliffs and caves into wood and structures | да |
| [`450184d`](https://github.com/depthd/nimbleintheforest/commit/450184d87c070b45bb1f069d6d641db5588e7bf4) | Claude | Keep the frame rate up with destructible structures | нет — восстановлен слиянием |
| [`0463253`](https://github.com/depthd/nimbleintheforest/commit/0463253b90c6b71074d29d962aa5a5ffdbf7e6c6) | depthd | Add solitary human corpses with clothing pockets and scattered equipment | да |
| [`bbe7e4a`](https://github.com/depthd/nimbleintheforest/commit/bbe7e4aad8256f6a1e8eba4af111c3f402fe692d) | Alexey | Reduce corpse draw calls and stream terrain meshes off the main thread | да |

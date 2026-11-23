# Журнал действий и команд

Здесь команды проверки и настройки, восстановленные по коммитам, скриптам и сохранённым выводам. Полная стенограмма сессии не сохранялась. Времена в [таблице коммитов](05-source/commits.tsv) указаны с часовым поясом. Список изменённых файлов для каждого коммита доступен в [commits-files.txt](05-source/commits-files.txt). Имена `/tmp` и номера портов относятся к среде, в которой проводился прогон.

## База и поручения

- Базовый SHA `f79fcb78595ee1d56df6854ccbe352d112a75649`. Отдельные worktree для каждого владельца и общая интеграция. Ярусы и входы велись вместе.
- [Точные задания и критерии](03-slice/briefs/) и [входные файлы чата](01-assignment/). Решения про канат и мост сохранены отдельно. [Проходы](03-slice/passages/DECISION.md) · [Мост](03-slice/bridges/DECISION.md)
- Рабочее сравнение шло по неизменной камере у подъёма. До разработки снят `original-0-42.png`. Проверка базового кадра повторена на финальной версии. [Материалы исходной камеры](03-slice/integration/baseline/)

## Сборка и проверка исходников

Из корня интеграционной ветки выполнялись следующие команды. Переменная `SLICE_TERRAIN` задаёт общий источник для трасс проходов.

```sh
npm run build
npx tsc -p experiments/plateau/tsconfig.json
node scripts/repo-check.mjs --base f79fcb7
git diff --check f79fcb7 HEAD
node experiments/plateau/mountain.test.cjs
node experiments/plateau/mountain-tiers.test.cjs
node experiments/plateau/wall-outcrop.test.cjs
node experiments/plateau/slice-wall-rounded.test.cjs
node experiments/plateau/slice-wall-angular.test.cjs
node experiments/plateau/slice-terrain.test.cjs
node experiments/plateau/slice-passages-rope.test.cjs
SLICE_TERRAIN="$PWD/experiments/plateau/slice-terrain.ts" node experiments/plateau/slice-passages.test.cjs
node experiments/plateau/slice-bridges.test.cjs
node docs/mountains-slice/integration/wall-intersections.cjs
```

[Сохранённые выводы и коды возврата](03-slice/local-tests/) · [Сводный build](05-source/mtn-buildlog.txt) · [Список веток](BRANCHES.tsv)

## Кадры и путь через две горы

Сборка была запущена со статического сервера. Для кадра сравнения использовали 800 × 450. После первого прохода скорректировали контроль теней и разделили снег на стенке и у основания. Пунктир проверяли несколькими камерами. В отдельном WebGL-тесте подтвердили влияние выборок 4×MSAA. После отклонённой пробы с глубинным смещением исправили опору под снежной гранью, повторили съёмку и проход.

```sh
npm run dev -- --host 127.0.0.1 --port 5184
node docs/mountains-slice/integration/capture-walls.cjs variants /tmp/wall-captures http://127.0.0.1:5184
node docs/mountains-slice/integration/benchmark-walls.cjs http://127.0.0.1:5184 /tmp/wall-timing.json
node docs/mountains-slice/integration/wall-controls.cjs http://127.0.0.1:5184 /tmp/wall-controls.json
node docs/mountains-slice/integration/walk-route.cjs 'http://127.0.0.1:5184/experiments/plateau/route.html?qa=1&seed=42&wall=rounded' /tmp/walk-42
```

В автоматизированной прогулке Playwright нажимал клавиши и через диагностический интерфейс продвигал физические такты. Сиды 7, 8191 и 23011 проверялись тем же скриптом. Полные трассы и кадры находятся в [FRAMES.md](FRAMES.md). В [проверке реального времени](03-slice/integration/realtime/) использованы обычные мышь, клавиатура и события указателя. Сопоставление внешних пикселей и результаты сцены с отключёнными тенями сохранены в [outside-wall.json](03-slice/wall-rounded/outside-wall.json).

## GitHub Pages

На `fe4277c96426aeaa09c0ddbd208ade1d7b33f2ab` сначала локально проверены управление и четыре старта. Затем существующий workflow на GitHub собрал тест с этим SHA. Основной артефакт был взят из первоначальной публикации и побайтно сравнен с живой версией. В GitHub Pages изменился каталог теста.

```sh
BUILD_CHANNEL=test npm run build
npm run test:statics
npm run test:resting
gh workflow run test-pages.yml --repo depthd/nimbleintheforest --ref claude/friendly-archimedes-onmybq -f sha=fe4277c96426aeaa09c0ddbd208ade1d7b33f2ab
gh run view 45170497798 --repo depthd/nimbleintheforest
node mtn-pages-browser.cjs https://depthd.github.io/nimbleintheforest/test/
```

[Браузерный скрипт страницы](06-pages/evidence/mtn-pages-browser.cjs) · [Вывод повторного запуска](06-pages/evidence/mtn-pages-live-browser.txt) · [Сведения о run](06-pages/evidence/github-actions.json) · [Точный патч Pages](05-source/pages.patch)

## Ветки и материалы

Все исходные ветки опубликованы по их прежним SHA. Ветка разбора создана прямо от `f79fcb7` и содержит отчёт, сохранённые кадры, логи, параметры и патчи, пригодные для чтения из Git. Сжатые сборки, зависимости и видео в её новых файлах отсутствуют. [Ветки для выборочной загрузки](BRANCHES.tsv)

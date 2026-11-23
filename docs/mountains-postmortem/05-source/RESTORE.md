# Восстановление из Git

В существующем клоне Nimble in the Forest получите исходную ветку с базой и укажите абсолютный путь к скачанному bundle.

```sh
git fetch origin refs/heads/task/PLATEAU-001-rock-masses
git bundle verify /your/path/mountains-history.bundle
git fetch /your/path/mountains-history.bundle 'refs/heads/*:refs/remotes/mountains-audit/*'
git worktree add --detach ../nimble-mountains-audit refs/remotes/mountains-audit/task/MOUNTAINS-PAGES-001-preview
```

В новом каталоге выберите одну из команд.

```sh
npm ci
npm run dev
npm run build
```

Интерактивная страница открывается по `/experiments/plateau/review.html`. Для проверки браузерных скриптов нужны Playwright и Chromium. Проект хранит их команды в отчётах по направлениям. Для работы без сети воспользуйтесь готовой сборкой в папке 06-pages.

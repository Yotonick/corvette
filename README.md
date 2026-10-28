# Corvette C5 — 3D-презентация

Тёмный интерактивный сайт на Three.js: появление машины из темноты, облёт по скроллу, красные фонари, зум в салон,
свободная камера. Без сборки и зависимостей — это обычные статические файлы.

## Запуск локально
Открывать `index.html` двойным кликом нельзя (браузер блокирует модули и загрузку модели с `file://`). Нужен любой локальный сервер:

```bash
python -m http.server 8000
# затем открыть http://localhost:8000
```

## Выкладка на GitHub Pages
1. Создай репозиторий на GitHub и залей в него **содержимое этой папки** (файл `index.html` должен лежать в корне).
2. `Settings → Pages → Build and deployment → Source: Deploy from a branch`, ветка `main`, папка `/ (root)`.
3. Через минуту сайт появится по адресу `https://<твой-ник>.github.io/<репозиторий>/`.

Файл `.nojekyll` уже есть, он нужен, чтобы Pages не трогал папки `vendor/` и `fonts/`.

## Структура
- `index.html`, `css/style.css`, `js/main.js` — сайт
- `models/corvette_c5.glb` — модель
- `vendor/` — Three.js r160 и нужные дополнения (лежат локально, интернет не нужен)
- `fonts/` — Oswald и IBM Plex Mono (кириллица + латиница)

## Отладка
- `?skip=1` — пропустить интро
- `?p=0.5` — зафиксировать кадр по прогрессу (0…1)
- `?lowres=1` — ниже разрешение (для слабых машин)

## Лицензии и атрибуция
- Модель: **Chevrolet Corvette C5 (Black)** — Randomness, лицензия **CC BY 4.0**
  (https://sketchfab.com/3d-models/chevrolet-corvette-c5-black-604ffcf3bb544ae9b653e8cfc1fae87a).
  Ссылка на автора выведена внизу сайта — её нужно оставить, этого требует лицензия.
- Three.js — MIT (`vendor/LICENSE-three`); шрифты Oswald и IBM Plex Mono — SIL OFL.

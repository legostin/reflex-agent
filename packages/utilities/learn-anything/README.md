# 🎓 Изучи что угодно

Универсальный AI-наставник. Введи тему → агент задаёт 2-4 уточняющих вопроса (про уровень, цель, время, формат) → собирает программу 5-9 модулей → каждый модуль с длинной статьёй, видео, иллюстрациями, схемами (mermaid), тестом, домашкой и интерактивным тренажёром на canvas.

## Возможности

- **Wizard в агентном режиме** — вопросы НЕ хардкоженные, агент сам решает что важно спросить под конкретную тему. «Хочу научиться рисовать акварелью» и «Хочу выучить Python» приведут к разным вопросам.
- **Программа курса** — генерируется с целями и оценкой времени.
- **Модуль = статья 800-2000 слов** + видео (YouTube) + ссылки на источники + изображения (CC) + mermaid-схемы + 3-5 домашних заданий.
- **Тест** — 5-7 multiple-choice вопросов сгенерированных из статьи, мгновенная проверка с объяснениями.
- **Прогресс** — отметка пройденности + результат теста, сохраняется в KB.
- **Объяснить выделенное** — выдели любой кусок статьи → агент даст подробное объяснение с примерами.
- **Тренажёр** — агент пишет standalone HTML/JS/canvas под идею (или сам предложит идею), Reflex рендерит в sandboxed iframe.

## KB-схемы

- `course` — корень курса: `meta.courseId`, `meta.topic`, `meta.modules` (JSON), `meta.progress` (JSON), `meta.wizardAnswers` (JSON), `meta.createdAt`.
- `course-module` — материал модуля: `meta.courseId`, `meta.moduleId`, JSON-поля `videos`/`links`/`images`/`diagrams`/`homework`, body = статья.
- `course-trainer` — HTML тренажёра в `meta.html` (capped ≈60KB).
- `course-note` — пользовательские заметки в модуле (опц., пока не используется).

## Server actions

- `tutorAsk({topic, history, forceFinish?})` — следующий вопрос wizard или `{done:true}`.
- `generateOutline({topic, history})` — программа курса + сохранение KB.
- `buildModule({courseId, moduleId, moduleTitle, moduleObjective, topic})` — материал модуля.
- `generateQuiz({moduleTitle, moduleObjective, article})` — тест.
- `explainSelection({selection, context, topic, moduleTitle})` — глубокое объяснение фрагмента.
- `generateTrainer({courseId, moduleId, moduleTitle, moduleObjective, prompt?})` — HTML тренажёр.
- `refreshCourseCard()` — обновление dashboard-карточки (число активных курсов + средний прогресс).

## Разрешения

`llm.chat/quick`, `kb.read/write` для своих kinds, `fs.sandbox` (для будущего кэша), `web.fetch` с whitelist (wikipedia, mdn, youtube, ...), `web.search`, `audit.write`, `workers.enabled`, `agent.invoke`.

## Ограничения v0.1

- Картинки не качаются локально (используются URL'ы CC-источников); подписаны в whitelist.
- Mermaid-схемы рендерятся как code-block; embed-рендер придёт в v0.2.
- Тренажёры в `srcdoc` iframe — без доступа к host RPC (только клиентский JS+canvas).
- Прогресс хранится в frontmatter курса; кэш на mtime ещё не оптимизирован.

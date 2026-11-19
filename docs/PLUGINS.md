# Плагины Gridpost

Плагин добавляет площадку без пересборки ядра. Он живёт в отдельной папке и состоит из двух файлов:

```
my-network/
  manifest.json
  adapter.mjs
```

Плагины ищутся в двух местах:

- **bundled** — `<resources>/plugins` (поставляются с приложением);
- **user** — `%APPDATA%/gridpost/plugins` (ваши плагины, открывается кнопкой «папка» в настройках).

## manifest.json

```json
{
  "id": "my-network",
  "name": "My Network",
  "version": "1.0.0",
  "description": "Короткое описание",
  "platform": "my-network",
  "main": "adapter.mjs",
  "color": "#8b93a7"
}
```

`id` обязан быть уникальным и используется как `account.platform`. `main` — ESM-файл (`.mjs`).

## adapter.mjs

```js
export default {
  // лимиты для редактора и preflight медиа
  capabilities: {
    maxChars: 1900,
    media: { maxCount: 4, maxBytes: 8 * 1024 * 1024, mime: ['image/*'] },
    threads: false,
    nativeScheduling: false,
    formatting: 'Markdown'
  },

  // поля, которые появятся в мастере добавления аккаунта
  credentialFields: [
    { key: 'token', label: 'API token', secret: true, required: true, hint: 'Где взять токен' }
  ],

  // необязательно: страница входа для WebView-режима
  loginUrl: 'https://example.com/login',
  sessionCookies: ['session_id'],

  // необязательно: проверка ключей (кнопка «Проверить»)
  async authenticate(credentials, ctx) {
    return { ok: true, message: 'подключено' }
  },

  // обязательно
  async publish(input, ctx) {
    // input.account        — аккаунт (credentials, lang, proxy, partition)
    // input.thread[]       — посты ветки { id, text, mediaIds }
    // input.media[]        — все медиа записи
    // input.mediaByPost[i] — уже сжатые под лимиты файлы для i-го поста
    //                        { id, buffer, mime, name, alt }
    // input.scheduledAt    — timestamp, если задано расписание
    const res = await ctx.fetch('https://api.example.com/post', {
      method: 'POST',
      headers: { authorization: `Bearer ${input.account.credentials.token}` },
      body: JSON.stringify({ text: input.thread[0].text })
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    // nativeScheduling: true — площадка сама держит расписание
    return { remoteId: data.id, url: data.url }
  },

  // необязательно: метрики для вкладки «Пульс»
  async fetchStats(account, remoteId, ctx) {
    return { likes: 0, replies: 0, views: 0 }
  }
}
```

### Контекст

`ctx.fetch` — `fetch`, привязанный к сессии аккаунта: cookies этого профиля и его прокси применяются автоматически.
`ctx.log(message)` пишет строку в журнал приложения.

### Возврат из `publish`

| Поле | Назначение |
| --- | --- |
| `url` | ссылка на опубликованный пост (появляется в очереди и «Пульсе») |
| `remoteId` | идентификатор поста на площадке (нужен для `fetchStats`) |
| `nativeScheduling` | `true`, если расписание принято площадкой |

Ошибки: бросьте `Error` с человекочитаемым текстом — он покажется в очереди рядом с аккаунтом.

### Ограничения

- Плагин исполняется в main-процессе без песочницы. Устанавливайте только доверенный код.
- При изменении файлов нажмите «перезагрузить» в настройках или перезапустите приложение.
- `capabilities.media.maxCount` ограничивает число файлов, передаваемых в `mediaByPost`.

## Пресеты и конфиги

Аккаунты, пресеты, алиасы и настройки хранятся в зашифрованном файле `gridpost.store`. Отдельные пресеты алиасов
можно распространять как JSON-фрагмент `aliases` — формат совпадает с полем в хранилище:

```json
[
  { "id": "alias_1", "token": "lead", "values": { "x": "@alex_x", "telegram": "@alex_tg" } }
]
```

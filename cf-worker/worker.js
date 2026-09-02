/**
 * Cloudflare Worker: Reverse Proxy для Telegram Bot API
 * 
 * 100% бесплатный, надежный и быстрый способ работы Telegram-бота с любого сервера в РФ.
 * Запросы идут: Сервер в РФ -> Cloudflare Worker -> api.telegram.org -> Cloudflare Worker -> Сервер в РФ
 * 
 * Инструкция по созданию (занимает 2 минуты):
 * 1. Зайдите на https://dash.cloudflare.com (бесплатная регистрация, карта не нужна).
 * 2. В меню слева выберите "Workers & Pages" -> "Create application" -> "Create Worker".
 * 3. Нажмите "Deploy".
 * 4. Нажмите "Edit code", вставьте этот скрипт и нажмите "Deploy".
 * 5. Скопируйте адрес вашего воркера (например: https://my-tg-proxy.ivan.workers.dev).
 * 6. В файле .env укажите:
 *    TELEGRAM_API_URL=https://my-tg-proxy.ivan.workers.dev/bot
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Заменяем хост на api.telegram.org
    const targetUrl = new URL("https://api.telegram.org" + url.pathname + url.search);

    // Копируем заголовки, убирая CF-специфичные
    const newHeaders = new Headers(request.headers);
    newHeaders.set("Host", "api.telegram.org");

    // Формируем прокси-запрос
    const proxyRequest = new Request(targetUrl, {
      method: request.method,
      headers: newHeaders,
      body: request.body,
      redirect: "follow",
    });

    try {
      const response = await fetch(proxyRequest);

      // Добавляем CORS-заголовки для совместимости
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      responseHeaders.set("Access-Control-Allow-Headers", "*");

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};

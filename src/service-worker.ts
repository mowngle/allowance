/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener('install', () => {
  sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(sw.clients.claim());
});

sw.addEventListener('push', (event: PushEvent) => {
  let payload: { title?: string; body?: string; url?: string; tag?: string } = {};
  try {
    if (event.data) payload = event.data.json();
  } catch {
    if (event.data) payload = { body: event.data.text() };
  }

  const title = payload.title ?? 'Allowance';
  const options: NotificationOptions = {
    body: payload.body ?? '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    tag: payload.tag ?? 'allowance',
    data: { url: payload.url ?? '/' },
  };
  event.waitUntil(sw.registration.showNotification(title, options));
});

sw.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? '/';
  event.waitUntil(
    sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) {
          c.navigate(url);
          return (c as WindowClient).focus();
        }
      }
      return sw.clients.openWindow(url);
    })
  );
});

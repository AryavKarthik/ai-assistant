self.addEventListener("push", (event) => {
  let payload = {
    title: "Reminder",
    body: "You have a due reminder.",
    url: "/reminders",
    type: "reminder",
  };

  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      // use defaults
    }
  }

  const tag =
    payload.notificationId && payload.type
      ? `${payload.type}-${payload.notificationId}`
      : payload.type || "assistant-notification";

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/favicon.ico",
      tag,
      data: {
        url: payload.url ?? "/reminders",
        type: payload.type,
        notificationId: payload.notificationId,
      },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/reminders";
  event.waitUntil(self.clients.openWindow(url));
});

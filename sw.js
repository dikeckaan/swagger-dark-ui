'use strict';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('sdui-') === 0; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () {
    return self.registration.unregister();
  }).then(function () {
    return self.clients.matchAll({ type: 'window' });
  }).then(function (clients) {
    clients.forEach(function (c) { c.navigate(c.url); });
  }));
});

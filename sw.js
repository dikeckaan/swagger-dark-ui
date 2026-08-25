/* Swagger Dark UI — service worker.
   Precaches the app shell so the installed app works fully offline from the
   first visit, then serves same-origin requests stale-while-revalidate:
   cached copies respond instantly and refresh in the background, so a new
   deployment is picked up on the following load without version juggling.
   Cross-origin requests (the live Petstore, user "Load URL" fetches) go
   straight to the network. */
'use strict';

var CACHE = 'sdui-v2'; // bumped: new logo/icons

var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/theme.css',
  './js/app.js',
  './js/validate.js',
  './js/snippets.js',
  './js/constraints.js',
  './js/findbar.js',
  './js/guide.js',
  './js/opsearch.js',
  './js/autocomplete.js',
  './js/quickfix.js',
  './js/convert20.js',
  './js/history.js',
  './js/export.js',
  './js/mock.js',
  './js/postman.js',
  './vendor/swagger-ui.css',
  './vendor/swagger-ui-bundle.js',
  './vendor/codemirror.min.css',
  './vendor/codemirror.min.js',
  './vendor/yaml.min.js',
  './vendor/show-hint.min.js',
  './vendor/show-hint.min.css',
  './vendor/searchcursor.min.js',
  './vendor/js-yaml.min.js',
  './vendor/lz-string.min.js',
  './specs/demo-api.yaml',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        return key === CACHE ? null : caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Petstore / Load URL: network only

  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(request).then(function (cached) {
        var refresh = fetch(request).then(function (response) {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        }).catch(function () {
          return cached; // offline and not cached before: fail like the network
        });
        return cached || refresh;
      });
    })
  );
});

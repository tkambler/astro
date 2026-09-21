import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare let self: ServiceWorkerGlobalScope
self.skipWaiting()
clientsClaim()
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.matchAll({ type: 'window' }).then(clients => Promise.all(
    clients.map(client => 'navigate' in client ? (client as WindowClient).navigate(client.url) : Promise.resolve(null)),
  )).then(() => undefined))
})
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }))

# HTMX SPA

A proof-of-concept single-page app using [HTMX](https://htmx.org) and [service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API).

Everything is in a single file [`sw.js`](/sw.js) because Firefox doesn't support ES modules in service workers. It's split up into three sections:

1. A vendored copy of [IDB Keyval](https://github.com/jakearchibald/idb-keyval) because the IndexedDB API is annoying
2. A mini "framework" with routing and templating functions
3. The actual app logic and templates

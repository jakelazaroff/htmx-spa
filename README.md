# HTMX SPA

A proof-of-concept single-page app using [HTMX](https://htmx.org) and [service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API).

The "server" logic and HTML templates are mostly in [`sw.js`](/sw.js). Routing and templating functions are in [`spsw.js`](/spsw.js).

[IDB Keyval](https://github.com/jakearchibald/idb-keyval) is vendored in [`idb.js`](/idb.js) to wrap IndexedDB, which has an annoying API.

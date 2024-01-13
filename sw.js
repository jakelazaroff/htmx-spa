/* - - - IDB-KEYVAL - - - */

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    // @ts-ignore - file size hacks
    request.oncomplete = request.onsuccess = () => resolve(request.result);
    // @ts-ignore - file size hacks
    request.onabort = request.onerror = () => reject(request.error);
  });
}
function createStore(dbName, storeName) {
  const request = indexedDB.open(dbName);
  request.onupgradeneeded = () => request.result.createObjectStore(storeName);
  const dbp = promisifyRequest(request);
  return (txMode, callback) =>
    dbp.then(db => callback(db.transaction(storeName, txMode).objectStore(storeName)));
}
let defaultGetStoreFunc;
function defaultGetStore() {
  if (!defaultGetStoreFunc) {
    defaultGetStoreFunc = createStore("keyval-store", "keyval");
  }
  return defaultGetStoreFunc;
}
/**
 * Get a value by its key.
 *
 * @param key
 * @param customStore Method to get a custom store. Use with caution (see the docs).
 */
function get(key, customStore = defaultGetStore()) {
  return customStore("readonly", store => promisifyRequest(store.get(key)));
}
/**
 * Set a value with a key.
 *
 * @param key
 * @param value
 * @param customStore Method to get a custom store. Use with caution (see the docs).
 */
function set(key, value, customStore = defaultGetStore()) {
  return customStore("readwrite", store => {
    store.put(value, key);
    return promisifyRequest(store.transaction);
  });
}
/**
 * Set multiple values at once. This is faster than calling set() multiple times.
 * It's also atomic – if one of the pairs can't be added, none will be added.
 *
 * @param entries Array of entries, where each entry is an array of `[key, value]`.
 * @param customStore Method to get a custom store. Use with caution (see the docs).
 */
function setMany(entries, customStore = defaultGetStore()) {
  return customStore("readwrite", store => {
    entries.forEach(entry => store.put(entry[1], entry[0]));
    return promisifyRequest(store.transaction);
  });
}
/**
 * Get multiple values by their keys
 *
 * @param keys
 * @param customStore Method to get a custom store. Use with caution (see the docs).
 */
function getMany(keys, customStore = defaultGetStore()) {
  return customStore("readonly", store =>
    Promise.all(keys.map(key => promisifyRequest(store.get(key))))
  );
}
/**
 * Update a value. This lets you see the old value and update it as an atomic operation.
 *
 * @param key
 * @param updater A callback that takes the old value and returns a new value.
 * @param customStore Method to get a custom store. Use with caution (see the docs).
 */
function update(key, updater, customStore = defaultGetStore()) {
  return customStore(
    "readwrite",
    store =>
      // Need to create the promise manually.
      // If I try to chain promises, the transaction closes in browsers
      // that use a promise polyfill (IE10/11).
      new Promise((resolve, reject) => {
        store.get(key).onsuccess = function () {
          try {
            store.put(updater(this.result), key);
            resolve(promisifyRequest(store.transaction));
          } catch (err) {
            reject(err);
          }
        };
      })
  );
}
/**
 * Delete a particular key from the store.
 *
 * @param key
 * @param customStore Method to get a custom store. Use with caution (see the docs).
 */
function del(key, customStore = defaultGetStore()) {
  return customStore("readwrite", store => {
    store.delete(key);
    return promisifyRequest(store.transaction);
  });
}
/**
 * Delete multiple keys at once.
 *
 * @param keys List of keys to delete.
 * @param customStore Method to get a custom store. Use with caution (see the docs).
 */
function delMany(keys, customStore = defaultGetStore()) {
  return customStore("readwrite", store => {
    keys.forEach(key => store.delete(key));
    return promisifyRequest(store.transaction);
  });
}
/**
 * Clear all values in the store.
 *
 * @param customStore Method to get a custom store. Use with caution (see the docs).
 */
function clear(customStore = defaultGetStore()) {
  return customStore("readwrite", store => {
    store.clear();
    return promisifyRequest(store.transaction);
  });
}
function eachCursor(store, callback) {
  store.openCursor().onsuccess = function () {
    if (!this.result) return;
    callback(this.result);
    this.result.continue();
  };
  return promisifyRequest(store.transaction);
}
/**
 * Get all keys in the store.
 *
 * @param customStore Method to get a custom store. Use with caution (see the docs).
 */
function keys(customStore = defaultGetStore()) {
  return customStore("readonly", store => {
    // Fast path for modern browsers
    if (store.getAllKeys) {
      return promisifyRequest(store.getAllKeys());
    }
    const items = [];
    return eachCursor(store, cursor => items.push(cursor.key)).then(() => items);
  });
}
/**
 * Get all values in the store.
 *
 * @param customStore Method to get a custom store. Use with caution (see the docs).
 */
function values(customStore = defaultGetStore()) {
  return customStore("readonly", store => {
    // Fast path for modern browsers
    if (store.getAll) {
      return promisifyRequest(store.getAll());
    }
    const items = [];
    return eachCursor(store, cursor => items.push(cursor.value)).then(() => items);
  });
}
/**
 * Get all entries in the store. Each entry is an array of `[key, value]`.
 *
 * @param customStore Method to get a custom store. Use with caution (see the docs).
 */
function entries(customStore = defaultGetStore()) {
  return customStore("readonly", store => {
    // Fast path for modern browsers
    // (although, hopefully we'll get a simpler path some day)
    if (store.getAll && store.getAllKeys) {
      return Promise.all([
        promisifyRequest(store.getAllKeys()),
        promisifyRequest(store.getAll()),
      ]).then(([keys, values]) => keys.map((key, i) => [key, values[i]]));
    }
    const items = [];
    return customStore("readonly", store =>
      eachCursor(store, cursor => items.push([cursor.key, cursor.value])).then(() => items)
    );
  });
}

/* - - - SPA "FRAMEWORK" - - - */

/** @typedef {"OPTIONS" | "HEAD" | "POST" | "GET" | "PUT" | "PATCH" | "DELETE"} Method */
/** @typedef {(request: Request, { params: Record<string, string>; body: Record<string, string>, query: Record<string, string> }) => Promise<Response>} Handler */

/**
 * @typedef {Object} SPAOptions
 * @property {string} [version]
 * @property {string[]} [cache]
 * @property {boolean} [debug]
 */

class SPA {
  #debug = false;
  #version = "1";

  /** @type {Array<[Method, URLPattern, Handler]>} */
  #routes = [];

  /** @param {SPAOptions} options */
  constructor(options = {}) {
    this.#debug = options.debug ?? this.#debug;
    this.#version = options.version ?? this.#version;

    self.addEventListener("install", evt => {
      console.log(`${this.#version} installing...`);
      self.skipWaiting();

      if (options.cache)
        evt.waitUntil(caches.open(this.#version).then(cache => cache.addAll(options.cache)));
    });

    self.addEventListener("activate", evt => {
      const cleanup = caches
        .keys()
        .then(keys => keys.filter(key => key !== this.#version))
        .then(keys => keys.map(key => caches.delete(key)))
        .then(promises => Promise.all(promises));

      evt.waitUntil(Promise.all([cleanup, clients.claim()]));
    });

    self.addEventListener("fetch", evt => {
      evt.respondWith(this.match(evt.request));
    });
  }

  /** @param {Request} request */
  async match(request) {
    const url = new URL(request.url);
    if (this.#debug) console.log(`[${request.method}] ${url.pathname}`);

    for (const [method, pattern, handler] of this.#routes) {
      if (request.method !== method) continue;

      const params = pattern.exec(url.pathname)?.pathname.groups;
      if (!params) continue;

      let body = {};
      try {
        if (request.body) body = await readableStreamToJSON(request.body);
      } catch (err) {
        console.warn("Couldn't parse request body as JSON", err);
      }

      const query = Object.fromEntries(url.searchParams.entries());

      return handler(request, { params, body, query });
    }

    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;

    return new Response(null, { status: 404 });
  }

  /**
   * @param {string} path
   * @param {Handler} handler
   */
  post(path, handler) {
    this.#routes.push(["POST", new URLPattern(path), handler]);
  }

  /**
   * @param {string} path
   * @param {Handler} handler
   */
  get(path, handler) {
    this.#routes.push(["GET", new URLPattern(path), handler]);
  }

  /**
   * @param {string} path
   * @param {Handler} handler
   */
  put(path, handler) {
    this.#routes.push(["PUT", new URLPattern(path), handler]);
  }

  /**
   * @param {string} path
   * @param {Handler} handler
   */
  delete(path, handler) {
    this.#routes.push(["DELETE", new URLPattern(path), handler]);
  }
}

/**
 * Returns a template string with the given values interpolated and some extra conveniences:
 * - Arrays are joined with newlines
 * - `false` and `null` are converted to empty strings
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 */
function html(strings, ...values) {
  const substitutions = values.map(value =>
    Array.isArray(value) ? value.join("\n") : HTML_OMIT.has(value) ? "" : value
  );
  return String.raw({ raw: strings }, ...substitutions);
}

const HTML_OMIT = new Set([false, null, undefined]);

class URLPattern {
  #parts = "";

  /** @param {string} pattern */
  constructor(pattern) {
    this.#parts = pattern.split("/");
  }

  /** @param {string} path */
  exec(path) {
    const pathParts = path.split("/");
    if (this.#parts.length !== pathParts.length) return null;

    /** @type {[string, string][]} */
    const parts = this.#parts.map((part, i) => [part, pathParts[i]]);

    /** @type {Record<string, string>} */
    const groups = {};

    for (const [pattern, path] of parts) {
      if (pattern.startsWith(":")) groups[pattern.slice(1)] = decodeURIComponent(path);
      else if (pattern !== path) return null;
    }

    return { pathname: { groups } };
  }
}

/** @param {ReadableStream} stream */
async function readableStreamToText(stream) {
  const decoder = new TextDecoderStream();
  const reader = stream.pipeThrough(decoder).getReader();

  /** @type {string[]} */
  let chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  return chunks.join("");
}

/**
 * Converts a URL-encoded parameter string to a JavaScript object.
 * @param {string} data
 */
function urlEncodedToJSON(data) {
  const entries = data
    .split("&")
    .filter(Boolean)
    .map(pair => {
      const [key, value] = pair.split("=");
      return [decodeURIComponent(key), decodeURIComponent(value.replace(/\+/g, " "))];
    });

  return Object.fromEntries(entries);
}

/** @param {ReadableStream} stream */
async function readableStreamToJSON(stream) {
  const text = await readableStreamToText(stream);
  return urlEncodedToJSON(text);
}

/* - - - APP CODE - - - */

const spa = new SPA({ cache: ["/", "/index.html", "/style.css", "/htmx.js", "/icons.svg"] });

async function setFilter(filter) {
  await set("filter", filter);
}

async function getFilter() {
  return get("filter");
}

async function listTodos() {
  const todos = (await get("todos")) || [];
  const filter = await getFilter();

  switch (filter) {
    case "done":
      return todos.filter(todo => todo.done);
    case "left":
      return todos.filter(todo => !todo.done);
    default:
      return todos;
  }
}

async function addTodo(text) {
  const id = crypto.randomUUID();
  await update("todos", (todos = []) => [...todos, { id, text, done: false }]);
}

async function getTodo(id) {
  const todos = await listTodos();
  return todos.find(todo => todo.id === id);
}

async function updateTodo(id, { text, done }) {
  await update("todos", (todos = []) =>
    todos.map(todo => {
      if (todo.id !== id) return todo;
      return { ...todo, text: text || todo.text, done: done ?? todo.done };
    })
  );
}

async function deleteTodo(id) {
  await update("todos", (todos = []) => todos.filter(todo => todo.id !== id));
}

function Icon({ name }) {
  return html`
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12">
      <use href="/icons.svg#${name}" />
    </svg>
  `;
}

function Todo({ id, text, done, editable }) {
  return html`
    <li class="todo">
      <input
        type="checkbox"
        name="done"
        value="true"
        hx-get="/todos/${id}/update"
        hx-vals="js:{done: event.target.checked}"
        ${done && "checked"}
      />
      ${editable
        ? html`<input
            type="text"
            name="text"
            value="${text}"
            hx-get="/todos/${id}/update"
            hx-trigger="change,blur"
            autofocus
          />`
        : html`<span
            class="preview"
            hx-get="/ui/todos/${id}?editable=true"
            hx-trigger="dblclick"
            hx-target="closest .todo"
            hx-swap="outerHTML"
          >
            ${text}
          </span>`}
      <button class="delete" hx-delete="/todos/${id}">${Icon({ name: "ex" })}</button>
    </li>
  `;
}

function App({ filter = "all", todos = [] } = {}) {
  return html`
    <div class="app">
      <header class="header">
        <h1>Todos</h1>
        <form class="filters" action="/ui">
          <label class="filter">
            All
            <input
              type="radio"
              name="filter"
              value="all"
              oninput="this.form.requestSubmit()"
              ${filter === "all" && "checked"}
            />
          </label>
          <label class="filter">
            Active
            <input
              type="radio"
              name="filter"
              value="left"
              oninput="this.form.requestSubmit()"
              ${filter === "left" && "checked"}
            />
          </label>
          <label class="filter">
            Completed
            <input
              type="radio"
              name="filter"
              value="done"
              oninput="this.form.requestSubmit()"
              ${filter === "done" && "checked"}
            />
          </label>
        </form>
      </header>
      <ul class="todos">
        ${todos.map(todo => Todo(todo))}
      </ul>
      <form class="submit" action="/todos/add" method="get">
        <input type="text" name="text" autofocus placeholder="What needs to be done?" />
      </form>
    </div>
  `.trim();
}

spa.get("/ui", async (_request, { query }) => {
  const { filter = "all" } = query;
  await setFilter(filter);

  const headers = {};
  if (filter === "all") headers["hx-replace-url"] = "/";
  else headers["hx-replace-url"] = "/?filter=" + filter;

  const html = App({ foo: `${await get("foo")}`, filter, todos: await listTodos() });
  return new Response(html, { headers });
});

spa.get("/ui/todos/:id", async (_request, { params, query }) => {
  const todo = await getTodo(params.id);
  if (!todo) return new Response("", { status: 404 });

  const editable = query.editable === "true";

  const html = Todo({ ...todo, editable });
  return new Response(html);
});

// needs to be a get because firefox doesn't seem to support request bodies
spa.get("/todos/add", async (_request, { query }) => {
  if (query.text) await addTodo(query.text);

  const html = App({ filter: await getFilter(), todos: await listTodos() });
  return new Response(html, {});
});

// needs to be a get because firefox doesn't seem to support request bodies
spa.get("/todos/:id/update", async (_request, { params, query }) => {
  const updates = {};
  if (query.text) updates.text = query.text;
  if (query.done) updates.done = query.done === "true";

  await updateTodo(params.id, updates);

  const html = App({ filter: await getFilter(), todos: await listTodos() });
  return new Response(html);
});

spa.delete("/todos/:id", async (_request, { params }) => {
  await deleteTodo(params.id);

  const html = App({ filter: await getFilter(), todos: await listTodos() });
  return new Response(html);
});

/** @typedef {"OPTIONS" | "HEAD" | "POST" | "GET" | "PUT" | "PATCH" | "DELETE"} Method */
/** @typedef {(request: Request, { params: Record<string, string>; body: Record<string, string>, query: Record<string, string> }) => Promise<Response>} Handler */

/**
 * @typedef {Object} SPAOptions
 * @property {string} [version]
 * @property {string[]} [cache]
 * @property {boolean} [debug]
 */

export default class SPA {
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
export function html(strings, ...values) {
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
async function readableStreamToJSON(stream) {
  const decoder = new TextDecoderStream();
  const reader = stream.pipeThrough(decoder).getReader();

  /** @type {string[]} */
  let chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  return urlEncodedToJSON(chunks.join(""));
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

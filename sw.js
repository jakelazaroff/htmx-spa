import SPA, { html } from "./spa.js";
import { set, get, update } from "./idb.js";

const spa = new SPA({ cache: ["/", "/index.html", "/style.css", "/htmx.js"] });

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
  update("todos", (todos = []) =>
    todos.map(todo => {
      if (todo.id !== id) return todo;
      return { ...todo, text: text || todo.text, done: done ?? todo.done };
    })
  );
}

async function deleteTodo(id) {
  update("todos", (todos = []) => todos.filter(todo => todo.id !== id));
}

function Todo({ id, text, done, editable }) {
  return html`
    <li class="todo">
      <input
        type="checkbox"
        name="done"
        value="true"
        hx-put="/todos/${id}"
        hx-vals="js:{done: event.target.checked}"
        ${done && "checked"}
      />
      ${editable
        ? html`<input
            type="text"
            name="text"
            value="${text}"
            hx-put="/todos/${id}"
            hx-trigger="change,blur"
            autofocus
          />`
        : html`<span
            hx-get="/ui/todos/${id}?editable=true"
            hx-trigger="dblclick"
            hx-target="closest .todo"
          >
            ${text}
          </span>`}
      <button hx-delete="/todos/${id}">x</button>
    </li>
  `;
}

function App({ filter = "all", todos = [] } = {}) {
  return html`
    <header class="header">
      <h1>Todos</h1>
      <form action="/ui">
        <label>
          All
          <input
            type="radio"
            name="filter"
            value="all"
            oninput="this.form.requestSubmit()"
            ${filter === "all" && "checked"}
          />
        </label>
        <label>
          Active
          <input
            type="radio"
            name="filter"
            value="done"
            oninput="this.form.requestSubmit()"
            ${filter === "done" && "checked"}
          />
        </label>
        <label>
          Completed
          <input
            type="radio"
            name="filter"
            value="left"
            oninput="this.form.requestSubmit()"
            ${filter === "left" && "checked"}
          />
        </label>
      </form>
    </header>
    <ul class="todos">
      ${todos.map(todo => Todo(todo))}
    </ul>
    <form action="/todos" method="post">
      <input name="text" autofocus placeholder="What needs to be done?" />
      <button>submit</button>
    </form>
  `;
}

spa.get("/ui", async (_request, { query }) => {
  const { filter = "all" } = query;
  await setFilter(filter);

  const headers = {};
  if (filter === "all") headers["hx-replace-url"] = "/";
  else headers["hx-replace-url"] = "/?filter=" + filter;

  const html = App({ filter, todos: await listTodos() });
  return new Response(html, { headers });
});

spa.get("/ui/todos/:id", async (_request, { params, query }) => {
  const todo = await getTodo(params.id);
  if (!todo) return new Response("", { status: 404 });

  const editable = query.editable === "true";

  const html = Todo({ ...todo, editable });
  return new Response(html);
});

spa.post("/todos", async (_request, { body }) => {
  if (body.text) await addTodo(body.text);

  const html = App({ filter: await getFilter(), todos: await listTodos() });
  return new Response(html);
});

spa.put("/todos/:id", async (_request, { params, body }) => {
  const updates = { text: body.text, done: body.done === "true" };
  await updateTodo(params.id, updates);

  const html = App({ filter: await getFilter(), todos: await listTodos() });
  return new Response(html);
});

spa.delete("/todos/:id", async (_request, { params }) => {
  await deleteTodo(params.id);

  const html = App({ filter: await getFilter(), todos: await listTodos() });
  return new Response(html);
});

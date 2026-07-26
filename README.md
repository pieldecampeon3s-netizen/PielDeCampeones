# Piel de Campeón — migración a Node

Carpeta madre del proyecto nuevo. Por ahora contiene **solo las vistas** migradas
desde el proyecto ASP.NET Core MVC (`Intento-777`), más el andamiaje mínimo para
poder verlas en el navegador.

La lógica de negocio (autenticación, órdenes, inventario) todavía **no** está
escrita: eso viene después, sobre Supabase.

## Arrancar

```bash
npm install
npm run dev        # http://localhost:3000
```

No necesita base de datos: las vistas se alimentan de `src/datos-demo.js`.

## Estructura

```
piel-de-campeon-node/
├── server.js              Rutas + datos de ejemplo. Andamiaje, no la app final.
├── src/
│   ├── datos-demo.js      Productos/categorías/usuarios falsos. Reemplazar por Supabase.
│   └── formato.js         formatCOP / formatNumero (reemplazan .ToString("C0") de Razor)
├── views/
│   ├── layouts/main.ejs   Equivale a _Layout.cshtml
│   ├── partials/          navbar, footer, product-card, product-list
│   ├── home/              index, sobre-nosotros, contactanos, privacidad, detalles
│   ├── catalogo/ carrito/ checkout/
│   ├── account/           login, registro, recuperar, restablecer…
│   ├── admin/ producto/ categoria/ usuario/
│   └── shared/error.ejs
├── public/                css, js, images, favicon (copiados de wwwroot)
└── supabase/schema.sql    Esquema traducido de los modelos EF Core (no ejecutado aún)
```

## Cómo se tradujo Razor a EJS

| Razor | EJS |
|---|---|
| `@Model.Nombre` | `<%= producto.nombre %>` |
| `@foreach (var x in Model)` | `<% (productos \|\| []).forEach(function (x) { %>` |
| `@if (...) { } else { }` | `<% if (...) { %> … <% } else { %> … <% } %>` |
| `asp-controller="Catalogo" asp-action="Index"` | `href="/catalogo"` |
| `asp-route-id="@x.Id"` | `href="/producto/<%= x.id %>"` |
| `@Model.Precio.ToString("C0")` | `<%= formatCOP(producto.precio) %>` |
| `@RenderBody()` | `<%- body %>` (express-ejs-layouts) |
| `@section Styles { }` | `<style>` en línea dentro de la página |
| `~/images/x.png` | `/images/x.png` |

Las propiedades pasaron de `PascalCase` a `camelCase`. **Si en Supabase usas
`snake_case` (recomendado), vas a necesitar un mapeo** entre la fila de la base y
el objeto que recibe la vista — o renombras los locals en las plantillas.

## Cambios respecto al original (no es copia literal)

1. **Bootstrap y Bootstrap Icons por CDN.** Ya no se copia `wwwroot/lib`. Se
   eliminó jQuery: solo lo usaba `script.js`, que era código muerto del proyecto
   anterior de repuestos y no se migró.
2. **Footer unificado.** Estaba duplicado en `Index` y `SobreNosotros` con estilos
   distintos; ahora es `partials/footer.ejs` y lo incluye el layout, así que
   aparece en todas las páginas.
3. **`placeholder.png` y `Default.jpeg` creados.** En el proyecto .NET no existían
   y eran el fallback de toda imagen de producto: por eso se veían rotas.
4. **`OrigninalEquipmentManufacture` → `oem`.** Venía mal escrito, y de dos formas
   distintas entre la entidad y el ViewModel.
5. **Antiforgery de ASP.NET eliminado.** Si necesitas protección CSRF en Express,
   hay que añadirla aparte; no es automática.
6. **Rutas AJAX renombradas** (`/Carrito/AddToCart` → `/carrito/agregar`, etc.).

## Lo que quedó igual y sigue siendo un problema

- **El checkout no guarda nada.** Sigue armando un mensaje de WhatsApp en
  JavaScript del navegador (`views/checkout/index.ejs`). Las tablas `ordenes` y
  `orden_detalles` están en el esquema pero nada las escribe. El total y los
  precios salen del DOM, o sea que son manipulables.
- **El carrito no valida stock** ni lo descuenta, y no se vacía tras la compra.
- **El input de cantidad del carrito no hace nada** — falta el endpoint.
- **`admin/index.ejs` muestra "5" categorías hardcodeado**, y órdenes/ventas en 0.
- **Faltan imágenes**: `client-1.jpg`, `client-2.jpg`, `client-3.jpg` y
  `about-us-hero.jpg`. Los `<img>` ya tienen `onerror` a placehold.co, así que no
  se rompen, pero conviene reemplazarlas.
- **El editor de contenido inline** (`/admin/contenido`) apunta a elementos
  `[data-key]` que no existen en el HTML. O se completa o se borra.

## Siguiente paso: Supabase

1. Crear el proyecto y ejecutar `supabase/schema.sql` en el SQL Editor.
2. `cp .env.example .env` y rellenar `SUPABASE_URL` y `SUPABASE_ANON_KEY`.
3. `npm i @supabase/supabase-js dotenv` y crear `src/supabase.js`.
4. Reemplazar `src/datos-demo.js` por consultas reales, respetando los nombres de
   propiedades que ya esperan las plantillas.
5. Auth con Supabase (sustituye a ASP.NET Identity) y rellenar el local `usuario`
   (`{ nombre, email, esAdmin }`) en el middleware de `server.js`.
6. Proteger `/admin/*` — hoy **cualquiera** entra, no hay comprobación de rol.

El esquema ya trae políticas RLS. No las desactives: con la `anon key` expuesta en
el navegador, son lo único que impide que cualquiera escriba en tus tablas.

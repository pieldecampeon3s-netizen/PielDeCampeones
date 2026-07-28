// Servidor mínimo para poder ver las vistas migradas.
// No es la app final: solo sirve las plantillas con datos de ejemplo mientras
// se conecta Supabase y se escribe la lógica de negocio real.

const path = require('path');
const express = require('express');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');

const datos = require('./src/datos-demo');
const formato = require('./src/formato');
const filtrosCatalogo = require('./src/filtros-catalogo');

const app = express();
const PUERTO = process.env.PORT || 3000;

// --- Configuración ----------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

app.use(express.static(path.join(__dirname, 'public'), {
  // El mime-types de esta version de Express no reconoce .avif y lo sirve
  // como application/octet-stream.
  setHeaders(res, filePath) {
    if (filePath.endsWith('.avif')) res.setHeader('Content-Type', 'image/avif');
  },
}));
// Librerías servidas desde el propio servidor en lugar de un CDN externo.
// En redes móviles donde cdn.jsdelivr.net / unpkg.com / fonts.googleapis.com
// no son alcanzables, la página se quedaba sin Bootstrap: sin menú plegable,
// sin toasts y con las listas mostrando viñetas. Sirviéndolas desde aquí la
// tienda no depende de que el cliente alcance servidores de terceros.
const libreria = (paquete, subcarpeta) =>
  express.static(path.join(__dirname, 'node_modules', paquete, subcarpeta), {
    maxAge: '30d', // llevan versión fija en package.json, se pueden cachear
  });

app.use('/vendor/bootstrap', libreria('bootstrap', 'dist'));
app.use('/vendor/bootstrap-icons', libreria('bootstrap-icons', 'font'));
app.use('/vendor/aos', libreria('aos', 'dist'));
app.use('/vendor/poppins', libreria('@fontsource/poppins', '.'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'cambiar-en-produccion',
    resave: false,
    saveUninitialized: true,
    cookie: { httpOnly: true, maxAge: 1000 * 60 * 30 },
  })
);

// Helpers y variables disponibles en todas las vistas
app.locals.formatCOP = formato.formatCOP;
app.locals.formatNumero = formato.formatNumero;

app.use((req, res, next) => {
  // Sin login todavía: cambia esto cuando conectes Supabase Auth.
  res.locals.usuario = req.session.usuario || null;
  res.locals.esAdmin = Boolean(req.session.usuario && req.session.usuario.esAdmin);
  res.locals.currentPath = req.path;
  // Disponible en todas las vistas para pintar el corazón lleno o vacío.
  res.locals.favoritos = req.session.favoritos || [];
  res.locals.errores = null;
  res.locals.title = 'Piel de Campeón';
  next();
});

// --- Favoritos en sesión ----------------------------------------------------
// Se guardan en la sesión, no en base de datos: funciona sin cuenta de usuario
// pero se pierden al cerrar el navegador. Cuando conectes Supabase Auth, esto
// pasa a una tabla `favoritos` ligada al usuario.
function obtenerFavoritos(req) {
  if (!req.session.favoritos) req.session.favoritos = [];
  return req.session.favoritos;
}

// --- Carrito en sesión ------------------------------------------------------
function obtenerCarrito(req) {
  if (!req.session.carrito) req.session.carrito = { items: [] };
  const carrito = req.session.carrito;
  carrito.total = carrito.items.reduce((acc, i) => acc + i.precio * i.cantidad, 0);
  carrito.items.forEach((i) => {
    i.subtotal = i.precio * i.cantidad;
  });
  return carrito;
}

// --- Páginas públicas -------------------------------------------------------
/*
  La portada ES la tienda: quien entra ve camisetas de inmediato, sin un paso
  intermedio. Debajo del catálogo, home/index.ejs mantiene las secciones de
  confianza (guía de tallas, marcas, testimonios).

  El mismo manejador sirve /catalogo por si algún día se quiere separar; hoy
  esa dirección redirige aquí para no tener la misma página en dos sitios.
*/
function mostrarTienda(req, res) {
  const catalogo = datos.listarProductos();

  const filtros = filtrosCatalogo.leerFiltros(req.query, catalogo);
  const rango = filtrosCatalogo.rangoPrecios(catalogo);
  const productos = filtrosCatalogo.aplicar(catalogo, filtros);

  const fichas = filtrosCatalogo.fichasActivas(filtros, rango, formato.formatCOP);
  const hayFiltros = filtrosCatalogo.hayFiltros(filtros, rango);

  // Solo el fragmento de resultados: es lo que pide catalogo.js al filtrar sin
  // recargar. Sin layout, porque se inyecta dentro de la página ya cargada.
  if (req.query.parcial) {
    return res.render(
      'partials/catalogo-resultados',
      { productos, fichas, hayFiltros, formatCOP: formato.formatCOP, layout: false },
      (err, html) => (err ? res.status(500).end() : res.type('html').send(html))
    );
  }

  res.render('home/index', {
    title: 'Piel de Campeón | Camisetas de fútbol originales y retro',
    estilos: ['/css/catalogo.css', '/css/tallas.css'],
    scripts: ['/js/catalogo.js'],
    productos,
    filtros,
    rango,
    fichas,
    hayFiltros,
    conteos: filtrosCatalogo.conteoPorCategoria(catalogo, filtros),
    etiquetasOrden: filtrosCatalogo.ETIQUETAS_ORDEN,
    filtrosActivos: fichas.length,
    // Solo categorías con productos: ofrecer una vacía es llevar a un callejón.
    todasLasCategorias: [...new Set(catalogo.map((p) => p.nombreCategoria))].sort((a, b) =>
      a.localeCompare(b, 'es')
    ),
  });
}

app.get('/', mostrarTienda);

app.get('/sobre-nosotros', (req, res) =>
  res.render('home/sobre-nosotros', { title: 'Sobre Nosotros' })
);

app.get('/contactanos', (req, res) =>
  res.render('home/contactanos', { title: 'Contáctanos' })
);

app.get('/privacidad', (req, res) =>
  res.render('home/privacidad', { title: 'Política de Privacidad' })
);

/*
  La tienda vive en la portada. /catalogo se mantiene porque hay enlaces
  antiguos apuntando ahí (y clientes que pueden tenerlo guardado), pero
  redirige para que la página tenga una sola dirección real.

  Es 302 (temporal) a propósito: un 301 lo cachean los navegadores de forma
  muy persistente y sería incómodo mientras el sitio está en desarrollo.
  Cámbialo a 301 cuando salga a producción.
*/
app.get('/catalogo', (req, res) => {
  const consulta = new URLSearchParams(req.query).toString();
  res.redirect(302, '/' + (consulta ? '?' + consulta : ''));
});

app.get('/producto/:id', (req, res, next) => {
  const producto = datos.buscarProducto(req.params.id);
  if (!producto) return next();
  res.render('producto/detalles', {
    title: producto.nombre,
    estilos: ['/css/tallas.css'],
    producto,
  });
});

// --- Carrito ----------------------------------------------------------------
app.get('/carrito', (req, res) =>
  res.render('carrito/index', { title: 'Mi Carrito de Compras', carrito: obtenerCarrito(req) })
);

// Una misma camiseta en dos tallas son dos líneas distintas del carrito, así
// que la identidad de una línea es producto + talla, no solo el producto.
const mismaLinea = (item, productoId, talla) =>
  item.productoId === productoId && (item.talla || '') === (talla || '');

app.post('/carrito/agregar', (req, res) => {
  const productoId = Number(req.body.productoId);
  const cantidad = Number(req.body.cantidad) || 1;
  const talla = String(req.body.talla || '').trim().toUpperCase();

  if (cantidad <= 0) {
    return res.json({ success: false, message: 'La cantidad debe ser mayor a cero.' });
  }

  const producto = datos.buscarProducto(productoId);
  if (!producto) return res.json({ success: false, message: 'Producto no encontrado.' });

  if (producto.stock <= 0) {
    return res.json({ success: false, message: 'Esta camiseta está agotada.' });
  }

  // Si el producto maneja tallas, elegir una es obligatorio: sin eso no se
  // sabe qué enviar. Y la talla pedida tiene que ser de las disponibles.
  const disponibles = producto.tallas || [];
  if (disponibles.length) {
    if (!talla) {
      return res.json({ success: false, message: 'Elige una talla antes de añadir al carrito.' });
    }
    if (!disponibles.includes(talla)) {
      return res.json({ success: false, message: `La talla ${talla} no está disponible.` });
    }
  }

  const carrito = obtenerCarrito(req);
  const existente = carrito.items.find((i) => mismaLinea(i, productoId, talla));
  if (existente) {
    existente.cantidad += cantidad;
  } else {
    carrito.items.push({
      productoId: producto.id,
      nombreProducto: producto.nombre,
      talla,
      cantidad,
      precio: producto.precio,
      imagenUrl: producto.imagenUrl,
    });
  }

  const actualizado = obtenerCarrito(req);
  res.json({
    success: true,
    message: talla ? `¡Añadida la talla ${talla} al carrito!` : '¡Producto añadido al carrito!',
    itemCount: actualizado.items.reduce((a, i) => a + i.cantidad, 0),
  });
});

app.post('/carrito/eliminar', (req, res) => {
  const productoId = Number(req.body.productoId);
  const talla = String(req.body.talla || '').trim().toUpperCase();

  const carrito = obtenerCarrito(req);
  carrito.items = carrito.items.filter((i) => !mismaLinea(i, productoId, talla));

  const actualizado = obtenerCarrito(req);
  res.json({
    success: true,
    message: 'Producto eliminado del carrito.',
    newTotal: formato.formatCOP(actualizado.total),
    itemCount: actualizado.items.reduce((a, i) => a + i.cantidad, 0),
    cartIsEmpty: actualizado.items.length === 0,
  });
});

// Cambiar la cantidad de una línea desde el carrito o el checkout.
app.post('/carrito/cantidad', (req, res) => {
  const productoId = Number(req.body.productoId);
  const talla = String(req.body.talla || '').trim().toUpperCase();
  const cantidad = Number(req.body.cantidad);

  const carrito = obtenerCarrito(req);
  const linea = carrito.items.find((i) => mismaLinea(i, productoId, talla));
  if (!linea) return res.json({ success: false, message: 'Esa línea ya no está en el carrito.' });

  if (cantidad <= 0) {
    carrito.items = carrito.items.filter((i) => !mismaLinea(i, productoId, talla));
  } else {
    linea.cantidad = cantidad;
  }

  const actualizado = obtenerCarrito(req);
  res.json({
    success: true,
    itemCount: actualizado.items.reduce((a, i) => a + i.cantidad, 0),
    total: formato.formatCOP(actualizado.total),
    cartIsEmpty: actualizado.items.length === 0,
  });
});

app.get('/carrito/contador', (req, res) => {
  const carrito = obtenerCarrito(req);
  res.json({ itemCount: carrito.items.reduce((a, i) => a + i.cantidad, 0) });
});

// --- Favoritos --------------------------------------------------------------
app.post('/favoritos/alternar', (req, res) => {
  const productoId = Number(req.body.productoId);
  if (!datos.buscarProducto(productoId)) {
    return res.json({ success: false, message: 'Producto no encontrado.' });
  }

  const favoritos = obtenerFavoritos(req);
  const posicion = favoritos.indexOf(productoId);
  const esFavorito = posicion === -1;

  if (esFavorito) favoritos.push(productoId);
  else favoritos.splice(posicion, 1);

  res.json({ success: true, esFavorito, total: favoritos.length });
});

app.get('/favoritos', (req, res) => {
  const favoritos = obtenerFavoritos(req);
  const productos = datos.listarProductos().filter((p) => favoritos.includes(p.id));

  res.render('catalogo/favoritos', {
    title: 'Mis Favoritos',
    // `pagina` deja que favoritos.js sepa que aquí, al quitar un corazón,
    // la tarjeta debe desaparecer de la lista.
    pagina: 'favoritos',
    estilos: ['/css/catalogo.css', '/css/tallas.css'],
    scripts: ['/js/catalogo.js'],
    productos,
    favoritos,
  });
});

// --- Checkout ---------------------------------------------------------------
app.get('/checkout', (req, res) => {
  const carrito = obtenerCarrito(req);
  if (!carrito.items.length) return res.redirect('/carrito');

  res.render('checkout/index', {
    title: 'Finalizar Compra',
    // Sin navbar ni footer: en el paso de pago, menos distracciones.
    soloContenido: true,
    estilos: ['/css/checkout.css'],
    scripts: ['/js/checkout.js'],
    carrito,
    // El número del negocio vive en el .env, no incrustado en el código.
    whatsapp: process.env.WHATSAPP_NUMERO || '573170237977',
  });
});

app.get('/checkout/confirmacion', (req, res) =>
  res.render('checkout/confirmacion', {
    title: 'Orden Confirmada',
    ordenId: req.query.ordenId || '—',
  })
);

// --- Cuenta (solo vistas; falta la autenticación real) ----------------------
const vistasCuenta = {
  '/account/login': ['account/login', 'Ingresar'],
  '/account/registro': ['account/registro', 'Registro'],
  '/account/recuperar': ['account/recuperar', 'Recuperar Contraseña'],
  '/account/recuperar/enviado': ['account/recuperar-enviado', 'Correo Enviado'],
  '/account/restablecer': ['account/restablecer', 'Restablecer Contraseña'],
  '/account/restablecer/listo': ['account/restablecer-listo', 'Contraseña Restablecida'],
};
for (const [ruta, [vista, titulo]] of Object.entries(vistasCuenta)) {
  // El login ya usa el layout (con `soloContenido`), así que se salta este
  // bucle: las demás vistas todavía traen su propio <html>.
  if (ruta === '/account/login') continue;
  app.get(ruta, (req, res) => res.render(vista, { title: titulo, layout: false }));
}

function mostrarLogin(req, res, extra = {}) {
  res.render('account/login', {
    title: 'Iniciar sesión',
    // Sin navbar ni pie: en el login no hay nada más que hacer.
    soloContenido: true,
    estilos: ['/css/login.css'],
    scripts: ['/js/login.js'],
    ...extra,
  });
}

app.get('/account/login', (req, res) => mostrarLogin(req, res));

/*
  Todavía no hay autenticación: no existe tabla de usuarios ni Supabase Auth.
  Sin esta ruta el botón "Ingresar" caía en la página de error 404, que es la
  peor forma de enterarse. Mientras tanto se devuelve el formulario con un
  aviso claro y el correo ya escrito.

  Cuando conectes Supabase Auth, este es el único sitio que hay que tocar.
*/
app.post('/account/login', (req, res) => {
  mostrarLogin(req, res, {
    aviso: 'El inicio de sesión todavía no está disponible. Puedes comprar sin cuenta: añade tus camisetas al carrito y finaliza el pedido por WhatsApp.',
    valores: { email: String(req.body.email || '') },
  });
});

app.get('/account/acceso-denegado', (req, res) =>
  res.render('account/acceso-denegado', { title: 'Acceso Denegado' })
);

app.post('/account/logout', (req, res) => {
  req.session.usuario = null;
  res.redirect('/');
});

// --- Administración (solo vistas; falta proteger con roles) -----------------
app.get('/admin', (req, res) =>
  res.render('admin/index', { title: 'Panel de Administración', dashboard: datos.resumenDashboard() })
);

app.get('/admin/productos', (req, res) =>
  res.render('producto/index', {
    title: 'Gestión de Inventario de Productos',
    productos: datos.listarProductos(),
  })
);

app.get('/admin/productos/crear', (req, res) =>
  res.render('producto/crear', {
    title: 'Crear Nuevo Producto',
    producto: {},
    categorias: datos.categorias,
  })
);

app.get('/admin/productos/editar/:id', (req, res, next) => {
  const producto = datos.buscarProducto(req.params.id);
  if (!producto) return next();
  res.render('producto/editar', { title: 'Editar Producto', producto, categorias: datos.categorias });
});

app.get('/admin/productos/eliminar/:id', (req, res, next) => {
  const producto = datos.buscarProducto(req.params.id);
  if (!producto) return next();
  res.render('producto/eliminar', { title: 'Eliminar Producto', producto });
});

app.get('/admin/categorias', (req, res) =>
  res.render('categoria/index', { title: 'Gestión de Categorías', categorias: datos.categorias })
);

app.get('/admin/categorias/crear', (req, res) =>
  res.render('categoria/crear', { title: 'Crear Categoría', categoria: {} })
);

app.get('/admin/categorias/editar/:id', (req, res, next) => {
  const categoria = datos.buscarCategoria(req.params.id);
  if (!categoria) return next();
  res.render('categoria/editar', { title: 'Editar Categoría', categoria });
});

app.get('/admin/categorias/eliminar/:id', (req, res, next) => {
  const categoria = datos.buscarCategoria(req.params.id);
  if (!categoria) return next();
  res.render('categoria/eliminar', { title: 'Eliminar Categoría', categoria });
});

app.get('/admin/usuarios', (req, res) =>
  res.render('usuario/index', { title: 'Gestión de Usuarios', usuarios: datos.usuarios })
);

// --- Errores ----------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('shared/error', {
    title: 'Página no encontrada',
    error: { requestId: null, showRequestId: false, mensaje: 'La página no existe.' },
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('shared/error', {
    title: 'Error',
    error: { requestId: null, showRequestId: false, mensaje: err.message },
  });
});

app.listen(PUERTO, () => {
  console.log(`Piel de Campeón escuchando en http://localhost:${PUERTO}`);
});

// Servidor mínimo para poder ver las vistas migradas.
// No es la app final: solo sirve las plantillas con datos de ejemplo mientras
// se conecta Supabase y se escribe la lógica de negocio real.

const path = require('path');
const express = require('express');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');

const datos = require('./src/datos-demo');
const formato = require('./src/formato');

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
  res.locals.errores = null;
  res.locals.title = 'Piel de Campeón';
  next();
});

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
app.get('/', (req, res) => {
  res.render('home/index', {
    title: 'Piel de Campeón | Siente la piel de un campeón',
    productosDestacados: datos.listarProductos().slice(0, 3),
  });
});

app.get('/sobre-nosotros', (req, res) =>
  res.render('home/sobre-nosotros', { title: 'Sobre Nosotros' })
);

app.get('/contactanos', (req, res) =>
  res.render('home/contactanos', { title: 'Contáctanos' })
);

app.get('/privacidad', (req, res) =>
  res.render('home/privacidad', { title: 'Política de Privacidad' })
);

app.get('/catalogo', (req, res) => {
  const { orden, categoria } = req.query;
  let productos = datos.listarProductos();

  if (categoria) {
    productos = productos.filter(
      (p) => (p.nombreCategoria || '').toLowerCase() === categoria.toLowerCase()
    );
  }

  const ordenadores = {
    'precio-asc': (a, b) => a.precio - b.precio,
    'precio-desc': (a, b) => b.precio - a.precio,
    'nombre-asc': (a, b) => a.nombre.localeCompare(b.nombre),
  };
  productos = [...productos].sort(ordenadores[orden] || ordenadores['nombre-asc']);

  res.render('catalogo/index', {
    title: 'Tienda - Piel de Campeón',
    productos,
    todasLasCategorias: [...new Set(datos.listarProductos().map((p) => p.nombreCategoria))].sort(),
    ordenActual: orden || '',
    categoriaActual: categoria || '',
  });
});

app.get('/producto/:id', (req, res, next) => {
  const producto = datos.buscarProducto(req.params.id);
  if (!producto) return next();
  res.render('producto/detalles', { title: producto.nombre, producto });
});

// --- Carrito ----------------------------------------------------------------
app.get('/carrito', (req, res) =>
  res.render('carrito/index', { title: 'Mi Carrito de Compras', carrito: obtenerCarrito(req) })
);

app.post('/carrito/agregar', (req, res) => {
  const productoId = Number(req.body.productoId);
  const cantidad = Number(req.body.cantidad) || 1;
  if (cantidad <= 0) {
    return res.json({ success: false, message: 'La cantidad debe ser mayor a cero.' });
  }

  const producto = datos.buscarProducto(productoId);
  if (!producto) return res.json({ success: false, message: 'Producto no encontrado.' });

  const carrito = obtenerCarrito(req);
  const existente = carrito.items.find((i) => i.productoId === productoId);
  if (existente) {
    existente.cantidad += cantidad;
  } else {
    carrito.items.push({
      productoId: producto.id,
      nombreProducto: producto.nombre,
      cantidad,
      precio: producto.precio,
      imagenUrl: producto.imagenUrl,
    });
  }

  const actualizado = obtenerCarrito(req);
  res.json({
    success: true,
    message: '¡Producto añadido al carrito!',
    itemCount: actualizado.items.reduce((a, i) => a + i.cantidad, 0),
  });
});

app.post('/carrito/eliminar', (req, res) => {
  const productoId = Number(req.body.productoId);
  const carrito = obtenerCarrito(req);
  carrito.items = carrito.items.filter((i) => i.productoId !== productoId);

  const actualizado = obtenerCarrito(req);
  res.json({
    success: true,
    message: 'Producto eliminado del carrito.',
    newTotal: formato.formatCOP(actualizado.total),
    itemCount: actualizado.items.reduce((a, i) => a + i.cantidad, 0),
    cartIsEmpty: actualizado.items.length === 0,
  });
});

app.get('/carrito/contador', (req, res) => {
  const carrito = obtenerCarrito(req);
  res.json({ itemCount: carrito.items.reduce((a, i) => a + i.cantidad, 0) });
});

// --- Checkout ---------------------------------------------------------------
app.get('/checkout', (req, res) => {
  const carrito = obtenerCarrito(req);
  if (!carrito.items.length) return res.redirect('/carrito');
  // Esta vista trae su propio <html>, por eso va sin layout.
  res.render('checkout/index', { title: 'Finalizar Compra', checkout: { carrito }, layout: false });
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
  app.get(ruta, (req, res) => res.render(vista, { title: titulo, layout: false }));
}

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

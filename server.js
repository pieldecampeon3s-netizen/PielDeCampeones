// Servidor mínimo para poder ver las vistas migradas.
// No es la app final: solo sirve las plantillas con datos de ejemplo mientras
// se conecta Supabase y se escribe la lógica de negocio real.

// Lee el .env antes que nada: db.js decide si hay base de datos según
// DATABASE_URL, y esa decisión se toma al importarlo.
require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const fs = require('fs/promises');
const { createClient } = require('@supabase/supabase-js');

const datos = require('./src/datos');
const db = require('./src/db');
const auth = require('./src/auth');
const formato = require('./src/formato');
const filtrosCatalogo = require('./src/filtros-catalogo');

const app = express();
const PUERTO = process.env.PORT || 3000;

/*
  Express 4 no captura los errores de un manejador `async`: la promesa queda
  rechazada sin oyente y Node termina el proceso. Envolver el manejador aquí
  hace que cualquier fallo (por ejemplo, la base de datos caída) acabe en el
  manejador de errores y el cliente vea una página, no una conexión muerta.
*/
function ruta(manejador) {
  return (req, res, next) => Promise.resolve(manejador(req, res, next)).catch(next);
}

// --- Configuración ----------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

const CARPETA_IMAGENES = path.join(__dirname, 'public', 'images');

app.use(express.static(path.join(__dirname, 'public'), {
  // El mime-types de esta version de Express no reconoce .avif y lo sirve
  // como application/octet-stream.
  setHeaders(res, filePath) {
    if (filePath.endsWith('.avif')) res.setHeader('Content-Type', 'image/avif');
  },
}));

app.use('/images', (req, res, next) => {
  const requestedFile = req.path.replace(/^\//, '');
  const requestedPath = path.resolve(CARPETA_IMAGENES, requestedFile);
  if (!requestedPath.startsWith(path.resolve(CARPETA_IMAGENES) + path.sep)) {
    return res.sendFile(path.join(CARPETA_IMAGENES, 'placeholder.png'));
  }

  res.sendFile(requestedPath, (err) => {
    if (err && (err.code === 'ENOENT' || err.statusCode === 404)) {
      res.sendFile(path.join(CARPETA_IMAGENES, 'placeholder.png'));
    } else if (err) {
      next(err);
    }
  });
});

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
app.use('/vendor/sweetalert2', libreria('sweetalert2', 'dist'));

/*
  Fotos de producto que sube el panel de administración. Van directo a
  public/images, la misma carpeta donde ya viven las imágenes de siempre, para
  que imagen_url siga siendo una ruta simple del tipo /images/archivo.jpg.

  El nombre del archivo NUNCA sale del original que manda el navegador (podría
  traer ../ o cualquier cosa): se genera aquí mismo a partir de una lista fija
  de tipos permitidos.
*/
const TIPOS_IMAGEN_PERMITIDOS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

// Usar memoryStorage evita escribir fichero localmente antes de subirlo a
// Supabase. El buffer se maneja directamente desde `req.file.buffer`.
const subirImagenProducto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    cb(null, Boolean(TIPOS_IMAGEN_PERMITIDOS[file.mimetype]));
  },
});

// Supabase client (opcional). Si no está configurado, el código sigue
// usando las imágenes almacenadas en `public/images`.
let supabase = null;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'imagenes';
if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}

async function uploadLocalFileToSupabase(localPath, destPath, contentType) {
  if (!supabase) throw new Error('No hay Supabase configurado');
  const data = await fs.readFile(localPath);
  const { error: uploadError } = await supabase.storage.from(SUPABASE_BUCKET).upload(destPath, data, {
    contentType,
    upsert: true,
  });
  if (uploadError) throw uploadError;
  const { data: publicData } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(destPath);
  // getPublicUrl devuelve { publicUrl }
  return publicData && publicData.publicUrl ? publicData.publicUrl : publicData;
}

async function uploadBufferToSupabase(buffer, destPath, contentType) {
  if (!supabase) throw new Error('No hay Supabase configurado');
  const { error: uploadError } = await supabase.storage.from(SUPABASE_BUCKET).upload(destPath, buffer, {
    contentType,
    upsert: true,
  });
  if (uploadError) throw uploadError;
  const { data: publicData } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(destPath);
  return publicData && publicData.publicUrl ? publicData.publicUrl : publicData;
}

async function removeObjectFromSupabase(objectPath) {
  if (!supabase) throw new Error('No hay Supabase configurado');
  const { error } = await supabase.storage.from(SUPABASE_BUCKET).remove([objectPath]);
  if (error) throw error;
}

async function saveLocalImage(buffer, filename) {
  await fs.mkdir(CARPETA_IMAGENES, { recursive: true });
  const localPath = path.join(CARPETA_IMAGENES, filename);
  await fs.writeFile(localPath, buffer);
  return `/images/${filename}`;
}

async function removeLocalImage(filename) {
  try {
    await fs.unlink(path.join(CARPETA_IMAGENES, filename));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

/** Envuelve la subida para que un fallo de multer (tamaño, tipo) llegue como
 *  req.errorImagen en vez de cortar la petición antes de tiempo. */
function conFotoDeProducto(req, res, next) {
  subirImagenProducto.single('imagen')(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      req.errorImagen =
        error.code === 'LIMIT_FILE_SIZE' ? 'La imagen no puede pesar más de 10 MB.' : 'No se pudo procesar la imagen.';
    }
    next();
  });
}

app.use(cookieParser());
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

// Lee la cookie de sesion y deja el usuario en req.usuario / res.locals.
// Va antes que cualquier ruta para que las vistas ya lo tengan.
app.use(auth.cargarSesion());

// Helpers y variables disponibles en todas las vistas
app.locals.formatCOP = formato.formatCOP;
app.locals.formatNumero = formato.formatNumero;

app.use(ruta(async (req, res, next) => {
  // usuario y esAdmin los pone auth.cargarSesion(), que corre antes.
  res.locals.currentPath = req.path;

  /*
    Identificadores de los favoritos, para pintar el corazón lleno al renderizar.

    Con sesión salen de la base. Para un invitado el servidor NO puede saberlos
    (viven en su navegador), así que va vacío y favoritos.js los marca al
    cargar la página.
  */
  res.locals.favoritos = req.usuario ? await datos.listarFavoritosIds(req.usuario.id) : [];

  /*
    Total de artículos del carrito, para que la burbuja salga con su número
    desde el servidor.

    Antes se renderizaba un "0" visible y JavaScript lo corregía al cargar, así
    que en cada recarga se veía el cero un instante antes del número real. El
    carrito ya está en la sesión: no hay razón para no pintarlo ya.
  */
  res.locals.totalCarrito = obtenerCarrito(req).items.reduce((a, i) => a + i.cantidad, 0);

  res.locals.errores = null;
  res.locals.title = 'Piel de Campeón';
  next();
}));

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
async function mostrarTienda(req, res) {
  const [catalogoBruto, ocultarAgotados] = await Promise.all([
    datos.listarProductos(),
    datos.obtenerConfiguracion('ocultar_agotados', 'false'),
  ]);
  // Ajuste global del panel de administración: si está activo, ningún
  // visitante ve productos agotados, sin importar su propio filtro "Solo
  // disponibles" (ese sigue siendo independiente y opcional).
  const catalogo = ocultarAgotados === 'true' ? catalogoBruto.filter((p) => p.stock > 0) : catalogoBruto;

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
    todasLasCategorias: [...new Set(catalogo.map((p) => p.nombreCategoria))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'es')),
  });
}

app.get('/', ruta(mostrarTienda));

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

app.get('/producto/:id', ruta(async (req, res, next) => {
  const producto = await datos.buscarProducto(req.params.id);
  if (!producto) return next();
  res.render('producto/detalles', {
    title: producto.nombre,
    estilos: ['/css/tallas.css'],
    scripts: ['/js/producto.js'],
    producto,
  });
}));

// --- Carrito ----------------------------------------------------------------
app.get('/carrito', (req, res) =>
  res.render('carrito/index', { title: 'Mi Carrito de Compras', carrito: obtenerCarrito(req) })
);

// Una misma camiseta en dos tallas son dos líneas distintas del carrito, así
// que la identidad de una línea es producto + talla, no solo el producto.
const mismaLinea = (item, productoId, talla) =>
  item.productoId === productoId && (item.talla || '') === (talla || '');

app.post('/carrito/agregar', ruta(async (req, res) => {
  const productoId = Number(req.body.productoId);
  const cantidad = Number(req.body.cantidad) || 1;
  const talla = String(req.body.talla || '').trim().toUpperCase();

  if (cantidad <= 0) {
    return res.json({ success: false, message: 'La cantidad debe ser mayor a cero.' });
  }

  const producto = await datos.buscarProducto(productoId);
  if (!producto) return res.json({ success: false, message: 'Producto no encontrado.' });

  // Si el producto maneja tallas, elegir una es obligatorio: sin eso no se
  // sabe qué enviar. Y la talla pedida tiene que ser de las que de verdad
  // tienen stock (producto.tallas ya viene filtrada así).
  const disponibles = producto.tallas || [];
  if (disponibles.length) {
    if (!talla) {
      return res.json({ success: false, message: 'Elige una talla antes de añadir al carrito.' });
    }
    if (!disponibles.includes(talla)) {
      return res.json({ success: false, message: `La talla ${talla} no está disponible.` });
    }
  }

  /*
    El stock a comprobar es el de ESA talla, no el total del producto: un
    producto puede tener 2 en M y 12 en L, y pedir 5 de la M debe rechazarse
    aunque en total (M+L) haya de sobra. Sin talla (producto sin tallas
    configuradas), se usa el agregado, que en ese caso es 0 igual que hoy.
  */
  const entradaTalla = talla && (producto.tallasStock || []).find((t) => t.talla === talla);
  const stockDisponible = entradaTalla ? entradaTalla.stock : producto.stock;

  if (stockDisponible <= 0) {
    return res.json({ success: false, message: 'Esta camiseta está agotada.' });
  }

  const carrito = obtenerCarrito(req);
  const existente = carrito.items.find((i) => mismaLinea(i, productoId, talla));

  /*
    Tope de stock, comprobado AQUÍ y no solo en el navegador.

    El atributo `max` del campo de cantidad es una sugerencia para el
    navegador: cualquiera puede enviar un POST con la cantidad que quiera. Sin
    esta comprobación se podían pedir 999 camisetas de un producto con 4, y
    repitiendo la operación la cantidad se acumulaba sin límite.

    Se cuenta lo que ya hay en el carrito de ESA talla, no solo lo que llega
    ahora: cinco veces "añadir 1" suman igual que "añadir 5".
  */
  const yaEnCarrito = existente ? existente.cantidad : 0;
  const cabenAun = stockDisponible - yaEnCarrito;

  if (cabenAun <= 0) {
    return res.json({
      success: false,
      message: `Ya tienes las ${stockDisponible} unidades disponibles en el carrito.`,
    });
  }

  if (cantidad > cabenAun) {
    return res.json({
      success: false,
      message:
        yaEnCarrito > 0
          ? `Solo quedan ${cabenAun} unidades más (ya tienes ${yaEnCarrito} en el carrito).`
          : `Solo hay ${stockDisponible} unidades disponibles.`,
    });
  }

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
}));

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
app.post('/carrito/cantidad', ruta(async (req, res) => {
  const productoId = Number(req.body.productoId);
  const talla = String(req.body.talla || '').trim().toUpperCase();
  const cantidad = Number(req.body.cantidad);

  const carrito = obtenerCarrito(req);
  const linea = carrito.items.find((i) => mismaLinea(i, productoId, talla));
  if (!linea) return res.json({ success: false, message: 'Esa línea ya no está en el carrito.' });

  if (cantidad <= 0) {
    carrito.items = carrito.items.filter((i) => !mismaLinea(i, productoId, talla));
  } else {
    // El mismo tope que al añadir, y por la misma talla de la línea: cambiar
    // la cantidad desde el carrito no puede ser la puerta de atrás para
    // saltarse el stock de esa talla en concreto.
    const producto = await datos.buscarProducto(productoId);
    const entradaTalla = producto && talla && (producto.tallasStock || []).find((t) => t.talla === talla);
    const tope = entradaTalla ? entradaTalla.stock : producto ? producto.stock : cantidad;

    if (cantidad > tope) {
      return res.json({
        success: false,
        message: `Solo hay ${tope} unidades disponibles.`,
        cantidadCorregida: tope,
      });
    }

    linea.cantidad = cantidad;
  }

  const actualizado = obtenerCarrito(req);
  res.json({
    success: true,
    itemCount: actualizado.items.reduce((a, i) => a + i.cantidad, 0),
    total: formato.formatCOP(actualizado.total),
    cartIsEmpty: actualizado.items.length === 0,
  });
}));

app.get('/carrito/contador', (req, res) => {
  const carrito = obtenerCarrito(req);
  res.json({ itemCount: carrito.items.reduce((a, i) => a + i.cantidad, 0) });
});

/*
  --- Favoritos --------------------------------------------------------------

  Dos almacenes según quién mire:

  * Invitado: los guarda su navegador en localStorage. No se toca el servidor
    al marcar un corazón; solo se le pregunta qué productos son esos números
    cuando hay que dibujar la lista.
  * Con sesión: van a la tabla `favoritos`, así que le siguen a cualquier
    dispositivo donde entre.

  Al iniciar sesión o registrarse, lo que tenía en el navegador se fusiona con
  lo que ya hubiera en su cuenta. Nunca se reemplaza: sumar es reversible,
  perder favoritos no.
*/

/** Alterna un favorito. Solo para quien tiene sesión: el invitado no llega aquí. */
app.post('/favoritos/alternar', ruta(async (req, res) => {
  const productoId = Number(req.body.productoId);

  if (!req.usuario) {
    // El cliente sabe qué hacer con esto: guardarlo en su navegador.
    return res.status(401).json({ success: false, invitado: true });
  }

  if (!(await datos.buscarProducto(productoId))) {
    return res.json({ success: false, message: 'Producto no encontrado.' });
  }

  const esFavorito = await datos.alternarFavorito(req.usuario.id, productoId);
  const ids = await datos.listarFavoritosIds(req.usuario.id);

  res.json({ success: true, esFavorito, total: ids.length });
}));

/**
 * Resuelve una lista de identificadores en productos. La usa el invitado para
 * pintar su página de favoritos, porque el servidor no sabe cuáles tiene.
 */
app.post('/favoritos/resolver', ruta(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];

  // Un tope por si alguien manda una lista enorme a propósito.
  const productos = await datos.productosPorIds(ids.slice(0, 200));

  res.json({
    success: true,
    productos: productos.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      precio: p.precio,
      precioTexto: formato.formatCOP(p.precio),
      imagenUrl: p.imagenUrl,
      stock: p.stock,
      tallas: p.tallas,
    })),
  });
}));

/**
 * Pasa los favoritos del navegador a la cuenta. Lo llama el cliente en la
 * primera carga después de entrar, cuando detecta que hay sesión y todavía
 * quedan favoritos guardados en local.
 */
app.post('/favoritos/fusionar', ruta(async (req, res) => {
  if (!req.usuario) return res.status(401).json({ success: false, invitado: true });

  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const { anadidos } = await datos.fusionarFavoritos(req.usuario.id, ids.slice(0, 200));
  const finales = await datos.listarFavoritosIds(req.usuario.id);

  res.json({ success: true, anadidos, ids: finales });
}));

app.get('/favoritos', ruta(async (req, res) => {
  // Con sesión el servidor ya puede pintar la lista entera. Sin sesión manda
  // la página vacía y favoritos.js la rellena desde localStorage.
  const productos = req.usuario ? await datos.listarFavoritos(req.usuario.id) : [];

  res.render('catalogo/favoritos', {
    title: 'Mis Favoritos',
    // `pagina` deja que favoritos.js sepa que aquí, al quitar un corazón,
    // la tarjeta debe desaparecer de la lista.
    pagina: 'favoritos',
    estilos: ['/css/catalogo.css', '/css/tallas.css'],
    scripts: ['/js/catalogo.js'],
    productos,
    // Si es invitado, la lista la construye el navegador.
    esInvitado: !req.usuario,
  });
}));

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

/*
  Guarda el pedido antes de mandar al cliente a WhatsApp.

  Hasta ahora el checkout solo abría WhatsApp: si el mensaje no llegaba o el
  cliente cerraba la aplicación, del pedido no quedaba ni rastro. Ahora se
  registra primero y el mensaje lleva su número.

  Si la base falla no se bloquea la venta: se responde sin número de pedido y
  el cliente sigue a WhatsApp igual. Perder un registro es malo; perder la
  venta, peor.
*/
app.post('/checkout/pedido', ruta(async (req, res) => {
  const carrito = obtenerCarrito(req);
  if (!carrito.items.length) {
    return res.json({ success: false, message: 'El carrito está vacío.' });
  }

  const cliente = {
    nombre: String(req.body.nombre || '').trim(),
    telefono: String(req.body.telefono || '').trim(),
    ciudad: String(req.body.ciudad || '').trim(),
    direccion: String(req.body.direccion || '').trim(),
    referencia: String(req.body.referencia || '').trim(),
  };

  if (!cliente.nombre || !cliente.telefono || !cliente.ciudad || !cliente.direccion) {
    return res.json({ success: false, message: 'Faltan datos de contacto o de envío.' });
  }

  if (!datos.usandoBaseDeDatos) {
    // Sin base configurada la compra sigue funcionando, solo que no se guarda.
    return res.json({ success: true, pedidoId: null, guardado: false });
  }

  try {
    const pedido = await datos.crearPedido({
      cliente,
      items: carrito.items,
      total: carrito.total,
      usuarioId: (req.session.usuario && req.session.usuario.id) || null,
    });

    // El carrito se vacía solo cuando el pedido quedó guardado.
    req.session.carrito = { items: [] };

    res.json({ success: true, pedidoId: pedido.id, guardado: true });
  } catch (error) {
    console.error('[checkout] no se pudo guardar el pedido:', error.message);
    res.json({ success: true, pedidoId: null, guardado: false });
  }
}));

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

app.get('/account/login', (req, res) => {
  // Quien ya entró no tiene nada que hacer en el login.
  if (req.usuario) return res.redirect('/');
  mostrarLogin(req, res, { volver: req.query.volver || '' });
});

app.post('/account/login', ruta(async (req, res) => {
  const email = String(req.body.email || '').trim();
  const contrasena = String(req.body.password || '');
  const volver = String(req.body.volver || '');

  if (!email || !contrasena) {
    return mostrarLogin(req, res, {
      aviso: 'Escribe tu correo y tu contraseña.',
      valores: { email },
      volver,
    });
  }

  if (!datos.usandoBaseDeDatos) {
    return mostrarLogin(req, res, {
      aviso: 'No hay base de datos configurada, así que no se puede iniciar sesión.',
      valores: { email },
      volver,
    });
  }

  const resultado = await auth.iniciarSesion(email, contrasena);

  if (!resultado.ok) {
    return mostrarLogin(req, res, {
      aviso: resultado.mensaje,
      valores: { email },
      volver,
    });
  }

  auth.ponerCookie(res, resultado.token);

  /*
    `volver` viene del navegador, así que no se puede confiar en él: si
    alguien envía una dirección externa, tendríamos un redirector abierto
    para llevar clientes a una web falsa. Solo se aceptan rutas internas.
  */
  const destino = volver.startsWith('/') && !volver.startsWith('//') ? volver : '/';
  res.redirect(destino);
}));

// --- Registro ---------------------------------------------------------------

function mostrarRegistro(req, res, extra = {}) {
  res.render('account/registro', { title: 'Crear cuenta', ...extra });
}

app.post('/account/registro', ruta(async (req, res) => {
  const email = String(req.body.email || '').trim();
  const contrasena = String(req.body.password || '');
  const confirmar = String(req.body.confirmPassword || '');
  const nombre = String(req.body.nombre || '').trim();

  const errores = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errores.email = 'Escribe un correo válido.';
  if (contrasena.length < 8) errores.password = 'La contraseña debe tener al menos 8 caracteres.';
  if (contrasena !== confirmar) errores.confirmPassword = 'Las contraseñas no coinciden.';

  if (Object.keys(errores).length) {
    return mostrarRegistro(req, res, { errores, valores: { email, nombre } });
  }

  const resultado = await auth.registrar({ email, contrasena, nombre });

  if (!resultado.ok) {
    return mostrarRegistro(req, res, {
      errores: { email: resultado.mensaje },
      valores: { email, nombre },
    });
  }

  // Cuenta creada: se entra directamente, sin pedir la contraseña otra vez.
  auth.ponerCookie(res, auth.firmar(resultado.usuario));
  res.redirect('/');
}));

app.get('/account/acceso-denegado', (req, res) =>
  res.render('account/acceso-denegado', { title: 'Acceso Denegado' })
);

app.post('/account/logout', (req, res) => {
  auth.quitarCookie(res);
  res.redirect('/');
});

/*
  Cierra la sesión en todos los dispositivos subiendo la versión de token.
  Es lo que hay que usar si sospechas que alguien más entró en tu cuenta:
  el simple "cerrar sesión" solo borra la cookie de ESTE navegador.
*/
app.post('/account/cerrar-todo', auth.exigirSesion, ruta(async (req, res) => {
  await auth.cerrarTodasLasSesiones(req.usuario.id);
  auth.quitarCookie(res);
  res.redirect('/account/login');
}));

// --- Perfil ("Mi cuenta") ----------------------------------------------------
/*
  Antes no existía ninguna vista de perfil: el enlace "Mi cuenta" apuntaba
  siempre a /account/login, así que a alguien ya identificado el login lo
  mandaba de vuelta a la portada sin explicación. Esta es esa página.
*/
async function datosDePerfil(usuario) {
  const [pedidos, favoritosIds] = await Promise.all([
    datos.listarPedidosDeUsuario(usuario.id),
    datos.listarFavoritosIds(usuario.id),
  ]);
  return {
    title: 'Mi cuenta',
    estilos: ['/css/cuenta.css'],
    scripts: ['/js/cuenta.js'],
    usuario,
    pedidos,
    totalFavoritos: favoritosIds.length,
  };
}

app.get('/account', auth.exigirSesion, ruta(async (req, res) => {
  res.render('account/perfil', {
    ...(await datosDePerfil(req.usuario)),
    exito: req.query.guardado ? 'perfil' : req.query.contrasena ? 'contrasena' : null,
  });
}));

app.post('/account/perfil', auth.exigirSesion, ruta(async (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  const telefono = String(req.body.telefono || '').trim();

  if (!nombre) {
    return res.render('account/perfil', {
      ...(await datosDePerfil(req.usuario)),
      usuario: { ...req.usuario, nombre, telefono },
      errorPerfil: 'Escribe tu nombre.',
    });
  }

  await auth.actualizarPerfil(req.usuario.id, { nombre, telefono });
  res.redirect('/account?guardado=1');
}));

app.post('/account/contrasena', auth.exigirSesion, ruta(async (req, res) => {
  const actual = String(req.body.actual || '');
  const nueva = String(req.body.nueva || '');
  const confirmar = String(req.body.confirmar || '');

  async function conError(mensaje) {
    res.render('account/perfil', {
      ...(await datosDePerfil(req.usuario)),
      errorContrasena: mensaje,
    });
  }

  if (nueva.length < 8) return conError('La nueva contraseña debe tener al menos 8 caracteres.');
  if (nueva !== confirmar) return conError('Las contraseñas nuevas no coinciden.');

  // req.usuario no trae el hash (buscarPorId no lo selecciona a propósito):
  // para comprobar la contraseña actual hace falta volver a pedirlo.
  const conHash = await auth.buscarPorEmail(req.usuario.email);
  if (!(await auth.verificarContrasena(actual, conHash.password_hash))) {
    return conError('La contraseña actual no es correcta.');
  }

  await auth.cambiarContrasena(req.usuario.id, nueva);

  /*
    cambiarContrasena() sube version_token para cerrar la sesión en el resto
    de dispositivos. Eso también invalidaría la cookie de ESTA petición, así
    que se firma una nueva con el token ya actualizado: si no, la persona
    vería su propio cambio de contraseña como un cierre de sesión.
  */
  const actualizado = await auth.buscarPorId(req.usuario.id);
  auth.ponerCookie(res, auth.firmar(actualizado));

  res.redirect('/account?contrasena=1');
}));

// --- Administración ---------------------------------------------------------
/*
  Un solo guardia para todo /admin. Protegerlo ruta por ruta funciona hasta
  que alguien añade una y se olvida; asi el olvido no es posible.
*/
app.use('/admin', auth.exigirAdmin, (req, res, next) => {
  // Solo el panel carga SweetAlert2: la tienda pública no lo necesita.
  res.locals.cargarSweetAlert = true;
  next();
});

app.get('/admin', ruta(async (req, res) =>
  res.render('admin/index', {
    title: 'Panel de Administración',
    estilos: ['/css/admin.css'],
    dashboard: await datos.resumenDashboard(),
    ocultarAgotados: (await datos.obtenerConfiguracion('ocultar_agotados', 'false')) === 'true',
    toastExito: req.query.configuracionGuardada ? 'Configuración guardada.' : null,
    toastParam: 'configuracionGuardada',
  })
));

app.post('/admin/configuracion', ruta(async (req, res) => {
  await datos.guardarConfiguracion('ocultar_agotados', req.body.ocultarAgotados === 'on' ? 'true' : 'false');
  res.redirect('/admin?configuracionGuardada=1');
}));

app.get('/admin/productos', ruta(async (req, res) =>
  res.render('producto/index', {
    title: 'Gestión de Inventario de Productos',
    estilos: ['/css/admin.css'],
    // Incluye los ocultos: desde el panel hay que poder verlos y reactivarlos.
    productos: await datos.listarTodosLosProductos(),
    toastExito: req.query.creado
      ? 'Producto creado correctamente.'
      : req.query.editado
      ? 'Producto actualizado correctamente.'
      : req.query.ocultado
      ? 'Producto ocultado del catálogo.'
      : req.query.activado
      ? 'Producto activado en el catálogo.'
      : null,
    toastParam: req.query.creado
      ? 'creado'
      : req.query.editado
      ? 'editado'
      : req.query.ocultado
      ? 'ocultado'
      : 'activado',
  })
));

app.get('/admin/productos/crear', ruta(async (req, res) =>
  res.render('producto/crear', {
    title: 'Crear Nuevo Producto',
    estilos: ['/css/admin.css'],
    scripts: ['/js/admin.js'],
    producto: {},
    categorias: await datos.listarCategorias(),
    tallasDisponibles: datos.TALLAS,
    errores: null,
  })
));

/*
  Convierte los campos de texto del formulario en valores listos para guardar,
  y junta los errores de validación en un solo objeto. Un solo checkbox de
  talla llega como string; varios, como array; ninguno, como undefined — de
  ahí el [].concat(), el mismo truco que ya usa comoLista() en
  filtros-catalogo.js para el mismo problema.
*/
/*
  exigirStock: al crear, un producto sin stock en ninguna talla casi seguro
  es un error del formulario (¿de verdad quieres publicarlo ya agotado?), así
  que se exige al menos una. Al editar SÍ se permite dejarlo todo en 0: un
  producto real puede agotarse por completo.
*/
function leerCamposProducto(req, { exigirStock }) {
  const nombre = String(req.body.nombre || '').trim();
  const oem = String(req.body.oem || '').trim();
  const idCategoria = Number(req.body.idCategoria);
  const precio = Number(req.body.precio);
  const descripcion = String(req.body.descripcion || '').trim();

  const tallasStock = datos.TALLAS.map((talla) => ({
    talla,
    stock: Math.max(0, Math.trunc(Number(req.body['stock_' + talla])) || 0),
  }));

  const errores = {};
  if (!nombre) errores.nombre = 'Escribe el nombre del producto.';
  if (!Number.isInteger(idCategoria) || idCategoria <= 0) errores.idCategoria = 'Selecciona una categoría.';
  if (!Number.isFinite(precio) || precio < 0) errores.precio = 'El precio debe ser un número válido.';
  if (exigirStock && !tallasStock.some((t) => t.stock > 0)) {
    errores.stock = 'Ingresa el stock de al menos una talla.';
  }

  return { valores: { nombre, oem, idCategoria, precio, tallasStock, descripcion }, errores };
}

app.post('/admin/productos/crear', conFotoDeProducto, ruta(async (req, res) => {
  const { valores, errores } = leerCamposProducto(req, { exigirStock: true });
  if (req.errorImagen) errores.imagen = req.errorImagen;
  else if (!req.file) errores.imagen = 'Selecciona una foto del producto.';

  if (Object.keys(errores).length) {
    return res.render('producto/crear', {
      title: 'Crear Nuevo Producto',
    estilos: ['/css/admin.css'],
    scripts: ['/js/admin.js'],
      producto: valores,
      categorias: await datos.listarCategorias(),
      tallasDisponibles: datos.TALLAS,
      errores,
    });
  }

  try {
    let imagenUrl;
    if (req.file) {
      const ext = TIPOS_IMAGEN_PERMITIDOS[req.file.mimetype] || path.extname(req.file.originalname) || '.jpg';
      const filename = `producto-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
      if (supabase) {
        try {
          imagenUrl = await uploadBufferToSupabase(req.file.buffer, `productos/${filename}`, req.file.mimetype);
        } catch (err) {
          console.error('[supabase] no se pudo subir imagen:', err.message);
          errores.imagen = 'No se pudo subir la imagen. Intenta de nuevo.';
        }
      } else {
        imagenUrl = await saveLocalImage(req.file.buffer, filename);
      }
    }

    if (errores.imagen) {
      return res.render('producto/crear', {
        title: 'Crear Nuevo Producto',
        estilos: ['/css/admin.css'],
        scripts: ['/js/admin.js'],
        producto: valores,
        categorias: await datos.listarCategorias(),
        tallasDisponibles: datos.TALLAS,
        errores,
      });
    }

    const id = await datos.crearProducto({ ...valores, oem: valores.oem || null, imagenUrl });
    res.redirect('/admin/productos?creado=' + id);
  } catch (error) {
    if (error.code === '23505') {
      return res.render('producto/crear', {
        title: 'Crear Nuevo Producto',
        estilos: ['/css/admin.css'],
        scripts: ['/js/admin.js'],
        producto: valores,
        categorias: await datos.listarCategorias(),
        tallasDisponibles: datos.TALLAS,
        errores: { oem: 'Ya existe un producto con ese OEM.' },
      });
    }
    throw error;
  }
}));

app.get('/admin/productos/editar/:id', ruta(async (req, res, next) => {
  const producto = await datos.buscarProducto(req.params.id);
  if (!producto) return next();
  res.render('producto/editar', {
    title: 'Editar Producto',
    estilos: ['/css/admin.css'],
    scripts: ['/js/admin.js'],
    producto,
    categorias: await datos.listarCategorias(),
    tallasDisponibles: datos.TALLAS,
    errores: null,
  });
}));

app.post('/admin/productos/editar/:id', conFotoDeProducto, ruta(async (req, res, next) => {
  const actual = await datos.buscarProducto(req.params.id);
  if (!actual) return next();

  const { valores, errores } = leerCamposProducto(req, { exigirStock: false });
  if (req.errorImagen) errores.imagen = req.errorImagen;

  if (Object.keys(errores).length) {
    return res.render('producto/editar', {
      title: 'Editar Producto',
    estilos: ['/css/admin.css'],
    scripts: ['/js/admin.js'],
      producto: { ...actual, ...valores },
      categorias: await datos.listarCategorias(),
      tallasDisponibles: datos.TALLAS,
      errores,
    });
  }

  try {
    let imagenUrl = actual.imagenUrl;
    if (req.file) {
      const ext = TIPOS_IMAGEN_PERMITIDOS[req.file.mimetype] || path.extname(req.file.originalname) || '.jpg';
      const filename = `producto-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
      if (supabase) {
        let publicUrl;
        try {
          publicUrl = await uploadBufferToSupabase(req.file.buffer, `productos/${filename}`, req.file.mimetype);
        } catch (err) {
          console.error('[supabase] no se pudo subir imagen:', err.message);
          errores.imagen = 'No se pudo subir la imagen. Intenta de nuevo.';
        }

        if (!errores.imagen) {
          try {
            if (actual.imagenUrl && actual.imagenUrl.includes(`/storage/v1/object/public/${SUPABASE_BUCKET}/`)) {
              const parts = actual.imagenUrl.split(`/storage/v1/object/public/${SUPABASE_BUCKET}/`);
              const oldPath = parts[1];
              if (oldPath) await removeObjectFromSupabase(oldPath).catch(() => {});
            }
          } catch (e) {
            console.error('[supabase] no se pudo borrar imagen anterior:', e.message);
          }
          imagenUrl = publicUrl;
        }
      } else {
        imagenUrl = await saveLocalImage(req.file.buffer, filename);
        if (actual.imagenUrl && actual.imagenUrl.startsWith('/images/') && actual.imagenUrl !== '/images/placeholder.png') {
          const oldFilename = actual.imagenUrl.replace('/images/', '');
          await removeLocalImage(oldFilename).catch(() => {});
        }
      }
    }

    if (errores.imagen) {
      return res.render('producto/editar', {
        title: 'Editar Producto',
        estilos: ['/css/admin.css'],
        scripts: ['/js/admin.js'],
        producto: { ...actual, ...valores },
        categorias: await datos.listarCategorias(),
        tallasDisponibles: datos.TALLAS,
        errores,
      });
    }

    await datos.actualizarProducto(actual.id, { ...valores, oem: valores.oem || null, imagenUrl });
    res.redirect('/admin/productos?editado=' + actual.id);
  } catch (error) {
    if (error.code === '23505') {
      return res.render('producto/editar', {
        title: 'Editar Producto',
        estilos: ['/css/admin.css'],
        scripts: ['/js/admin.js'],
        producto: { ...actual, ...valores },
        categorias: await datos.listarCategorias(),
        tallasDisponibles: datos.TALLAS,
        errores: { oem: 'Ya existe un producto con ese OEM.' },
      });
    }
    throw error;
  }
}));

app.get('/admin/productos/eliminar/:id', ruta(async (req, res, next) => {
  const producto = await datos.buscarProducto(req.params.id);
  if (!producto) return next();
  res.render('producto/eliminar', { title: 'Ocultar Producto', estilos: ['/css/admin.css'], producto });
}));

app.post('/admin/productos/eliminar/:id', ruta(async (req, res, next) => {
  const id = await datos.cambiarEstadoProducto(req.params.id, false);
  if (!id) return next();
  res.redirect('/admin/productos?ocultado=' + id);
}));

app.post('/admin/productos/activar/:id', ruta(async (req, res, next) => {
  const id = await datos.cambiarEstadoProducto(req.params.id, true);
  if (!id) return next();
  res.redirect('/admin/productos?activado=' + id);
}));

app.get('/admin/categorias', ruta(async (req, res) =>
  res.render('categoria/index', {
    title: 'Gestión de Categorías',
    estilos: ['/css/admin.css'],
    categorias: await datos.listarCategorias(),
    toastExito: req.query.creado
      ? 'Categoría creada correctamente.'
      : req.query.editado
      ? 'Categoría actualizada correctamente.'
      : req.query.eliminado
      ? 'Categoría eliminada correctamente.'
      : null,
    toastParam: req.query.creado ? 'creado' : req.query.editado ? 'editado' : 'eliminado',
    toastError:
      req.query.error === 'categoria_en_uso'
        ? 'No se puede eliminar: hay productos asignados a esta categoría. Cámbialos de categoría o elimínalos primero.'
        : null,
  })
));

app.get('/admin/categorias/crear', (req, res) =>
  res.render('categoria/crear', {
    title: 'Crear Categoría',
    estilos: ['/css/admin.css'],
    categoria: {},
    errores: null,
  })
);

/*
  Comparte forma con leerCamposProducto de más arriba, pero categorías solo
  tiene nombre/descripción: no vale la pena generalizar un solo campo en
  común entre las dos.
*/
function leerCamposCategoria(req) {
  const nombre = String(req.body.nombre || '').trim();
  const descripcion = String(req.body.descripcion || '').trim();
  const errores = {};
  if (!nombre) errores.nombre = 'Escribe el nombre de la categoría.';
  return { valores: { nombre, descripcion }, errores };
}

app.post('/admin/categorias/crear', ruta(async (req, res) => {
  const { valores, errores } = leerCamposCategoria(req);

  if (Object.keys(errores).length) {
    return res.render('categoria/crear', {
      title: 'Crear Categoría',
      estilos: ['/css/admin.css'],
      categoria: valores,
      errores,
    });
  }

  try {
    const id = await datos.crearCategoria(valores);
    res.redirect('/admin/categorias?creado=' + id);
  } catch (error) {
    if (error.code === '23505') {
      return res.render('categoria/crear', {
        title: 'Crear Categoría',
        estilos: ['/css/admin.css'],
        categoria: valores,
        errores: { nombre: 'Ya existe una categoría con ese nombre.' },
      });
    }
    throw error;
  }
}));

app.get('/admin/categorias/editar/:id', ruta(async (req, res, next) => {
  const categoria = await datos.buscarCategoria(req.params.id);
  if (!categoria) return next();
  res.render('categoria/editar', {
    title: 'Editar Categoría',
    estilos: ['/css/admin.css'],
    categoria,
    errores: null,
  });
}));

app.post('/admin/categorias/editar/:id', ruta(async (req, res, next) => {
  const actual = await datos.buscarCategoria(req.params.id);
  if (!actual) return next();

  const { valores, errores } = leerCamposCategoria(req);

  if (Object.keys(errores).length) {
    return res.render('categoria/editar', {
      title: 'Editar Categoría',
      estilos: ['/css/admin.css'],
      categoria: { ...actual, ...valores },
      errores,
    });
  }

  try {
    await datos.actualizarCategoria(actual.id, valores);
    res.redirect('/admin/categorias?editado=' + actual.id);
  } catch (error) {
    if (error.code === '23505') {
      return res.render('categoria/editar', {
        title: 'Editar Categoría',
        estilos: ['/css/admin.css'],
        categoria: { ...actual, ...valores },
        errores: { nombre: 'Ya existe una categoría con ese nombre.' },
      });
    }
    throw error;
  }
}));

app.get('/admin/categorias/eliminar/:id', ruta(async (req, res, next) => {
  const categoria = await datos.buscarCategoria(req.params.id);
  if (!categoria) return next();
  res.render('categoria/eliminar', { title: 'Eliminar Categoría', estilos: ['/css/admin.css'], categoria });
}));

app.post('/admin/categorias/eliminar/:id', ruta(async (req, res, next) => {
  try {
    const id = await datos.eliminarCategoria(req.params.id);
    if (!id) return next();
    res.redirect('/admin/categorias?eliminado=' + id);
  } catch (error) {
    if (error.code === '23503') {
      return res.redirect('/admin/categorias?error=categoria_en_uso');
    }
    throw error;
  }
}));

app.get('/admin/usuarios', ruta(async (req, res) =>
  res.render('usuario/index', {
    title: 'Gestión de Usuarios',
    estilos: ['/css/admin.css'],
    scripts: ['/js/admin.js'],
    usuarios: await datos.listarUsuarios(),
    toastExito: req.query.editado ? 'Usuario actualizado correctamente.' : null,
    toastParam: 'editado',
  })
));

/*
  Todo lo que se puede tocar de un usuario (nombre, teléfono, rol, activo y
  opcionalmente la contraseña) se guarda junto, desde el modal de "Editar" —
  antes eran dos botones sueltos con un confirm() del navegador cada uno.

  Responde en JSON, no con un redirect: el formulario vive dentro de un modal
  y hay que poder mostrar un error sin cerrarlo ni recargar la página.

  Nadie puede editarse a sí mismo desde aquí (ver el botón oculto en la
  vista): cambiarse el rol a Cliente o desactivarse podría dejar la tienda
  sin ningún administrador con sesión activa capaz de deshacerlo. Se
  comprueba también aquí, no solo ocultando el botón, por si alguien manda
  la petición directa.
*/
app.post('/admin/usuarios/:id/editar', ruta(async (req, res) => {
  if (req.params.id === req.usuario.id) {
    return res.status(400).json({ ok: false, errores: { general: 'No puedes editar tu propia cuenta desde aquí.' } });
  }

  const objetivo = await auth.buscarPorId(req.params.id);
  if (!objetivo) {
    return res.status(404).json({ ok: false, errores: { general: 'Ese usuario ya no existe.' } });
  }

  const nombre = String(req.body.nombre || '').trim();
  const telefono = String(req.body.telefono || '').trim();
  const rol = req.body.rol === 'Administrador' ? 'Administrador' : 'Cliente';
  const activo = req.body.activo === '1' || req.body.activo === true;
  const clave = String(req.body.clave || '');
  const claveConfirmar = String(req.body.claveConfirmar || '');

  const errores = {};
  // La contraseña es opcional: en blanco significa "no la toques".
  if (clave || claveConfirmar) {
    if (clave.length < 8) errores.clave = 'La nueva contraseña debe tener al menos 8 caracteres.';
    else if (clave !== claveConfirmar) errores.clave = 'Las contraseñas no coinciden.';
  }

  if (Object.keys(errores).length) {
    return res.status(400).json({ ok: false, errores });
  }

  await auth.actualizarUsuarioAdmin(objetivo.id, { nombre, telefono, rol, activo });
  // Cambia la contraseña por separado: reutiliza cambiarContrasena, que ya
  // sube version_token y así echa cualquier sesión vieja de esa persona.
  if (clave) await auth.cambiarContrasena(objetivo.id, clave);

  res.json({ ok: true });
}));

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

app.listen(PUERTO, async () => {
  console.log(`Piel de Campeón escuchando en http://localhost:${PUERTO}`);

  // Decir de dónde salen los datos al arrancar evita la confusión de estar
  // mirando los datos de ejemplo creyendo que son los de Supabase.
  if (!datos.usandoBaseDeDatos) {
    console.warn('[datos] Sin DATABASE_URL: se usan los datos de ejemplo de src/datos-demo.js');
    return;
  }

  try {
    const info = await db.probarConexion();
    const productos = await datos.listarProductos();
    console.log(`[datos] Conectado a Supabase (${info.bd}) — ${productos.length} productos en catálogo`);
  } catch (error) {
    console.error('[datos] NO se pudo conectar a la base de datos:', error.message);
    console.error('[datos] Revisa DATABASE_URL en el .env. La tienda se verá vacía hasta arreglarlo.');
  }
});

/*
  Punto único de acceso a los datos.

  Si hay DATABASE_URL en el .env, todo sale de Supabase. Si no la hay, se
  sirven los datos de ejemplo para que la tienda siga levantando: es cómodo
  para trastear con el diseño sin conexión, y evita que la app se caiga en
  seco cuando alguien clona el repositorio y aún no ha configurado nada.

  Todas las funciones son asíncronas aunque las de ejemplo no lo necesiten:
  así el resto del código no tiene que saber de dónde vienen los datos.
*/
const db = require('./db');
const demo = require('./datos-demo');
const supabase = require('./datos-supabase');

const usandoBaseDeDatos = db.hayBaseDeDatos();

// --- Modo sin base de datos: los datos de ejemplo, envueltos en promesas ----

const enDemo = {
  listarProductos: async () => demo.listarProductos(),
  listarTodosLosProductos: async () => demo.listarProductos(),
  buscarProducto: async (id) => demo.buscarProducto(id),
  listarCategorias: async () => demo.categorias,
  buscarCategoria: async (id) => demo.buscarCategoria(id),

  // Escritura de categorías/productos: sin base de datos no hay dónde guardar nada.
  crearCategoria: async () => {
    throw new Error('Crear categorías necesita base de datos.');
  },
  actualizarCategoria: async () => {
    throw new Error('Editar categorías necesita base de datos.');
  },
  eliminarCategoria: async () => {
    throw new Error('Eliminar categorías necesita base de datos.');
  },
  crearProducto: async () => {
    throw new Error('Crear productos necesita base de datos.');
  },
  actualizarProducto: async () => {
    throw new Error('Editar productos necesita base de datos.');
  },
  cambiarEstadoProducto: async () => {
    throw new Error('Ocultar/activar productos necesita base de datos.');
  },
  obtenerConfiguracion: async (clave, porDefecto = null) => porDefecto,
  guardarConfiguracion: async () => {},

  // Sin base de datos no hay cuentas, así que no hay favoritos por usuario:
  // en ese modo TODO el mundo es invitado y sus favoritos viven en el
  // navegador. Estas funciones se dejan coherentes para que nada reviente.
  listarFavoritos: async () => [],
  listarFavoritosIds: async () => [],
  alternarFavorito: async () => {
    throw new Error('Los favoritos por usuario necesitan base de datos.');
  },
  fusionarFavoritos: async () => ({ anadidos: 0 }),
  productosPorIds: async (ids = []) => {
    const limpios = (ids || []).map(Number).filter(Number.isInteger);
    return demo.listarProductos().filter((p) => limpios.includes(p.id));
  },

  crearPedido: async () => {
    // No se inventa un identificador: quien llama debe saber que no se guardó.
    return null;
  },
  listarPedidos: async () => [],
  // Sin base de datos no hay cuentas, así que tampoco hay pedidos que listar.
  listarPedidosDeUsuario: async () => [],

  resumenDashboard: async () => demo.resumenDashboard(),
  listarUsuarios: async () => demo.usuarios || [],
};

const fuente = usandoBaseDeDatos ? supabase : enDemo;

module.exports = {
  usandoBaseDeDatos,
  // Única fuente de la lista de tallas: la usan tanto el catálogo como los
  // formularios de crear/editar producto del panel.
  TALLAS: demo.TALLAS,

  // Se reexporta función a función, en vez de con un spread, para que quede a
  // la vista qué ofrece esta capa y falle pronto si algo no está implementado.
  listarProductos: (...a) => fuente.listarProductos(...a),
  listarTodosLosProductos: (...a) => fuente.listarTodosLosProductos(...a),
  buscarProducto: (...a) => fuente.buscarProducto(...a),
  listarCategorias: (...a) => fuente.listarCategorias(...a),
  buscarCategoria: (...a) => fuente.buscarCategoria(...a),
  crearCategoria: (...a) => fuente.crearCategoria(...a),
  actualizarCategoria: (...a) => fuente.actualizarCategoria(...a),
  eliminarCategoria: (...a) => fuente.eliminarCategoria(...a),
  crearProducto: (...a) => fuente.crearProducto(...a),
  actualizarProducto: (...a) => fuente.actualizarProducto(...a),
  cambiarEstadoProducto: (...a) => fuente.cambiarEstadoProducto(...a),
  obtenerConfiguracion: (...a) => fuente.obtenerConfiguracion(...a),
  guardarConfiguracion: (...a) => fuente.guardarConfiguracion(...a),
  listarFavoritos: (...a) => fuente.listarFavoritos(...a),
  listarFavoritosIds: (...a) => fuente.listarFavoritosIds(...a),
  alternarFavorito: (...a) => fuente.alternarFavorito(...a),
  fusionarFavoritos: (...a) => fuente.fusionarFavoritos(...a),
  productosPorIds: (...a) => fuente.productosPorIds(...a),
  crearPedido: (...a) => fuente.crearPedido(...a),
  listarPedidos: (...a) => fuente.listarPedidos(...a),
  listarPedidosDeUsuario: (...a) => fuente.listarPedidosDeUsuario(...a),
  resumenDashboard: (...a) => fuente.resumenDashboard(...a),
  listarUsuarios: (...a) => fuente.listarUsuarios(...a),
};

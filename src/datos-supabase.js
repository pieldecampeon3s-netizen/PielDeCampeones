/*
  Consultas a Supabase.

  Devuelve los objetos con EXACTAMENTE las mismas propiedades que usaba
  datos-demo.js (imagenUrl, nombreCategoria, idCategoria...), para que las
  plantillas no se enteren de si los datos vienen de un array o de Postgres.

  Ese mapeo se hace en un solo sitio, `aProducto`, y no repartido por las
  consultas: si mañana cambia una columna, se toca aquí y nada más.
*/
const db = require('./db');

// --- Traducción de columnas a lo que esperan las vistas --------------------

/*
  OJO con los tipos: node-postgres devuelve `bigint` y `numeric` como TEXTO,
  no como número. Lo hace a propósito, porque un bigint puede no caber en un
  número de JavaScript sin perder precisión.

  Aquí eso importaba de verdad: los favoritos se guardan como números en la
  sesión, y `[1, 2].includes("1")` es false. Los corazones dejaban de marcarse
  sin dar ningún error. Por eso todos los identificadores se convierten aquí,
  en el único punto por el que pasan los datos.
*/
function aProducto(fila) {
  if (!fila) return null;
  // tallas_stock trae TODAS las tallas configuradas, incluidas las que están
  // en 0 (las necesita el panel para mostrarlas al editar). `tallas` sigue
  // siendo, como siempre, solo las que de verdad tienen para vender: así el
  // chequeo `disponibles.includes(talla)` del carrito sigue funcionando sin
  // tocarle una línea. `stock` sigue siendo el total, para todo lo que ya
  // leía ese número (insignias, "bajo stock", el interruptor de agotados).
  const tallasStock = (fila.tallas_stock || []).map((t) => ({ talla: t.talla, stock: Number(t.stock) }));
  return {
    id: Number(fila.id),
    nombre: fila.nombre,
    descripcion: fila.descripcion || '',
    oem: fila.oem || '',
    precio: Number(fila.precio),
    stock: tallasStock.reduce((suma, t) => suma + t.stock, 0),
    tallas: tallasStock.filter((t) => t.stock > 0).map((t) => t.talla),
    tallasStock,
    imagenUrl: fila.imagen_url || '/images/placeholder.png',
    idCategoria: fila.categoria_id === null ? null : Number(fila.categoria_id),
    nombreCategoria: fila.nombre_categoria || '',
    estado: fila.estado,
    fechaIngreso: fila.creado_en,
  };
}

function aCategoria(fila) {
  if (!fila) return null;
  return {
    id: Number(fila.id),
    nombre: fila.nombre,
    descripcion: fila.descripcion || '',
    // Lo aporta la consulta del panel; en el resto queda indefinido.
    totalProductos: fila.total_productos !== undefined ? Number(fila.total_productos) : undefined,
  };
}

/*
  El join con categorías se repite en casi todas las consultas de producto.

  tallas_stock va como subconsulta correlacionada (no un join+group by)
  porque quien llama a esta constante le concatena su propio "where"/"order
  by" DESPUÉS: un "group by" a mitad de camino rompería esa concatenación.
  Así cada fila de producto sigue siendo una sola fila, con su detalle de
  tallas empaquetado en JSON — igual de compatible con cualquier "where" que
  se le pegue después como lo era antes de que existiera esta tabla.
*/
const SELECT_PRODUCTO = `
    select p.id, p.nombre, p.descripcion, p.oem, p.precio,
           p.imagen_url, p.estado, p.creado_en, p.categoria_id,
           c.nombre as nombre_categoria,
           coalesce(
             (select json_agg(json_build_object('talla', pt.talla, 'stock', pt.stock)
                               order by case pt.talla
                                          when 'S' then 1 when 'M' then 2 when 'L' then 3
                                          when 'XL' then 4 when '2XL' then 5 else 6
                                        end)
                from producto_tallas pt
               where pt.producto_id = p.id),
             '[]'
           ) as tallas_stock
      from productos p
      left join categorias c on c.id = p.categoria_id
`;

// --- Catálogo ---------------------------------------------------------------

async function listarProductos() {
  const filas = await db.consulta(`${SELECT_PRODUCTO} where p.estado = true order by p.id`);
  return filas.map(aProducto);
}

/** Incluye los ocultos: lo necesita el panel de administración. */
async function listarTodosLosProductos() {
  const filas = await db.consulta(`${SELECT_PRODUCTO} order by p.id`);
  return filas.map(aProducto);
}

async function buscarProducto(id) {
  const numero = Number(id);
  if (!Number.isInteger(numero)) return null;
  const fila = await db.unaFila(`${SELECT_PRODUCTO} where p.id = $1`, [numero]);
  return aProducto(fila);
}

async function listarCategorias() {
  const filas = await db.consulta('select id, nombre, descripcion from categorias order by nombre');
  return filas.map(aCategoria);
}

async function buscarCategoria(id) {
  const numero = Number(id);
  if (!Number.isInteger(numero)) return null;
  const fila = await db.unaFila('select id, nombre, descripcion from categorias where id = $1', [numero]);
  return aCategoria(fila);
}

// --- Escritura de categorías (panel de administración) ----------------------

async function crearCategoria({ nombre, descripcion }) {
  const fila = await db.unaFila('insert into categorias (nombre, descripcion) values ($1, $2) returning id', [
    nombre,
    descripcion || null,
  ]);
  return Number(fila.id);
}

async function actualizarCategoria(id, { nombre, descripcion }) {
  const numero = Number(id);
  if (!Number.isInteger(numero)) return null;
  const fila = await db.unaFila(
    'update categorias set nombre = $1, descripcion = $2 where id = $3 returning id',
    [nombre, descripcion || null, numero]
  );
  return fila ? Number(fila.id) : null;
}

/**
 * Borrado real: a diferencia de los productos, las categorías no tienen
 * columna `estado` para ocultarlas. `productos.categoria_id` tiene
 * `on delete restrict`, así que esto falla con el código 23503 si algún
 * producto todavía la usa — quien llama debe capturarlo y avisar bonito.
 */
async function eliminarCategoria(id) {
  const numero = Number(id);
  if (!Number.isInteger(numero)) return null;
  const fila = await db.unaFila('delete from categorias where id = $1 returning id', [numero]);
  return fila ? Number(fila.id) : null;
}

// --- Escritura de productos (panel de administración) -----------------------

/*
  Una talla en 0 no guarda fila: "sin fila" y "en 0" son la misma cosa en
  toda esta funcionalidad (así el panel no tiene que recordar por separado
  "esta talla existe pero está en 0" de "esta talla nunca se configuró").
*/
async function crearProducto({ nombre, descripcion, oem, precio, idCategoria, imagenUrl, tallasStock }) {
  return db.enTransaccion(async (cx) => {
    const { rows } = await cx.query(
      `insert into productos (categoria_id, nombre, descripcion, oem, precio, imagen_url, estado)
       values ($1, $2, $3, $4, $5, $6, true)
       returning id`,
      [idCategoria || null, nombre, descripcion || null, oem || null, precio, imagenUrl]
    );
    const id = Number(rows[0].id);

    for (const { talla, stock } of tallasStock) {
      if (stock <= 0) continue;
      await cx.query('insert into producto_tallas (producto_id, talla, stock) values ($1, $2, $3)', [
        id,
        talla,
        stock,
      ]);
    }
    return id;
  });
}

async function actualizarProducto(id, { nombre, descripcion, oem, precio, idCategoria, imagenUrl, tallasStock }) {
  const numero = Number(id);
  if (!Number.isInteger(numero)) return null;

  return db.enTransaccion(async (cx) => {
    const { rows } = await cx.query(
      `update productos
          set categoria_id = $1, nombre = $2, descripcion = $3, oem = $4,
              precio = $5, imagen_url = $6
        where id = $7
        returning id`,
      [idCategoria || null, nombre, descripcion || null, oem || null, precio, imagenUrl, numero]
    );
    if (!rows[0]) return null;

    // El formulario siempre llega completo (todas las tallas, aunque sea en
    // 0): borrar y reinsertar es más simple y seguro que ir diferenciando
    // qué cambió talla por talla.
    await cx.query('delete from producto_tallas where producto_id = $1', [numero]);
    for (const { talla, stock } of tallasStock) {
      if (stock <= 0) continue;
      await cx.query('insert into producto_tallas (producto_id, talla, stock) values ($1, $2, $3)', [
        numero,
        talla,
        stock,
      ]);
    }
    return numero;
  });
}

/** "Eliminar" un producto es esto: ocultarlo. Nunca se borra la fila, para no perder su historial. */
async function cambiarEstadoProducto(id, estado) {
  const numero = Number(id);
  if (!Number.isInteger(numero)) return null;
  const fila = await db.unaFila('update productos set estado = $1 where id = $2 returning id', [
    Boolean(estado),
    numero,
  ]);
  return fila ? Number(fila.id) : null;
}

// --- Configuración del sitio (tabla clave/valor) -----------------------------

async function obtenerConfiguracion(clave, porDefecto = null) {
  const fila = await db.unaFila('select valor from contenido_sitio where clave = $1', [clave]);
  return fila ? fila.valor : porDefecto;
}

async function guardarConfiguracion(clave, valor) {
  await db.consulta(
    `insert into contenido_sitio (clave, valor) values ($1, $2)
     on conflict (clave) do update set valor = excluded.valor`,
    [clave, String(valor)]
  );
}

// --- Favoritos --------------------------------------------------------------

async function listarFavoritos(usuarioId) {
  if (!usuarioId) return [];
  const filas = await db.consulta(
    `${SELECT_PRODUCTO}
      join favoritos f on f.producto_id = p.id
     where f.usuario_id = $1
     order by f.creado_en desc`,
    [usuarioId]
  );
  return filas.map(aProducto);
}

/** Solo los identificadores: es lo que necesitan las tarjetas para pintar el corazón. */
async function listarFavoritosIds(usuarioId) {
  if (!usuarioId) return [];
  const filas = await db.consulta('select producto_id from favoritos where usuario_id = $1', [usuarioId]);
  return filas.map((f) => Number(f.producto_id));
}

async function alternarFavorito(usuarioId, productoId) {
  const borradas = await db.consulta(
    'delete from favoritos where usuario_id = $1 and producto_id = $2 returning producto_id',
    [usuarioId, productoId]
  );
  if (borradas.length) return false; // estaba, se quitó

  await db.consulta(
    'insert into favoritos (usuario_id, producto_id) values ($1, $2) on conflict do nothing',
    [usuarioId, productoId]
  );
  return true; // no estaba, se añadió
}

/**
 * Pasa a la cuenta los favoritos que el visitante tenía guardados en su
 * navegador. Se usa justo después de iniciar sesión o registrarse.
 *
 * Se fusiona, no se reemplaza: si ya tenía favoritos en la cuenta, se suman.
 * Y solo entran identificadores que correspondan a productos que existen, por
 * si el navegador traía basura o productos ya retirados.
 */
async function fusionarFavoritos(usuarioId, ids) {
  const limpios = [...new Set((ids || []).map(Number).filter(Number.isInteger))];
  if (!limpios.length) return { anadidos: 0 };

  const filas = await db.consulta(
    `insert into favoritos (usuario_id, producto_id)
     select $1, p.id from productos p where p.id = any($2::bigint[])
     on conflict (usuario_id, producto_id) do nothing
     returning producto_id`,
    [usuarioId, limpios]
  );

  return { anadidos: filas.length };
}

/** Productos concretos por identificador. Lo usa la lista de un invitado. */
async function productosPorIds(ids) {
  const limpios = [...new Set((ids || []).map(Number).filter(Number.isInteger))];
  if (!limpios.length) return [];

  const filas = await db.consulta(
    `${SELECT_PRODUCTO} where p.id = any($1::bigint[]) and p.estado = true order by p.id`,
    [limpios]
  );
  return filas.map(aProducto);
}

// --- Pedidos ----------------------------------------------------------------

/**
 * Guarda el pedido y sus líneas dentro de una transacción: un pedido sin sus
 * líneas sería peor que no tener pedido.
 *
 * Las líneas copian nombre y precio del momento de la compra, para que el
 * histórico siga siendo legible aunque el producto cambie o se retire.
 */
async function crearPedido({ cliente, items, total, usuarioId = null }) {
  return db.enTransaccion(async (cx) => {
    const { rows } = await cx.query(
      `insert into pedidos (usuario_id, nombre_cliente, telefono, ciudad, direccion, referencia, total)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id, creado_en`,
      [usuarioId, cliente.nombre, cliente.telefono, cliente.ciudad, cliente.direccion, cliente.referencia || null, total]
    );
    const pedido = rows[0];

    for (const item of items) {
      await cx.query(
        `insert into pedido_lineas (pedido_id, producto_id, nombre_producto, talla, cantidad, precio_unitario)
         values ($1, $2, $3, $4, $5, $6)`,
        [pedido.id, item.productoId, item.nombreProducto, item.talla || null, item.cantidad, item.precio]
      );
    }

    return pedido;
  });
}

/**
 * Pedidos de un usuario concreto, con sus líneas ya incluidas. Es lo que
 * necesita "Mi cuenta": una sola consulta, no una por pedido.
 *
 * json_agg(... order by l.id) mete las líneas ordenadas dentro de cada fila
 * de pedido; si un pedido no tiene líneas (no debería pasar, pero por si
 * acaso) el filtro `l.id is not null` evita un array con un único null.
 */
async function listarPedidosDeUsuario(usuarioId) {
  if (!usuarioId) return [];

  const filas = await db.consulta(
    `select p.id, p.total, p.estado, p.creado_en, p.direccion, p.ciudad, p.referencia,
            coalesce(
              json_agg(
                json_build_object(
                  'nombreProducto', l.nombre_producto,
                  'talla', l.talla,
                  'cantidad', l.cantidad,
                  'precioUnitario', l.precio_unitario,
                  'subtotal', l.subtotal
                ) order by l.id
              ) filter (where l.id is not null),
              '[]'
            ) as lineas
       from pedidos p
       left join pedido_lineas l on l.pedido_id = p.id
      where p.usuario_id = $1
      group by p.id
      order by p.creado_en desc`,
    [usuarioId]
  );

  return filas.map((f) => ({
    id: Number(f.id),
    total: Number(f.total),
    estado: f.estado,
    creadoEn: f.creado_en,
    direccion: f.direccion,
    ciudad: f.ciudad,
    referencia: f.referencia,
    lineas: f.lineas.map((l) => ({
      nombreProducto: l.nombreProducto,
      talla: l.talla,
      cantidad: Number(l.cantidad),
      precioUnitario: Number(l.precioUnitario),
      subtotal: Number(l.subtotal),
    })),
  }));
}

async function listarPedidos(limite = 50) {
  return db.consulta(
    `select p.id, p.nombre_cliente, p.telefono, p.ciudad, p.total, p.estado, p.creado_en,
            count(l.id)::int as lineas
       from pedidos p
       left join pedido_lineas l on l.pedido_id = p.id
      group by p.id
      order by p.creado_en desc
      limit $1`,
    [limite]
  );
}

// --- Panel de administración ------------------------------------------------

// El total real de un producto ya no vive en una columna: hay que sumar
// producto_tallas. `productos.stock` quedó sin uso (ver schema.sql).
const STOCK_TOTAL_SQL = `coalesce((select sum(pt.stock) from producto_tallas pt where pt.producto_id = p.id), 0)`;

async function resumenDashboard() {
  const [totales] = await db.consulta(`
      select
        (select count(*)::int from productos where estado = true)            as total_productos,
        (select count(*)::int from productos p where p.estado = true and ${STOCK_TOTAL_SQL} <= 10) as bajo_stock,
        (select count(*)::int from categorias)                                as total_categorias,
        (select count(*)::int from pedidos)                                   as total_pedidos,
        (select coalesce(sum(total), 0) from pedidos where estado <> 'Cancelado') as ventas
  `);

  const bajoStock = await db.consulta(
    `${SELECT_PRODUCTO}
      where p.estado = true and ${STOCK_TOTAL_SQL} <= 10
      order by ${STOCK_TOTAL_SQL} asc
      limit 10`
  );

  const ultimos = await listarPedidos(5);

  return {
    totalProductos: totales.total_productos,
    productosBajoStock: totales.bajo_stock,
    totalCategorias: totales.total_categorias,
    totalOrdenes: totales.total_pedidos,
    ventasTotales: Number(totales.ventas),
    ultimasOrdenes: ultimos,
    productosConBajoStock: bajoStock.map(aProducto),
  };
}

// --- Usuarios ---------------------------------------------------------------

/**
 * Los usuarios viven en nuestra tabla `usuarios`, no en Supabase Auth: la
 * sesión la maneja la propia app con un JWT en cookie (ver src/auth.js).
 *
 * Nunca se selecciona `password_hash`: no tiene por qué salir de la capa de
 * autenticación, y menos llegar a una plantilla.
 */
async function listarUsuarios() {
  const filas = await db.consulta(`
      select id, email, nombre, telefono, rol, activo, creado_en, ultimo_acceso
        from usuarios
       order by creado_en desc
  `);

  return filas.map((f) => ({
    id: f.id,
    email: f.email,
    // Sin fallback aquí a propósito: el panel lo necesita en limpio para
    // precargar el modal de edición sin arrastrarle el texto de "(sin
    // nombre)" como si fuera el nombre real de la persona. El "(sin
    // nombre)" se pinta solo al mostrarlo, en la plantilla.
    nombre: f.nombre || '',
    telefono: f.telefono || '',
    rol: f.rol,
    activo: f.activo,
    fechaRegistro: f.creado_en,
    ultimoAcceso: f.ultimo_acceso,
  }));
}

module.exports = {
  listarProductos,
  listarTodosLosProductos,
  buscarProducto,
  listarCategorias,
  buscarCategoria,
  crearCategoria,
  actualizarCategoria,
  eliminarCategoria,
  crearProducto,
  actualizarProducto,
  cambiarEstadoProducto,
  obtenerConfiguracion,
  guardarConfiguracion,
  listarFavoritos,
  listarFavoritosIds,
  alternarFavorito,
  fusionarFavoritos,
  productosPorIds,
  crearPedido,
  listarPedidosDeUsuario,
  listarPedidos,
  resumenDashboard,
  listarUsuarios,
};

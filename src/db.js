/*
  Conexión a Postgres (Supabase).

  La cadena va en DATABASE_URL, dentro de .env, que no se sube al repositorio.
  Se usa el "transaction pooler" de Supabase (puerto 6543): mantiene un número
  pequeño de conexiones reales y las reparte, que es lo que conviene cuando la
  app abre y cierra consultas constantemente.

  Detalle del pooler en modo transacción: NO admite sentencias preparadas con
  nombre. Por eso aquí nunca se usa la opción `name` de node-postgres. Las
  consultas con parámetros ($1, $2...) sí funcionan y siguen protegiendo de
  inyección SQL.
*/
const { Pool } = require('pg');

let pool = null;

function hayBaseDeDatos() {
  const url = process.env.DATABASE_URL;
  if (!url) return false;

  // El .env de ejemplo trae un marcador en lugar de la contraseña. Si sigue
  // ahí, es que aún no se ha configurado: mejor caer en los datos de ejemplo
  // que dejar la tienda dando error 500 en todas las páginas.
  if (url.includes('PON_AQUI_TU_PASSWORD') || url.includes('[YOUR-PASSWORD]')) {
    return false;
  }

  return true;
}

function obtenerPool() {
  if (!hayBaseDeDatos()) return null;

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Supabase exige TLS. No se verifica la cadena del certificado porque
      // el pooler presenta uno propio; el cifrado del canal sí se mantiene.
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });

    // Un error en una conexión inactiva no debe tumbar el proceso entero.
    pool.on('error', (err) => {
      console.error('[db] error en una conexión inactiva:', err.message);
    });
  }

  return pool;
}

/**
 * Ejecuta una consulta y devuelve las filas.
 * Los parámetros van siempre como $1, $2… nunca concatenados en el texto.
 */
async function consulta(texto, parametros = []) {
  const p = obtenerPool();
  if (!p) throw new Error('No hay DATABASE_URL configurada.');

  const inicio = Date.now();
  try {
    const resultado = await p.query(texto, parametros);
    const ms = Date.now() - inicio;
    // Las consultas lentas se avisan: es la forma más barata de detectar
    // un índice que falta antes de que lo note un cliente.
    if (ms > 500) console.warn(`[db] consulta lenta (${ms} ms):`, texto.slice(0, 90).replace(/\s+/g, ' '));
    return resultado.rows;
  } catch (error) {
    console.error('[db] falló la consulta:', texto.slice(0, 90).replace(/\s+/g, ' '));
    throw error;
  }
}

/** Igual que `consulta`, pero devuelve la primera fila o null. */
async function unaFila(texto, parametros = []) {
  const filas = await consulta(texto, parametros);
  return filas[0] || null;
}

/**
 * Agrupa varias sentencias en una transacción: o entran todas, o ninguna.
 * Imprescindible al guardar un pedido con sus líneas.
 */
async function enTransaccion(trabajo) {
  const p = obtenerPool();
  if (!p) throw new Error('No hay DATABASE_URL configurada.');

  const cliente = await p.connect();
  try {
    await cliente.query('begin');
    const resultado = await trabajo(cliente);
    await cliente.query('commit');
    return resultado;
  } catch (error) {
    await cliente.query('rollback');
    throw error;
  } finally {
    cliente.release();
  }
}

/** Comprueba que la base responde. Se llama al arrancar. */
async function probarConexion() {
  const fila = await unaFila('select now() as ahora, current_database() as bd');
  return fila;
}

async function cerrar() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { hayBaseDeDatos, obtenerPool, consulta, unaFila, enTransaccion, probarConexion, cerrar };

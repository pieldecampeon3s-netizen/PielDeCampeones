/*
  Autenticación propia: usuarios en nuestra tabla y sesión con JWT en cookie.

  Decisiones y por qué
  --------------------
  * La cookie es httpOnly: JavaScript no puede leerla, así que un fallo de XSS
    en la tienda no se lleva la sesión de nadie.
  * sameSite 'lax': el navegador no manda la cookie en peticiones que vengan
    de otro sitio, que es la defensa básica contra CSRF.
  * El token lleva `ver`, la versión de token del usuario. Se compara con la
    de la base en CADA petición. Subir ese número invalida al instante todas
    las sesiones de esa persona: es lo que un JWT no da por sí mismo.
  * bcrypt para las contraseñas. Mismo formato que usa pgcrypto en Postgres,
    así que los hash creados por SQL y por la app son intercambiables.
*/
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

const COOKIE = 'sesion';
const DURACION = '7d';
const DURACION_MS = 7 * 24 * 60 * 60 * 1000;

// Coste de bcrypt. 12 tarda ~250 ms, que es lento a propósito: encarece
// probar contraseñas a lo bruto sin que se note al iniciar sesión.
const COSTE_BCRYPT = 12;

function secreto() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      'Falta JWT_SECRET en el .env (mínimo 32 caracteres). ' +
        'Sin un secreto largo, cualquiera podría firmar tokens válidos.'
    );
  }
  return s;
}

// --- Contraseñas ------------------------------------------------------------

async function cifrar(contrasena) {
  return bcrypt.hash(contrasena, COSTE_BCRYPT);
}

async function verificarContrasena(contrasena, hash) {
  if (!hash) return false;
  return bcrypt.compare(contrasena, hash);
}

// --- Token ------------------------------------------------------------------

function firmar(usuario) {
  return jwt.sign(
    {
      sub: usuario.id,
      rol: usuario.rol,
      ver: usuario.version_token,
    },
    secreto(),
    { expiresIn: DURACION }
  );
}

function ponerCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    // En producción (HTTPS) la cookie solo viaja cifrada.
    secure: process.env.NODE_ENV === 'production',
    maxAge: DURACION_MS,
    path: '/',
  });
}

function quitarCookie(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

// --- Usuarios ---------------------------------------------------------------

async function buscarPorEmail(email) {
  return db.unaFila(
    `select id, email, password_hash, nombre, telefono, rol, version_token, activo
       from usuarios where lower(email) = lower($1)`,
    [String(email || '').trim()]
  );
}

async function buscarPorId(id) {
  return db.unaFila(
    `select id, email, nombre, telefono, rol, version_token, activo
       from usuarios where id = $1`,
    [id]
  );
}

async function registrar({ email, contrasena, nombre, telefono }) {
  const limpio = String(email || '').trim().toLowerCase();

  if (await buscarPorEmail(limpio)) {
    return { ok: false, mensaje: 'Ya existe una cuenta con ese correo.' };
  }

  const hash = await cifrar(contrasena);
  const usuario = await db.unaFila(
    `insert into usuarios (email, password_hash, nombre, telefono)
     values ($1, $2, $3, $4)
     returning id, email, nombre, telefono, rol, version_token, activo`,
    [limpio, hash, nombre || null, telefono || null]
  );

  return { ok: true, usuario };
}

async function iniciarSesion(email, contrasena) {
  const usuario = await buscarPorEmail(email);

  /*
    Mismo mensaje para "no existe" y "contraseña incorrecta". Distinguirlos
    permitiría averiguar qué correos están registrados probando uno a uno.
  */
  const generico = 'Correo o contraseña incorrectos.';

  if (!usuario) {
    // Se compara igualmente contra un hash falso para tardar lo mismo que en
    // el caso real: si no, el tiempo de respuesta delataría qué correos
    // existen, justo lo que el mensaje genérico intenta ocultar.
    await bcrypt.compare(contrasena, '$2a$12$invalidoinvalidoinvalidoinvalidoinvalidoinvalidoinvalid');
    return { ok: false, mensaje: generico };
  }

  if (!usuario.activo) {
    return { ok: false, mensaje: 'Esta cuenta está desactivada.' };
  }

  if (!(await verificarContrasena(contrasena, usuario.password_hash))) {
    return { ok: false, mensaje: generico };
  }

  await db.consulta('update usuarios set ultimo_acceso = now() where id = $1', [usuario.id]);

  return { ok: true, usuario, token: firmar(usuario) };
}

/** Invalida todas las sesiones abiertas de un usuario. */
async function cerrarTodasLasSesiones(usuarioId) {
  await db.consulta('update usuarios set version_token = version_token + 1 where id = $1', [usuarioId]);
}

async function cambiarContrasena(usuarioId, nueva) {
  const hash = await cifrar(nueva);
  // Cambiar la contraseña echa al resto de dispositivos: si alguien te la
  // había robado, deja de tener acceso en ese mismo momento.
  await db.consulta(
    'update usuarios set password_hash = $1, version_token = version_token + 1 where id = $2',
    [hash, usuarioId]
  );
}

/** Nombre y teléfono desde "Mi cuenta". No toca el correo ni la contraseña. */
async function actualizarPerfil(usuarioId, { nombre, telefono }) {
  return db.unaFila(
    `update usuarios set nombre = $1, telefono = $2 where id = $3
     returning id, email, nombre, telefono, rol, version_token, activo`,
    [nombre || null, telefono || null, usuarioId]
  );
}

// --- Panel de administración: gestión de usuarios ----------------------------

/**
 * Todo lo editable de un usuario desde el panel, en una sola actualización:
 * nombre, teléfono, rol y si la cuenta está activa. La contraseña va aparte
 * (ver cambiarContrasena) porque solo se toca si el admin escribió una nueva.
 *
 * No hace falta subir version_token por el rol/estado aparte: `esAdmin` se
 * calcula de la fila real en cada petición (cargarSesion), no del JWT, así
 * que un ascenso, un descenso o una desactivación ya surten efecto en la
 * siguiente petición de esa persona sin tener que hacer nada más — salvo
 * cuando cambia la contraseña, que si sigue con sesión abierta en otro sitio
 * conviene echarla de ahí también (eso lo hace cambiarContrasena).
 */
async function actualizarUsuarioAdmin(usuarioId, { nombre, telefono, rol, activo }) {
  if (rol !== 'Cliente' && rol !== 'Administrador') {
    throw new Error('Rol inválido: ' + rol);
  }
  return db.unaFila(
    `update usuarios set nombre = $1, telefono = $2, rol = $3, activo = $4
      where id = $5
      returning id, email, nombre, telefono, rol, activo`,
    [nombre || null, telefono || null, rol, Boolean(activo), usuarioId]
  );
}

// --- Middleware -------------------------------------------------------------

/**
 * Lee la cookie y deja el usuario en req.usuario y res.locals.usuario.
 * No bloquea: las páginas públicas siguen funcionando sin sesión.
 */
function cargarSesion() {
  return async (req, res, next) => {
    // Se dejan siempre definidos, aunque no haya sesión: las plantillas los
    // usan sin comprobar (`<% if (esAdmin) %>`) y un valor ausente rompería
    // la página entera para cualquier visitante anónimo.
    res.locals.usuario = null;
    res.locals.esAdmin = false;
    req.usuario = null;

    const token = req.cookies && req.cookies[COOKIE];
    if (!token || !db.hayBaseDeDatos()) return next();

    try {
      const datos = jwt.verify(token, secreto());
      const usuario = await buscarPorId(datos.sub);

      // El token puede ser válido y aun así no servir: cuenta borrada,
      // desactivada, o sesiones revocadas subiendo la versión.
      if (!usuario || !usuario.activo || usuario.version_token !== datos.ver) {
        quitarCookie(res);
        return next();
      }

      req.usuario = usuario;
      res.locals.usuario = usuario;
      res.locals.esAdmin = usuario.rol === 'Administrador';
    } catch (error) {
      // Token caducado o manipulado: fuera la cookie y a seguir como invitado.
      quitarCookie(res);
    }

    next();
  };
}

/** Exige sesión iniciada. */
function exigirSesion(req, res, next) {
  sinCache(res);

  if (!req.usuario) {
    const destino = encodeURIComponent(req.originalUrl);
    return res.redirect(`/account/login?volver=${destino}`);
  }
  next();
}

/*
  Impide que el navegador guarde en caché una página con sesión.

  Sin esto, quien cierra sesión (o a quien se le revoca) puede pulsar "atrás"
  y seguir viendo el panel: la página sale de la caché sin preguntar al
  servidor. En un ordenador compartido eso es una fuga de datos.
*/
function sinCache(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
}

/** Exige rol de administrador. */
function exigirAdmin(req, res, next) {
  sinCache(res);

  if (!req.usuario) {
    const destino = encodeURIComponent(req.originalUrl);
    return res.redirect(`/account/login?volver=${destino}`);
  }
  if (req.usuario.rol !== 'Administrador') {
    return res.status(403).render('account/acceso-denegado', { title: 'Acceso denegado' });
  }
  next();
}

module.exports = {
  COOKIE,
  cifrar,
  verificarContrasena,
  firmar,
  ponerCookie,
  quitarCookie,
  buscarPorEmail,
  buscarPorId,
  registrar,
  iniciarSesion,
  cerrarTodasLasSesiones,
  cambiarContrasena,
  actualizarPerfil,
  actualizarUsuarioAdmin,
  cargarSesion,
  sinCache,
  exigirSesion,
  exigirAdmin,
};

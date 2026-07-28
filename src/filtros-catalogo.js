// Lógica de filtrado del catálogo, separada del servidor para poder probarla
// sola y para que la migración a Supabase sea un cambio localizado: cuando los
// productos vengan de la base de datos, `aplicar` se traduce a un WHERE.

const ORDENADORES = {
  'nombre-asc': (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
  'precio-asc': (a, b) => a.precio - b.precio,
  'precio-desc': (a, b) => b.precio - a.precio,
  'novedades': (a, b) => String(b.fechaIngreso).localeCompare(String(a.fechaIngreso)),
};

const ETIQUETAS_ORDEN = {
  'nombre-asc': 'Nombre A-Z',
  'precio-asc': 'Precio: menor a mayor',
  'precio-desc': 'Precio: mayor a menor',
  'novedades': 'Novedades',
};

// "Selección" y "seleccion" deben encontrarse igual: quitamos acentos.
const normalizar = (texto) =>
  String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // marcas diacriticas que deja NFD
    .toLowerCase();

// Redondea a miles para que el deslizador se mueva en pasos limpios.
const pisoMil = (n) => Math.floor(n / 1000) * 1000;
const techoMil = (n) => Math.ceil(n / 1000) * 1000;

function rangoPrecios(productos) {
  if (!productos.length) return { min: 0, max: 0 };
  const precios = productos.map((p) => p.precio);
  return { min: pisoMil(Math.min(...precios)), max: techoMil(Math.max(...precios)) };
}

// Un query string puede traer ?categoria=A&categoria=B (array) o uno solo
// (string). Normalizamos siempre a array.
const comoLista = (valor) => (valor === undefined ? [] : [].concat(valor).filter(Boolean));

function leerFiltros(query, productos) {
  const rango = rangoPrecios(productos);

  const aNumero = (valor, porDefecto) => {
    const n = Number(valor);
    return Number.isFinite(n) && String(valor).trim() !== '' ? n : porDefecto;
  };

  // Se recortan al rango real y se ordenan, para que un ?min mayor que ?max
  // manipulado a mano no devuelva cero resultados sin explicación.
  let min = Math.max(rango.min, Math.min(rango.max, aNumero(query.min, rango.min)));
  let max = Math.max(rango.min, Math.min(rango.max, aNumero(query.max, rango.max)));
  if (min > max) [min, max] = [max, min];

  return {
    categorias: comoLista(query.categoria),
    busqueda: String(query.q || '').trim(),
    min,
    max,
    soloDisponibles: query.disponible === '1',
    orden: ORDENADORES[query.orden] ? query.orden : 'nombre-asc',
  };
}

function aplicar(productos, filtros) {
  let resultado = productos;

  if (filtros.categorias.length) {
    const buscadas = filtros.categorias.map(normalizar);
    resultado = resultado.filter((p) => buscadas.includes(normalizar(p.nombreCategoria)));
  }

  if (filtros.busqueda) {
    // Cada palabra debe aparecer en algún campo: "retro brasil" encuentra
    // "Selección Brasil Retro" aunque el orden no coincida.
    const palabras = normalizar(filtros.busqueda).split(/\s+/).filter(Boolean);
    resultado = resultado.filter((p) => {
      const texto = normalizar(`${p.nombre} ${p.nombreCategoria} ${p.oem} ${p.descripcion}`);
      return palabras.every((palabra) => texto.includes(palabra));
    });
  }

  resultado = resultado.filter((p) => p.precio >= filtros.min && p.precio <= filtros.max);

  if (filtros.soloDisponibles) {
    resultado = resultado.filter((p) => p.stock > 0);
  }

  return [...resultado].sort(ORDENADORES[filtros.orden]);
}

// Cuántos productos quedarían por categoría con el resto de filtros aplicados.
// Sirve para mostrar "Retro (2)" y para desactivar las que no dan resultados,
// que es lo que evita que el usuario llegue a una lista vacía.
function conteoPorCategoria(productos, filtros) {
  const sinCategorias = { ...filtros, categorias: [] };
  const base = aplicar(productos, sinCategorias);

  const conteo = {};
  for (const p of productos) conteo[p.nombreCategoria] = 0;
  for (const p of base) conteo[p.nombreCategoria] += 1;
  return conteo;
}

// Filtros activos como fichas que el usuario puede quitar una a una.
function fichasActivas(filtros, rango, formatearPrecio) {
  const fichas = [];

  if (filtros.busqueda) {
    fichas.push({ tipo: 'q', valor: '', etiqueta: `"${filtros.busqueda}"` });
  }

  for (const categoria of filtros.categorias) {
    fichas.push({ tipo: 'categoria', valor: categoria, etiqueta: categoria });
  }

  if (filtros.min > rango.min || filtros.max < rango.max) {
    fichas.push({
      tipo: 'precio',
      valor: '',
      etiqueta: `${formatearPrecio(filtros.min)} – ${formatearPrecio(filtros.max)}`,
    });
  }

  if (filtros.soloDisponibles) {
    fichas.push({ tipo: 'disponible', valor: '', etiqueta: 'Solo disponibles' });
  }

  return fichas;
}

const hayFiltros = (filtros, rango) =>
  Boolean(
    filtros.categorias.length ||
      filtros.busqueda ||
      filtros.soloDisponibles ||
      filtros.min > rango.min ||
      filtros.max < rango.max
  );

module.exports = {
  ORDENADORES,
  ETIQUETAS_ORDEN,
  rangoPrecios,
  leerFiltros,
  aplicar,
  conteoPorCategoria,
  fichasActivas,
  hayFiltros,
  normalizar,
};

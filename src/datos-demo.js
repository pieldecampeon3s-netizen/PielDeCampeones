// Datos de ejemplo para poder ver las vistas mientras no exista la base de datos.
// Cuando conectes Supabase, reemplaza este módulo por consultas reales:
// los nombres de las propiedades son exactamente los que esperan las plantillas.

const categorias = [
  { id: 1, nombre: 'Clubes Europeos', descripcion: 'Camisetas de los clubes más grandes de Europa.' },
  { id: 2, nombre: 'Selecciones', descripcion: 'Camisetas de selecciones nacionales.' },
  { id: 3, nombre: 'Retro', descripcion: 'Ediciones clásicas y de colección.' },
  { id: 4, nombre: 'Clubes Colombianos', descripcion: 'Equipos del fútbol profesional colombiano.' },
  { id: 5, nombre: 'Ediciones Especiales', descripcion: 'Lanzamientos limitados.' },
];

// Tallas que se manejan en la tienda. Coinciden con la guía de tallas de la
// portada (views/home/index.ejs). Cada producto declara cuáles tiene.
const TALLAS = ['S', 'M', 'L', 'XL', '2XL'];

const productos = [
  {
    id: 1,
    nombre: 'Real Madrid Local 2024/25',
    oem: 'ADI-RM-2425',
    precio: 189000,
    stock: 24,
    tallas: ['S', 'M', 'L', 'XL', '2XL'],
    descripcion: 'Camiseta local del Real Madrid, temporada 2024/25. Tejido transpirable.',
    imagenUrl: '/images/REAL.jpg',
    idCategoria: 1,
    nombreCategoria: 'Clubes Europeos',
    estado: true,
    fechaIngreso: '2025-11-02',
  },
  {
    id: 2,
    nombre: 'FC Barcelona Local 2024/25',
    oem: 'NIK-FCB-2425',
    precio: 185000,
    stock: 18,
    tallas: ['S', 'M', 'L', 'XL'],
    descripcion: 'Camiseta local del FC Barcelona con los colores blaugrana clásicos.',
    imagenUrl: '/images/BARCA3.jpg',
    idCategoria: 1,
    nombreCategoria: 'Clubes Europeos',
    estado: true,
    fechaIngreso: '2025-11-02',
  },
  {
    id: 3,
    nombre: 'Selección Colombia Retro',
    oem: 'COL-RETRO-90',
    precio: 165000,
    stock: 7,
    tallas: ['M', 'L', 'XL'],
    descripcion: 'Réplica retro de la Selección Colombia. Edición de colección.',
    imagenUrl: '/images/ColombiaR.jpeg',
    idCategoria: 3,
    nombreCategoria: 'Retro',
    estado: true,
    fechaIngreso: '2025-12-10',
  },
  {
    id: 4,
    nombre: 'Liverpool FC Local',
    oem: 'NIK-LFC-2425',
    precio: 179000,
    stock: 12,
    tallas: ['S', 'M', 'L', 'XL', '2XL'],
    descripcion: 'Camiseta local del Liverpool FC, rojo característico de Anfield.',
    imagenUrl: '/images/LIVERPOL.jpg',
    idCategoria: 1,
    nombreCategoria: 'Clubes Europeos',
    estado: true,
    fechaIngreso: '2026-01-15',
  },
  {
    id: 5,
    nombre: 'Paris Saint-Germain Local',
    oem: 'NIK-PSG-2425',
    precio: 195000,
    stock: 4,
    tallas: ['M', 'L', 'XL'],
    descripcion: 'Camiseta local del PSG con la banda central Hechter.',
    imagenUrl: '/images/PSG.jpg',
    idCategoria: 1,
    nombreCategoria: 'Clubes Europeos',
    estado: true,
    fechaIngreso: '2026-02-01',
  },
  {
    id: 6,
    nombre: 'Juventus Local',
    oem: 'ADI-JUV-2425',
    precio: 175000,
    stock: 0,
    tallas: [],
    descripcion: 'Camiseta local de la Juventus, franjas blanquinegras.',
    imagenUrl: '/images/JUVENTUS.jpg',
    idCategoria: 1,
    nombreCategoria: 'Clubes Europeos',
    estado: true,
    fechaIngreso: '2026-03-08',
  },
  {
    id: 7,
    nombre: 'Selección Brasil Retro',
    oem: 'BRA-RETRO-70',
    precio: 172000,
    stock: 9,
    tallas: ['S', 'M', 'L'],
    descripcion: 'Amarillo canarinho clásico. Edición retro de colección.',
    imagenUrl: '/images/BrazilR.jpeg',
    idCategoria: 2,
    nombreCategoria: 'Selecciones',
    estado: true,
    fechaIngreso: '2026-04-20',
  },
  {
    id: 8,
    nombre: 'Inter de Milán Local',
    oem: 'NIK-INT-2425',
    precio: 178000,
    stock: 15,
    tallas: ['S', 'M', 'L', 'XL', '2XL'],
    descripcion: 'Camiseta local del Inter, nerazzurri.',
    imagenUrl: '/images/INTER.jpg',
    idCategoria: 1,
    nombreCategoria: 'Clubes Europeos',
    estado: true,
    fechaIngreso: '2026-05-11',
  },
];

const usuarios = [
  {
    id: 'a1b2c3d4-0000-4000-8000-000000000001',
    userName: 'admin@pieldecampeon.com',
    email: 'admin@pieldecampeon.com',
    roles: ['Administrador'],
  },
  {
    id: 'a1b2c3d4-0000-4000-8000-000000000002',
    userName: 'cliente@pieldecampeon.com',
    email: 'cliente@pieldecampeon.com',
    roles: ['Usuario'],
  },
  {
    id: 'a1b2c3d4-0000-4000-8000-000000000003',
    userName: 'invitado@pieldecampeon.com',
    email: 'invitado@pieldecampeon.com',
    roles: [],
  },
];

// Igual que hace el reparto real contra la base de datos: mismo total, un
// número por talla, para que las plantillas tengan algo real que recorrer
// aunque no haya DATABASE_URL configurada.
productos.forEach((p) => {
  const tallas = p.tallas || [];
  if (!tallas.length) {
    p.tallasStock = [];
    return;
  }
  const base = Math.floor(p.stock / tallas.length);
  const resto = p.stock % tallas.length;
  p.tallasStock = tallas.map((talla, i) => ({ talla, stock: base + (i < resto ? 1 : 0) }));
});

module.exports = {
  categorias,
  productos,
  usuarios,
  TALLAS,

  listarProductos() {
    return productos.filter((p) => p.estado);
  },

  buscarProducto(id) {
    return productos.find((p) => p.id === Number(id)) || null;
  },

  buscarCategoria(id) {
    return categorias.find((c) => c.id === Number(id)) || null;
  },

  resumenDashboard() {
    const activos = productos.filter((p) => p.estado);
    return {
      totalProductos: activos.length,
      productosBajoStock: activos.filter((p) => p.stock <= 10).length,
      totalCategorias: categorias.length,
      totalOrdenes: 0,
      ventasTotales: 0,
      ultimasOrdenes: [],
      productosConBajoStock: activos.filter((p) => p.stock <= 10),
    };
  },
};

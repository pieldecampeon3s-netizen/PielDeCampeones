// Reemplazo de los .ToString("C0") / .ToString("N2") de Razor.
// Se exponen como app.locals para que estén disponibles en todas las vistas.

const cop = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

const numero = new Intl.NumberFormat('es-CO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

module.exports = {
  formatCOP: (valor) => cop.format(Number(valor) || 0),
  formatNumero: (valor) => numero.format(Number(valor) || 0),
};

// Espera a que el documento esté listo
document.addEventListener('DOMContentLoaded', function () {

    const esMovil = window.matchMedia('(max-width: 767.98px)').matches;
    const menosMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Si AOS no cargó, los elementos con data-aos se quedarían invisibles
    // (su CSS los pone a opacity:0). Los mostramos y salimos sin lanzar error.
    if (typeof AOS === 'undefined') {
        document.querySelectorAll('[data-aos]').forEach(el => el.removeAttribute('data-aos'));
        return;
    }

    // Si el sistema pide reducir movimiento, mostramos todo sin animar.
    if (menosMovimiento) {
        document.querySelectorAll('[data-aos]').forEach(el => el.removeAttribute('data-aos'));
        return;
    }

    // "fade-left"/"fade-right" desplazan el elemento 100px en horizontal antes de
    // dispararse. En escritorio se ve bien, pero en móvil eso provoca scroll
    // lateral, así que ahí los convertimos en una entrada vertical.
    if (esMovil) {
        document.querySelectorAll('[data-aos="fade-left"], [data-aos="fade-right"]')
            .forEach(el => el.setAttribute('data-aos', 'fade-up'));
    }

    // Inicializa la librería AOS con configuraciones recomendadas
    AOS.init({
        duration: esMovil ? 500 : 800,  // en móvil, animaciones más cortas
        easing: 'ease-in-out-quad',     // Curva de aceleración para un efecto suave
        once: true,                     // La animación solo ocurre una vez por elemento
        offset: esMovil ? 40 : 100,     // margen antes de disparar la animación
    });

});
/*
  Selector de cantidad de la ficha de producto.

  Los botones de − y + evitan tener que escribir el número, que en un teclado
  de móvil es incómodo, y hacen evidente el tope: al llegar al stock el + se
  desactiva en vez de dejar seguir y fallar al enviar.

  Esto es comodidad, no seguridad: el servidor comprueba el stock igualmente en
  /carrito/agregar. Cualquiera puede enviar un POST saltándose esta página.
*/
(function () {
    'use strict';

    const selector = document.querySelector('.selector-cantidad');
    if (!selector) return;

    const campo = selector.querySelector('.cantidad-valor');
    const botones = selector.querySelectorAll('.cantidad-btn');
    const aviso = selector.querySelector('.aviso-stock');
    const radiosTalla = document.querySelectorAll('.talla-radio');

    // Cada talla tiene su propio stock: 2 en M, 12 en L. `stock` cambia según
    // cuál se elija (ver el listener de más abajo); mientras no haya ninguna
    // seleccionada, se parte del total del producto.
    let stock = Number(selector.dataset.stock) || 0;
    if (stock <= 0 && !radiosTalla.length) return; // agotado y sin tallas: no hay nada que ajustar

    // Mensaje base: se restaura cuando el aviso deja de ser un error.
    const mensajeBase = aviso ? aviso.textContent.trim() : '';

    function leer() {
        const n = parseInt(campo.value, 10);
        return Number.isInteger(n) ? n : 1;
    }

    /**
     * Fija la cantidad respetando los límites y actualiza los botones.
     * Devuelve si hubo que recortar el valor pedido.
     */
    function fijar(valor) {
        const limitado = Math.min(Math.max(valor, 1), stock);
        campo.value = limitado;

        // Los extremos se desactivan: se ve que no hay a dónde seguir, en vez
        // de dejar pulsar sin que pase nada.
        botones.forEach(function (boton) {
            const paso = Number(boton.dataset.paso);
            boton.disabled = paso < 0 ? limitado <= 1 : limitado >= stock;
        });

        return limitado !== valor;
    }

    function avisar(texto, esTope) {
        if (!aviso) return;
        aviso.textContent = texto;
        aviso.classList.toggle('tope-alcanzado', Boolean(esTope));
    }

    // --- Botones -----------------------------------------------------------

    botones.forEach(function (boton) {
        boton.addEventListener('click', function () {
            const paso = Number(boton.dataset.paso);
            const recortado = fijar(leer() + paso);

            if (recortado && paso > 0) {
                avisar(`Solo hay ${stock} unidades disponibles`, true);
            } else {
                avisar(mensajeBase, false);
            }
        });
    });

    // --- Escritura a mano ---------------------------------------------------

    campo.addEventListener('input', function () {
        // Mientras escribe no se corrige: hacerlo a cada tecla impide teclear
        // "12" porque el 1 se validaría antes de llegar al 2.
        const n = parseInt(campo.value, 10);
        if (Number.isInteger(n) && n > stock) {
            avisar(`Solo hay ${stock} unidades disponibles`, true);
        } else {
            avisar(mensajeBase, false);
        }
    });

    // Al salir del campo sí se ajusta: es cuando el valor cuenta.
    campo.addEventListener('blur', function () {
        const recortado = fijar(leer());
        if (recortado) avisar(`Ajustado a ${campo.value}: es todo el stock disponible`, true);
    });

    // Enter no debe enviar el formulario con un valor fuera de rango.
    campo.addEventListener('keydown', function (evento) {
        if (evento.key === 'Enter') {
            evento.preventDefault();
            fijar(leer());
        }
    });

    // Al elegir una talla, el tope pasa a ser el stock de ESA talla, no el
    // total del producto: 2 en M no significa que se puedan pedir 12 solo
    // porque en total (con la L) haya más.
    radiosTalla.forEach(function (radio) {
        radio.addEventListener('change', function () {
            stock = Number(radio.dataset.stock) || 0;
            campo.max = stock;
            campo.value = 1;
            fijar(1);
            // Mensaje propio de la talla recién elegida, no el que traía la
            // página al cargar (ese hablaba del total del producto).
            avisar(stock > 0 && stock <= 10 ? `Quedan ${stock} unidades` : '', false);
        });
    });

    // Estado inicial coherente (deja el − desactivado con la cantidad en 1).
    fijar(leer());
})();

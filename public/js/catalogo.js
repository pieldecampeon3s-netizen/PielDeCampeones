/*
  Filtrado del catálogo sin recargar la página.

  Es una mejora progresiva: el <form> del panel funciona por sí solo con GET.
  Si hay JavaScript, aquí interceptamos los cambios, pedimos solo el fragmento
  de resultados y lo sustituimos, manteniendo la URL sincronizada para que
  siga siendo compartible y el botón "atrás" funcione.
*/
(function () {
    'use strict';

    const form = document.getElementById('formFiltros');
    const contenedor = document.getElementById('resultadosCatalogo');
    if (!form || !contenedor) return; // no estamos en el catálogo

    // Dónde vive la tienda. Hoy es la portada ("/"), pero se lee del formulario
    // para no tener la ruta escrita en dos sitios.
    const RUTA_TIENDA = form.getAttribute('action') || '/';

    const selectorOrden = document.getElementById('selectorOrden');
    const campoOrden = form.querySelector('input[name="orden"]');
    const campoBusqueda = document.getElementById('campoBusqueda');
    const botonBorrarBusqueda = form.querySelector('.borrar-busqueda');
    const precioMin = document.getElementById('precioMin');
    const precioMax = document.getElementById('precioMax');
    const relleno = document.getElementById('rangoRelleno');
    const precioActual = document.getElementById('precioActual');

    const formatCOP = new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0,
    });

    let peticionEnCurso = null;
    let temporizador = null;

    // --- Rango de precio ----------------------------------------------------

    // Los dos deslizadores están superpuestos: hay que impedir que se crucen.
    function normalizarRango(movido) {
        const min = Number(precioMin.value);
        const max = Number(precioMax.value);
        const paso = Number(precioMin.step) || 1000;

        if (min > max - paso) {
            if (movido === precioMin) precioMin.value = max - paso;
            else precioMax.value = min + paso;
        }
    }

    function pintarRango() {
        if (!precioMin || !relleno) return;

        const tope = Number(precioMin.max);
        const suelo = Number(precioMin.min);
        const recorrido = tope - suelo || 1;

        const desde = ((Number(precioMin.value) - suelo) / recorrido) * 100;
        const hasta = ((Number(precioMax.value) - suelo) / recorrido) * 100;

        relleno.style.left = desde + '%';
        relleno.style.width = (hasta - desde) + '%';

        precioActual.textContent =
            formatCOP.format(precioMin.value) + ' – ' + formatCOP.format(precioMax.value);
    }

    // --- Construir la URL ---------------------------------------------------

    function urlActual() {
        const datos = new FormData(form);
        const params = new URLSearchParams();

        for (const [clave, valor] of datos.entries()) {
            if (valor === '' || valor === null) continue;
            params.append(clave, valor);
        }

        // Un rango que abarca todo el catálogo no aporta nada a la URL.
        const suelo = precioMin ? precioMin.min : null;
        const tope = precioMax ? precioMax.max : null;
        if (params.get('min') === suelo) params.delete('min');
        if (params.get('max') === tope) params.delete('max');
        if (params.get('orden') === 'nombre-asc') params.delete('orden');

        const cadena = params.toString();
        // La dirección sale del propio formulario: así, si la tienda cambia de
        // sitio, no hay que tocar este archivo.
        return RUTA_TIENDA + (cadena ? '?' + cadena : '');
    }

    // --- Aplicar filtros ----------------------------------------------------

    async function aplicar({ empujarHistorial = true } = {}) {
        const url = urlActual();

        contenedor.setAttribute('aria-busy', 'true');

        // Si el usuario sigue tocando, la respuesta anterior ya no interesa.
        if (peticionEnCurso) peticionEnCurso.abort();
        peticionEnCurso = new AbortController();

        try {
            const respuesta = await fetch(url + (url.includes('?') ? '&' : '?') + 'parcial=1', {
                headers: { 'X-Peticion-Parcial': '1' },
                signal: peticionEnCurso.signal,
            });
            if (!respuesta.ok) throw new Error('HTTP ' + respuesta.status);

            const html = await respuesta.text();
            contenedor.innerHTML = html;

            actualizarContadores();

            if (empujarHistorial) history.pushState({ catalogo: true }, '', url);
        } catch (error) {
            if (error.name === 'AbortError') return; // la sustituyó otra petición
            // Si falla la red, recargamos de la forma clásica en vez de dejar
            // al usuario con unos filtros que no hacen nada.
            console.error('No se pudo filtrar sin recargar:', error);
            window.location.href = url;
        } finally {
            contenedor.setAttribute('aria-busy', 'false');
            peticionEnCurso = null;
        }
    }

    // Escribir en el buscador no debe disparar una petición por tecla.
    function aplicarConEspera(ms) {
        clearTimeout(temporizador);
        temporizador = setTimeout(() => aplicar(), ms);
    }

    // --- Contadores ---------------------------------------------------------

    function actualizarContadores() {
        // El número de resultados sale del propio fragmento recibido.
        const tarjetas = contenedor.querySelectorAll('.product-card').length;

        document.querySelectorAll('[data-contador-resultados]').forEach((el) => {
            el.textContent = tarjetas;
        });

        const etiqueta = document.querySelector('[data-etiqueta-resultados]');
        if (etiqueta) etiqueta.textContent = tarjetas === 1 ? 'camiseta' : 'camisetas';

        // Cuántos filtros hay puestos, para la burbuja del botón "Filtros".
        const activos =
            form.querySelectorAll('input[name="categoria"]:checked').length +
            (campoBusqueda && campoBusqueda.value.trim() ? 1 : 0) +
            (form.querySelector('#soloDisponibles:checked') ? 1 : 0) +
            (precioMin && (precioMin.value !== precioMin.min || precioMax.value !== precioMax.max) ? 1 : 0);

        document.querySelectorAll('[data-contador-filtros]').forEach((el) => {
            el.textContent = activos;
            el.classList.toggle('d-none', activos === 0);
        });

        if (botonBorrarBusqueda && campoBusqueda) {
            botonBorrarBusqueda.classList.toggle('d-none', !campoBusqueda.value);
        }
    }

    // --- Limpiar ------------------------------------------------------------

    function limpiarTodo() {
        form.querySelectorAll('input[name="categoria"]').forEach((c) => (c.checked = false));
        if (campoBusqueda) campoBusqueda.value = '';
        const stock = form.querySelector('#soloDisponibles');
        if (stock) stock.checked = false;
        if (precioMin) {
            precioMin.value = precioMin.min;
            precioMax.value = precioMax.max;
            pintarRango();
        }
        aplicar();
    }

    function quitarFiltro(tipo, valor) {
        if (tipo === 'q' && campoBusqueda) campoBusqueda.value = '';

        if (tipo === 'categoria') {
            const casilla = [...form.querySelectorAll('input[name="categoria"]')].find(
                (c) => c.value === valor
            );
            if (casilla) casilla.checked = false;
        }

        if (tipo === 'precio' && precioMin) {
            precioMin.value = precioMin.min;
            precioMax.value = precioMax.max;
            pintarRango();
        }

        if (tipo === 'disponible') {
            const stock = form.querySelector('#soloDisponibles');
            if (stock) stock.checked = false;
        }

        aplicar();
    }

    // --- Eventos ------------------------------------------------------------

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        aplicar();
    });

    form.addEventListener('change', (e) => {
        if (e.target.type === 'range') return; // el rango se trata aparte
        aplicar();
    });

    if (campoBusqueda) {
        campoBusqueda.addEventListener('input', () => {
            if (botonBorrarBusqueda) {
                botonBorrarBusqueda.classList.toggle('d-none', !campoBusqueda.value);
            }
            aplicarConEspera(350);
        });
    }

    if (botonBorrarBusqueda) {
        botonBorrarBusqueda.addEventListener('click', () => {
            campoBusqueda.value = '';
            botonBorrarBusqueda.classList.add('d-none');
            campoBusqueda.focus();
            aplicar();
        });
    }

    if (precioMin && precioMax) {
        [precioMin, precioMax].forEach((deslizador) => {
            // input: repinta mientras se arrastra (sin pedir nada al servidor)
            deslizador.addEventListener('input', () => {
                normalizarRango(deslizador);
                pintarRango();
            });
            // change: al soltar, ya sí filtramos
            deslizador.addEventListener('change', () => {
                normalizarRango(deslizador);
                pintarRango();
                aplicar();
            });
        });
        pintarRango();
    }

    if (selectorOrden && campoOrden) {
        selectorOrden.addEventListener('change', () => {
            campoOrden.value = selectorOrden.value;
            aplicar();
        });
    }

    // Las fichas y los botones de limpiar se recrean en cada actualización,
    // así que se escuchan por delegación desde un contenedor que no cambia.
    document.addEventListener('click', (e) => {
        const limpiar = e.target.closest('[data-limpiar-filtros]');
        if (limpiar) {
            limpiarTodo();
            return;
        }

        const ficha = e.target.closest('[data-quitar-filtro]');
        if (ficha) {
            quitarFiltro(ficha.dataset.quitarFiltro, ficha.dataset.valor);
        }
    });

    const limpiarMovil = document.getElementById('limpiarFiltrosMovil');
    if (limpiarMovil) limpiarMovil.addEventListener('click', limpiarTodo);

    // --- Hoja para elegir talla desde la rejilla ----------------------------

    const hoja = document.getElementById('hojaTallas');
    if (hoja) {
        const opciones = document.getElementById('hojaTallasOpciones');
        const aviso = document.getElementById('hojaAviso');
        const confirmar = document.getElementById('hojaConfirmar');
        let productoActual = null;

        // Los botones se recrean al filtrar: delegación otra vez.
        document.addEventListener('click', (e) => {
            const boton = e.target.closest('.elegir-talla-btn');
            if (!boton) return;

            productoActual = boton.dataset.productoId;

            document.getElementById('hojaImagen').src = boton.dataset.imagen;
            document.getElementById('hojaImagen').alt = boton.dataset.nombre;
            document.getElementById('hojaNombre').textContent = boton.dataset.nombre;
            document.getElementById('hojaPrecio').textContent = boton.dataset.precio;

            const tallasStock = JSON.parse(boton.dataset.tallasStock || '[]');
            opciones.innerHTML = tallasStock
                .map(
                    (t) =>
                        `<input type="radio" class="talla-radio" name="tallaHoja" id="hoja-${t.talla}" value="${t.talla}" ${t.stock <= 0 ? 'disabled' : ''}>` +
                        `<label class="talla-opcion${t.stock <= 0 ? ' talla-agotada' : ''}" for="hoja-${t.talla}">${t.talla}</label>`
                )
                .join('');

            aviso.hidden = true;
            bootstrap.Offcanvas.getOrCreateInstance(hoja).show();
        });

        confirmar.addEventListener('click', async () => {
            const marcada = opciones.querySelector('input:checked');
            if (!marcada) {
                aviso.hidden = false;
                return;
            }

            confirmar.disabled = true;
            try {
                const res = await fetch('/carrito/agregar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        productoId: productoActual,
                        cantidad: 1,
                        talla: marcada.value,
                    }),
                });
                const datos = await res.json();

                if (datos.success) {
                    bootstrap.Offcanvas.getOrCreateInstance(hoja).hide();
                    if (typeof window.updateCartCount === 'function') window.updateCartCount();

                    // La etiqueta de la tarjeta recuerda la talla elegida.
                    const chip = document.querySelector(
                        '.elegir-talla-btn[data-producto-id="' + productoActual + '"]'
                    );
                    if (chip) chip.innerHTML = 'Talla: <strong>' + marcada.value + '</strong>';

                    const toast = document.getElementById('toastCarrito');
                    if (toast) {
                        toast.querySelector('.toast-body').textContent = datos.message;
                        bootstrap.Toast.getOrCreateInstance(toast).show();
                    }
                } else {
                    aviso.textContent = datos.message;
                    aviso.hidden = false;
                }
            } catch (error) {
                console.error('No se pudo añadir al carrito:', error);
                aviso.textContent = 'No se pudo añadir. Revisa tu conexión.';
                aviso.hidden = false;
            } finally {
                confirmar.disabled = false;
            }
        });
    }

    // Botón "atrás" del navegador: recuperamos el estado de esa URL.
    window.addEventListener('popstate', () => {
        window.location.reload();
    });

    actualizarContadores();
})();

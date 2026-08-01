/*
  Favoritos, con dos almacenes según quién esté mirando.

  * Invitado: se guardan en localStorage. No se llama al servidor al marcar un
    corazón, así que funciona igual de rápido sin cuenta.
  * Con sesión: van a la base de datos, ligados a su usuario, y le siguen a
    cualquier dispositivo donde entre.

  Al iniciar sesión o registrarse, lo que tenía en el navegador se fusiona con
  lo que ya hubiera en su cuenta y el navegador se limpia. Se suma, nunca se
  reemplaza: sumar es reversible, perder favoritos no.

  Este archivo va en TODAS las páginas: la tarjeta de producto se pinta en la
  tienda, en /favoritos y donde haga falta. Vive aparte de catalogo.js porque
  aquel sale antes de tiempo si no encuentra el panel de filtros.
*/
(function () {
    'use strict';

    const CLAVE = 'pdc_favoritos';
    const conSesion = document.body.dataset.sesion === '1';

    // --- Almacén del invitado (localStorage) --------------------------------

    /*
      localStorage puede fallar: modo privado de Safari, cuota llena o el
      usuario lo tiene desactivado. Si falla, los favoritos simplemente no se
      recuerdan, pero la tienda sigue funcionando.
    */
    function leerLocales() {
        try {
            const bruto = localStorage.getItem(CLAVE);
            if (!bruto) return [];
            const lista = JSON.parse(bruto);
            return Array.isArray(lista) ? lista.map(Number).filter(Number.isInteger) : [];
        } catch (error) {
            return [];
        }
    }

    function guardarLocales(ids) {
        try {
            localStorage.setItem(CLAVE, JSON.stringify([...new Set(ids)]));
        } catch (error) {
            console.warn('No se pudieron guardar los favoritos en este navegador.');
        }
    }

    function borrarLocales() {
        try {
            localStorage.removeItem(CLAVE);
        } catch (error) {
            /* da igual: lo importante es que ya están en la cuenta */
        }
    }

    // --- Pintar el estado ---------------------------------------------------

    function pintar(boton, activo) {
        const icono = boton.querySelector('.bi');
        boton.classList.toggle('activo', activo);
        boton.setAttribute('aria-pressed', String(activo));
        boton.setAttribute('aria-label', activo ? 'Quitar de favoritos' : 'Guardar en favoritos');
        if (icono) {
            icono.classList.toggle('bi-heart-fill', activo);
            icono.classList.toggle('bi-heart', !activo);
        }
    }

    function latir(boton) {
        boton.classList.add('late');
        setTimeout(function () {
            boton.classList.remove('late');
        }, 180);
    }

    /*
      Contador del corazón de la barra superior.

      Con sesión lo pinta el servidor al renderizar; aquí se actualiza al
      marcar o desmarcar, y para el invitado es la única fuente.
    */
    function actualizarContador(cuantos) {
        const badge = document.getElementById('fav-badge');
        if (!badge) return;

        badge.textContent = cuantos;
        badge.hidden = cuantos <= 0;

        // Un latido en el icono: el número cambia en una esquina pequeña y sin
        // esto es fácil no darse cuenta de que se guardó.
        const enlace = badge.closest('.nav-favoritos');
        if (enlace) {
            enlace.classList.add('late');
            setTimeout(function () {
                enlace.classList.remove('late');
            }, 200);
        }
    }

    /*
      Marca los corazones de la página según localStorage.

      Solo para invitados: cuando hay sesión el servidor ya los pinta al
      renderizar, que evita el parpadeo de verlos vacíos y llenarse después.
    */
    function marcarLocales() {
        if (conSesion) return;

        const guardados = leerLocales();
        document.querySelectorAll('[data-favorito]').forEach(function (boton) {
            pintar(boton, guardados.includes(Number(boton.dataset.favorito)));
        });

        // El servidor no sabe cuántos tiene un invitado: el contador de la
        // barra superior llega en 0 y se corrige aquí.
        actualizarContador(guardados.length);
    }

    // --- Alternar -----------------------------------------------------------

    async function alternarEnServidor(boton, productoId) {
        const eraFavorito = boton.classList.contains('activo');

        // Se pinta al instante y se corrige si el servidor dice otra cosa: el
        // corazón debe responder al dedo sin esperar a la red.
        pintar(boton, !eraFavorito);
        latir(boton);

        try {
            const respuesta = await fetch('/favoritos/alternar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ productoId: productoId }),
            });
            const datos = await respuesta.json();

            if (!datos.success) throw new Error(datos.message || 'no se pudo guardar');

            pintar(boton, datos.esFavorito);
            actualizarContador(datos.total);
            if (!datos.esFavorito) quitarDeLaLista(boton);
        } catch (error) {
            console.error('No se pudo guardar el favorito:', error);
            pintar(boton, eraFavorito); // se deshace
        }
    }

    function alternarEnLocal(boton, productoId) {
        const guardados = leerLocales();
        const posicion = guardados.indexOf(productoId);
        const esFavorito = posicion === -1;

        if (esFavorito) guardados.push(productoId);
        else guardados.splice(posicion, 1);

        guardarLocales(guardados);
        pintar(boton, esFavorito);
        latir(boton);
        actualizarContador(guardados.length);

        if (!esFavorito) quitarDeLaLista(boton);
    }

    /*
      En la propia página de favoritos, quitar uno lo saca de la lista en el
      momento: dejarlo ahí con el corazón vacío confunde.
    */
    function quitarDeLaLista(boton) {
        if (document.body.dataset.pagina !== 'favoritos') return;

        const tarjeta = boton.closest('.col') || boton.closest('.product-card');
        if (!tarjeta) return;

        tarjeta.style.transition = 'opacity .3s ease';
        tarjeta.style.opacity = '0';
        setTimeout(function () {
            tarjeta.remove();
            if (!document.querySelector('.product-card')) window.location.reload();
        }, 300);
    }

    // Delegación: las tarjetas se recrean al filtrar sin recargar.
    document.addEventListener('click', function (evento) {
        const boton = evento.target.closest('[data-favorito]');
        if (!boton) return;

        const productoId = Number(boton.dataset.favorito);
        if (!Number.isInteger(productoId)) return;

        if (conSesion) alternarEnServidor(boton, productoId);
        else alternarEnLocal(boton, productoId);
    });

    // --- Fusión al iniciar sesión ------------------------------------------

    /*
      Se ejecuta en la primera carga después de entrar: si hay sesión y todavía
      quedan favoritos en el navegador, se pasan a la cuenta.

      No se limpia el navegador hasta que el servidor confirma que los guardó.
      Si se limpiara antes y la petición fallara, se perderían.
    */
    async function fusionar() {
        if (!conSesion) return;

        const locales = leerLocales();
        if (!locales.length) return;

        try {
            const respuesta = await fetch('/favoritos/fusionar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: locales }),
            });
            const datos = await respuesta.json();
            if (!datos.success) return;

            borrarLocales();

            // Los corazones de esta página aún no reflejan lo recién fusionado.
            document.querySelectorAll('[data-favorito]').forEach(function (boton) {
                pintar(boton, datos.ids.includes(Number(boton.dataset.favorito)));
            });

            actualizarContador(datos.ids.length);
            if (datos.anadidos > 0) avisarFusion(datos.anadidos);

            // En la página de favoritos hay que rehacer la lista.
            if (document.body.dataset.pagina === 'favoritos' && datos.anadidos > 0) {
                window.location.reload();
            }
        } catch (error) {
            // Se quedan en el navegador y se intentará en la siguiente carga.
            console.error('No se pudieron pasar los favoritos a la cuenta:', error);
        }
    }

    function avisarFusion(cuantos) {
        const toast = document.getElementById('toastCarrito');
        if (!toast || !window.bootstrap) return;

        const cuerpo = toast.querySelector('.toast-body');
        if (cuerpo) {
            cuerpo.textContent =
                cuantos === 1
                    ? 'Se guardó 1 favorito en tu cuenta.'
                    : `Se guardaron ${cuantos} favoritos en tu cuenta.`;
        }
        bootstrap.Toast.getOrCreateInstance(toast).show();
    }

    // --- Lista de favoritos del invitado -----------------------------------

    /*
      El servidor no sabe qué favoritos tiene un invitado, así que manda la
      página vacía y aquí se construye preguntándole qué productos son esos
      identificadores.
    */
    async function pintarListaDeInvitado() {
        const contenedor = document.getElementById('listaFavoritos');
        if (!contenedor || conSesion) return;

        const ids = leerLocales();
        const vacio = document.getElementById('favoritosVacio');

        if (!ids.length) {
            if (vacio) vacio.hidden = false;
            return;
        }

        try {
            const respuesta = await fetch('/favoritos/resolver', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: ids }),
            });
            const datos = await respuesta.json();

            if (!datos.success || !datos.productos.length) {
                if (vacio) vacio.hidden = false;
                return;
            }

            contenedor.innerHTML = datos.productos.map(tarjeta).join('');

            const aviso = document.getElementById('avisoInvitado');
            if (aviso) aviso.hidden = false;
            const cuenta = document.getElementById('favoritosCuenta');
            if (cuenta) {
                cuenta.textContent =
                    datos.productos.length === 1
                        ? '1 camiseta guardada'
                        : `${datos.productos.length} camisetas guardadas`;
            }

            /*
              Si algún producto guardado ya no existe o se retiró, se limpia el
              navegador: si no, la lista mostraría menos de los que dice tener
              y el usuario no entendería por qué.
            */
            const vivos = datos.productos.map(function (p) { return p.id; });
            if (vivos.length !== ids.length) guardarLocales(vivos);
        } catch (error) {
            console.error('No se pudieron cargar tus favoritos:', error);
            if (vacio) vacio.hidden = false;
        }
    }

    // El texto se escapa: el nombre de un producto podría contener < o &.
    function escapar(texto) {
        const d = document.createElement('div');
        d.textContent = texto == null ? '' : String(texto);
        return d.innerHTML;
    }

    function tarjeta(p) {
        const nombre = escapar(p.nombre);
        const agotado = p.stock <= 0;

        const accion = agotado
            ? '<span class="chip-talla chip-agotado">Sin stock</span>'
            : p.tallas && p.tallas.length
              ? `<button type="button" class="chip-talla elegir-talla-btn"
                     data-producto-id="${p.id}" data-nombre="${nombre}"
                     data-precio="${escapar(p.precioTexto)}" data-imagen="${escapar(p.imagenUrl)}"
                     data-tallas="${escapar(p.tallas.join(','))}">Talla: <strong>elegir</strong></button>`
              : `<button type="button" class="chip-talla add-to-cart-btn"
                     data-producto-id="${p.id}" data-cantidad="1">
                     <i class="bi bi-cart-plus"></i> Añadir</button>`;

        return `<div class="col">
            <div class="product-card ${agotado ? 'agotado' : ''}">
                <div class="product-card-image-container">
                    <a href="/producto/${p.id}">
                        <img src="${escapar(p.imagenUrl)}" alt="${nombre}" loading="lazy">
                    </a>
                    <button type="button" class="btn-favorito activo" data-favorito="${p.id}"
                            aria-pressed="true" aria-label="Quitar de favoritos">
                        <i class="bi bi-heart-fill"></i>
                    </button>
                </div>
                <div class="product-card-body">
                    <h5 class="product-name"><a href="/producto/${p.id}">${nombre}</a></h5>
                    <p class="product-price">${escapar(p.precioTexto)}</p>
                    ${accion}
                </div>
            </div>
        </div>`;
    }

    // --- Arranque -----------------------------------------------------------

    marcarLocales();
    fusionar();
    pintarListaDeInvitado();
})();

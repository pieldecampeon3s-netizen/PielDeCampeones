/*
  Panel de administración: vista previa de la foto elegida antes de subirla.
*/
(function () {
    'use strict';

    const campoFoto = document.getElementById('imagen');
    const previa = document.getElementById('previaFotoAdmin');
    if (!campoFoto || !previa) return;

    campoFoto.addEventListener('change', function () {
        const archivo = campoFoto.files && campoFoto.files[0];
        if (!archivo) {
            previa.style.display = 'none';
            previa.removeAttribute('src');
            return;
        }
        previa.src = URL.createObjectURL(archivo);
        previa.style.display = 'block';
    });
})();

/*
  Modal "Editar usuario": un solo modal compartido por todas las filas de la
  tabla. Al abrirlo se rellena con los data-* del botón que lo disparó; al
  guardar se manda por fetch (no un POST normal) para poder mostrar un error
  sin cerrar el modal ni recargar la página entera.
*/
(function () {
    'use strict';

    const modal = document.getElementById('modalEditarUsuario');
    const form = document.getElementById('formEditarUsuario');
    if (!modal || !form) return;

    const campoEmail = document.getElementById('editarUsuarioEmail');
    const campoNombre = document.getElementById('editarUsuarioNombre');
    const campoTelefono = document.getElementById('editarUsuarioTelefono');
    const campoRol = document.getElementById('editarUsuarioRol');
    const campoActivo = document.getElementById('editarUsuarioActivo');
    const campoClave = document.getElementById('editarUsuarioClave');
    const campoClaveConfirmar = document.getElementById('editarUsuarioClaveConfirmar');
    const errorGeneral = document.getElementById('errorEditarUsuarioGeneral');
    const errorClave = document.getElementById('errorEditarUsuarioClave');
    const botonGuardar = document.getElementById('botonGuardarUsuario');

    modal.addEventListener('show.bs.modal', function (evento) {
        const boton = evento.relatedTarget;
        if (!boton) return;

        form.dataset.usuarioId = boton.dataset.id;
        campoEmail.value = boton.dataset.email || '';
        campoNombre.value = boton.dataset.nombre || '';
        campoTelefono.value = boton.dataset.telefono || '';
        campoRol.value = boton.dataset.rol || 'Cliente';
        campoActivo.value = boton.dataset.activo || '1';
        campoClave.value = '';
        campoClaveConfirmar.value = '';
        errorGeneral.textContent = '';
        errorClave.textContent = '';
    });

    form.addEventListener('submit', async function (evento) {
        evento.preventDefault();
        errorGeneral.textContent = '';
        errorClave.textContent = '';
        botonGuardar.disabled = true;

        try {
            const respuesta = await fetch('/admin/usuarios/' + form.dataset.usuarioId + '/editar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nombre: campoNombre.value,
                    telefono: campoTelefono.value,
                    rol: campoRol.value,
                    activo: campoActivo.value,
                    clave: campoClave.value,
                    claveConfirmar: campoClaveConfirmar.value,
                }),
            });
            const datos = await respuesta.json();

            if (datos.ok) {
                // Recarga a la misma lista: así se ve el cambio y sale el
                // toast de éxito, igual que el resto de acciones del panel.
                window.location.href = '/admin/usuarios?editado=1';
                return;
            }

            if (datos.errores && datos.errores.clave) errorClave.textContent = datos.errores.clave;
            if (datos.errores && datos.errores.general) errorGeneral.textContent = datos.errores.general;
        } catch (error) {
            errorGeneral.textContent = 'No se pudo guardar. Revisa tu conexión.';
        } finally {
            botonGuardar.disabled = false;
        }
    });
})();

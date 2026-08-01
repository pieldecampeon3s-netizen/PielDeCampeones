-- ============================================================================
--  Crear un usuario administrador
--
--  Hay dos caminos. El A es el recomendado; el B existe por si prefieres
--  hacerlo todo desde SQL.
-- ============================================================================


-- ============================================================================
--  OPCIÓN A (recomendada) — crear el usuario desde el panel y darle el rol
--
--  1. En Supabase, ve a  Authentication > Users > Add user
--  2. Marca "Auto Confirm User" para no tener que validar el correo
--  3. Vuelve aquí, cambia el correo de abajo y ejecuta SOLO este bloque
--
--  Es el camino recomendado porque el usuario lo crea el propio sistema de
--  autenticación de Supabase: si mañana cambian el formato interno de la
--  tabla, tu usuario se crea bien igualmente.
-- ============================================================================

update perfiles
   set rol = 'Administrador'
 where id = (select id from auth.users where email = 'correo@correo.com');

-- Comprueba que funcionó: debe devolver una fila con rol = Administrador
select u.email, p.rol, p.creado_en
  from perfiles p
  join auth.users u on u.id = p.id
 where p.rol = 'Administrador';


-- ============================================================================
--  OPCIÓN B — crear el usuario entero desde SQL
--
--  Úsalo solo si no quieres pasar por el panel. Cambia el correo y la
--  contraseña de las dos primeras líneas y ejecuta el bloque completo.
--
--  AVISO: se escribe directamente en las tablas internas de Supabase Auth.
--  Funciona hoy, pero si Supabase cambia su estructura interna este script
--  podría dejar de servir. La opción A no tiene ese riesgo.
-- ============================================================================

do $$
declare
    v_email    text := 'correo@correo.com';           -- <-- tu correo
    v_password text := 'password';                    -- <-- tu contraseña
    v_nombre   text := 'Administrador';
    v_user_id  uuid;
begin
    -- Si ya existe, no se duplica: solo se le da el rol.
    select id into v_user_id from auth.users where email = v_email;

    if v_user_id is null then
        v_user_id := gen_random_uuid();

        insert into auth.users (
            id,
            instance_id,
            aud,
            role,
            email,
            -- crypt() con bf es bcrypt, que es lo que espera Supabase Auth.
            encrypted_password,
            -- Confirmado desde ya: sin esto el usuario no podría entrar hasta
            -- validar el correo, y aquí no hay bandeja que revisar.
            email_confirmed_at,
            raw_app_meta_data,
            raw_user_meta_data,
            created_at,
            updated_at
        ) values (
            v_user_id,
            '00000000-0000-0000-0000-000000000000',
            'authenticated',
            'authenticated',
            v_email,
            crypt(v_password, gen_salt('bf')),
            now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            jsonb_build_object('nombre', v_nombre),
            now(),
            now()
        );

        -- Sin esta fila el inicio de sesión por correo NO funciona en las
        -- versiones actuales de Supabase: la contraseña estaría guardada pero
        -- el sistema no encontraría con qué método entrar.
        insert into auth.identities (
            id, user_id, provider_id, provider, identity_data, created_at, updated_at
        ) values (
            gen_random_uuid(),
            v_user_id,
            v_user_id::text,
            'email',
            jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
            now(),
            now()
        );

        raise notice 'Usuario creado: %', v_email;
    else
        raise notice 'El usuario ya existía: %', v_email;
    end if;

    -- El perfil lo crea solo el disparador `al_crear_usuario` del schema.sql.
    -- Este insert es la red de seguridad por si el disparador no estuviera.
    insert into perfiles (id, nombre, rol)
    values (v_user_id, v_nombre, 'Administrador')
    on conflict (id) do update set rol = 'Administrador';

    raise notice 'Rol de administrador asignado.';
end $$;


-- Comprobación final
select u.email,
       p.nombre,
       p.rol,
       u.email_confirmed_at is not null as correo_confirmado,
       exists (select 1 from auth.identities i where i.user_id = u.id) as puede_iniciar_sesion
  from auth.users u
  left join perfiles p on p.id = u.id
 order by u.created_at desc;


-- ============================================================================
--  Para quitarle el rol a alguien
--
--    update perfiles set rol = 'Usuario'
--     where id = (select id from auth.users where email = 'correo@ejemplo.com');
--
--  Para borrar un usuario por completo (se lleva su perfil y sus favoritos):
--
--    delete from auth.users where email = 'correo@ejemplo.com';
-- ============================================================================

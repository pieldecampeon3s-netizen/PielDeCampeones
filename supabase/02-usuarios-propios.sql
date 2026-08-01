-- ============================================================================
--  Migración: usuarios propios en lugar de Supabase Auth
--
--  Ejecutar en el SQL Editor de Supabase DESPUÉS de schema.sql.
--  Se puede volver a ejecutar sin romper nada.
--
--  Motivo: la app maneja la sesión por su cuenta (JWT en cookie httpOnly), así
--  que los usuarios viven en una tabla nuestra y no en auth.users.
-- ============================================================================


-- ============================================================================
--  1. Tabla de usuarios
-- ============================================================================

create table if not exists usuarios (
    id             uuid primary key default gen_random_uuid(),

    -- citext sería lo ideal, pero no está garantizada en todos los proyectos:
    -- se guarda en minúsculas y se fuerza con un índice sobre lower(email).
    email          text        not null,
    password_hash  text        not null,

    nombre         text,
    telefono       text,
    rol            text        not null default 'Cliente'
                   check (rol in ('Cliente', 'Administrador')),

    /*
      Revocación de tokens.

      Un JWT no se puede "borrar": una vez firmado vale hasta que caduca. Este
      número viaja dentro del token y se compara con el de la base en cada
      petición. Al incrementarlo, TODAS las sesiones de ese usuario dejan de
      valer en el acto — que es justo lo que un JWT no da por sí solo.

      Se incrementa al cerrar sesión en todos los dispositivos y al cambiar
      la contraseña.
    */
    version_token  integer     not null default 1,

    activo         boolean     not null default true,
    ultimo_acceso  timestamptz,
    creado_en      timestamptz not null default now(),
    actualizado_en timestamptz not null default now()
);

-- Un correo, un usuario. Sin distinguir mayúsculas: Ana@X.com y ana@x.com
-- son la misma persona y registrarse dos veces sería un problema.
create unique index if not exists usuarios_email_key on usuarios (lower(email));
create index if not exists usuarios_rol_idx on usuarios (rol);

drop trigger if exists usuarios_actualizado_en on usuarios;
create trigger usuarios_actualizado_en
    before update on usuarios
    for each row execute function tocar_actualizado_en();


-- ============================================================================
--  2. Traer el usuario que ya existía en Supabase Auth
--
--     El hash de contraseña se copia tal cual: pgcrypto y bcryptjs usan el
--     mismo formato bcrypt, así que la contraseña sigue funcionando sin que
--     nadie tenga que conocerla ni volver a escribirla.
-- ============================================================================

insert into usuarios (id, email, password_hash, nombre, rol, creado_en)
select u.id,
       lower(u.email),
       u.encrypted_password,
       coalesce(p.nombre, u.raw_user_meta_data ->> 'nombre', 'Administrador'),
       case when p.rol = 'Administrador' then 'Administrador' else 'Cliente' end,
       u.created_at
  from auth.users u
  left join perfiles p on p.id = u.id
 where u.encrypted_password is not null
on conflict (lower(email)) do nothing;


-- ============================================================================
--  3. Repuntar las claves foráneas a la tabla nueva
--
--     Antes apuntaban a auth.users. Se cambian sin perder los datos.
-- ============================================================================

-- --- Favoritos ---
alter table favoritos drop constraint if exists favoritos_usuario_id_fkey;
alter table favoritos
    add constraint favoritos_usuario_id_fkey
    foreign key (usuario_id) references usuarios (id) on delete cascade;

-- --- Pedidos ---
alter table pedidos drop constraint if exists pedidos_usuario_id_fkey;
alter table pedidos
    add constraint pedidos_usuario_id_fkey
    foreign key (usuario_id) references usuarios (id) on delete set null;


-- ============================================================================
--  4. Retirar lo que dependía de Supabase Auth
-- ============================================================================

-- El disparador creaba un perfil por cada alta en auth.users. Ya no aplica.
drop trigger if exists al_crear_usuario on auth.users;
drop function if exists crear_perfil_al_registrarse();

-- `perfiles` queda sustituida por `usuarios`. Se conserva un rato por si hay
-- que mirar algo; para borrarla del todo:
--     drop table perfiles;

/*
  es_admin() consultaba `perfiles` usando auth.uid(), que es el identificador
  que pone Supabase Auth. Sin Supabase Auth, auth.uid() siempre es null y la
  función devolvería false para todo el mundo.

  Se reescribe contra `usuarios`. IMPORTANTE: con la sesión gestionada por la
  app, auth.uid() sigue siendo null, así que esta función ya NO protege nada
  en la práctica. El control de acceso real está en el servidor Express.
  Se deja porque no estorba y volvería a servir si algún día alguien usa la
  clave anónima de Supabase directamente desde el navegador.
*/
create or replace function es_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
    select exists (
        select 1 from public.usuarios
        where id = auth.uid() and rol = 'Administrador'
    );
$$;


-- ============================================================================
--  5. RLS de la tabla de usuarios
--
--     Se activa y NO se crea ninguna política de lectura pública: así, si
--     alguien consultara con la clave anónima, no vería ni un correo ni un
--     hash. La app entra con la conexión de servidor, que no pasa por RLS.
-- ============================================================================

alter table usuarios enable row level security;

drop policy if exists "usuarios sin acceso publico" on usuarios;
create policy "usuarios sin acceso publico"
    on usuarios for select using (false);


-- ============================================================================
--  Comprobación
-- ============================================================================

select email, nombre, rol, activo, version_token, creado_en
  from usuarios
 order by creado_en;

-- ============================================================================
--  Piel de Campeón — esquema de la base de datos
--
--  Ejecutar entero en el SQL Editor de Supabase. Se puede volver a ejecutar
--  las veces que haga falta sin duplicar nada.
--
--  Convención Postgres: snake_case. La capa de datos de la app traduce a las
--  propiedades que esperan las plantillas (imagenUrl, nombreCategoria...).
--
--  Los usuarios NO se crean aquí: los gestiona Supabase Auth en auth.users.
-- ============================================================================


-- ============================================================================
--  1. Catálogo
-- ============================================================================

create table if not exists categorias (
    id          bigint generated always as identity primary key,
    nombre      text not null,
    descripcion text,
    creado_en   timestamptz not null default now()
);

-- Necesario para que el `on conflict` de los datos iniciales funcione. Sin
-- esta restricción, cada ejecución del script duplicaría las categorías.
create unique index if not exists categorias_nombre_key on categorias (lower(nombre));


create table if not exists productos (
    id             bigint generated always as identity primary key,
    categoria_id   bigint references categorias (id) on delete restrict,

    nombre         text           not null,
    descripcion    text,
    -- Referencia interna del producto. Viene del proyecto original, donde era
    -- "Original Equipment Manufacturer"; aquí es el código de la camiseta.
    oem            text,

    -- `stock` y `tallas` quedan aquí sin uso: la app ya no los lee ni los
    -- escribe. La fuente real es la tabla `producto_tallas` de abajo, que
    -- guarda el stock de cada talla por separado. Se dejan las columnas en
    -- vez de borrarlas para no perder los valores históricos con un DDL
    -- destructivo; se pueden limpiar el día que ya no haga falta mirarlos.
    precio         numeric(12, 2) not null default 0 check (precio >= 0),
    stock          integer        not null default 0 check (stock >= 0),
    tallas         text[]         not null default '{}',

    imagen_url     text,
    -- `false` lo esconde del catálogo sin borrarlo ni perder su historial.
    estado         boolean        not null default true,

    creado_en      timestamptz    not null default now(),
    actualizado_en timestamptz    not null default now()
);

-- Índice completo, no parcial: `on conflict (oem)` de los datos iniciales no
-- sabría inferir un índice con condición WHERE sin repetirla. Postgres ya
-- permite varios NULL en un índice único, así que no hace falta.
create unique index if not exists productos_oem_key on productos (oem);
create index if not exists productos_categoria_id_idx on productos (categoria_id);
create index if not exists productos_estado_idx on productos (estado) where estado = true;

-- Búsqueda por nombre y descripción.
--
-- Se usa la forma de dos argumentos de to_tsvector: con el idioma explícito es
-- IMMUTABLE y sirve para un índice; sin él es STABLE y Postgres lo rechaza.
--
-- No se le pasa por unaccent() a propósito: esa función también es STABLE y
-- rompería el índice. Si más adelante quieres que "seleccion" encuentre
-- "selección", hay que envolverla en una función propia marcada IMMUTABLE.
create index if not exists productos_busqueda_idx
    on productos using gin (
        to_tsvector('spanish', coalesce(nombre, '') || ' ' || coalesce(descripcion, ''))
    );

-- Stock real, por talla: "2 camisetas talla M, 12 talla L" en vez de un solo
-- número para todo el producto. `productos.stock` (arriba) es la suma de
-- esto, calculada al leer, no guardada aparte.
create table if not exists producto_tallas (
    producto_id bigint  not null references productos (id) on delete cascade,
    talla       text    not null,
    stock       integer not null default 0 check (stock >= 0),
    primary key (producto_id, talla)
);

create index if not exists producto_tallas_producto_id_idx on producto_tallas (producto_id);


-- ============================================================================
--  2. Perfiles y rol de administrador
--     Supabase Auth guarda al usuario; aquí va lo que es propio de la tienda.
-- ============================================================================

create table if not exists perfiles (
    id        uuid primary key references auth.users (id) on delete cascade,
    nombre    text,
    telefono  text,
    rol       text not null default 'Usuario' check (rol in ('Usuario', 'Administrador')),
    creado_en timestamptz not null default now()
);

-- El perfil se crea solo al registrarse. Sin este disparador habría que
-- acordarse de insertarlo a mano en cada alta, y tarde o temprano se olvida.
create or replace function crear_perfil_al_registrarse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.perfiles (id, nombre)
    values (new.id, new.raw_user_meta_data ->> 'nombre')
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario
    after insert on auth.users
    for each row execute function crear_perfil_al_registrarse();


-- ============================================================================
--  3. Favoritos
-- ============================================================================

create table if not exists favoritos (
    usuario_id  uuid   not null references auth.users (id) on delete cascade,
    producto_id bigint not null references productos (id) on delete cascade,
    creado_en   timestamptz not null default now(),
    primary key (usuario_id, producto_id)
);

create index if not exists favoritos_usuario_idx on favoritos (usuario_id);


-- ============================================================================
--  4. Pedidos
--     El pago se coordina por WhatsApp, así que el pedido nace 'Pendiente' y
--     avanza a mano desde el panel de administración.
-- ============================================================================

create table if not exists pedidos (
    id              bigint generated always as identity primary key,
    -- Nulo a propósito: hoy se puede comprar sin tener cuenta.
    usuario_id      uuid references auth.users (id) on delete set null,

    nombre_cliente  text not null,
    telefono        text not null,
    ciudad          text not null,
    direccion       text not null,
    referencia      text,

    total           numeric(12, 2) not null default 0 check (total >= 0),
    estado          text not null default 'Pendiente'
                    check (estado in ('Pendiente', 'Confirmado', 'Enviado', 'Entregado', 'Cancelado')),
    notas           text,

    creado_en       timestamptz not null default now(),
    actualizado_en  timestamptz not null default now()
);

create index if not exists pedidos_usuario_idx on pedidos (usuario_id);
create index if not exists pedidos_estado_idx on pedidos (estado);
create index if not exists pedidos_creado_idx on pedidos (creado_en desc);


create table if not exists pedido_lineas (
    id              bigint generated always as identity primary key,
    pedido_id       bigint not null references pedidos (id) on delete cascade,
    producto_id     bigint references productos (id) on delete set null,

    -- Copias del momento de la compra: si mañana cambia el precio o se retira
    -- el producto, el pedido histórico debe seguir siendo legible tal como se
    -- hizo. Por eso estos datos no se leen con un join.
    nombre_producto text           not null,
    talla           text,
    cantidad        integer        not null check (cantidad > 0),
    precio_unitario numeric(12, 2) not null check (precio_unitario >= 0),

    subtotal        numeric(12, 2) generated always as (cantidad * precio_unitario) stored
);

create index if not exists pedido_lineas_pedido_idx on pedido_lineas (pedido_id);


-- ============================================================================
--  5. Textos editables desde el panel
-- ============================================================================

create table if not exists contenido_sitio (
    clave     text primary key,
    valor     text not null,
    creado_en timestamptz not null default now()
);


-- ============================================================================
--  6. actualizado_en automático
-- ============================================================================

create or replace function tocar_actualizado_en()
returns trigger
language plpgsql
as $$
begin
    new.actualizado_en = now();
    return new;
end;
$$;

drop trigger if exists productos_actualizado_en on productos;
create trigger productos_actualizado_en
    before update on productos
    for each row execute function tocar_actualizado_en();

drop trigger if exists pedidos_actualizado_en on pedidos;
create trigger pedidos_actualizado_en
    before update on pedidos
    for each row execute function tocar_actualizado_en();


-- ============================================================================
--  7. Row Level Security
--
--  IMPORTANTE: sin esto, la clave anónima de Supabase —que viaja al navegador
--  y cualquiera puede leer— permitiría a un desconocido borrar tus productos.
--  RLS no es opcional.
-- ============================================================================

alter table categorias      enable row level security;
alter table productos       enable row level security;
alter table producto_tallas enable row level security;
alter table perfiles        enable row level security;
alter table favoritos       enable row level security;
alter table pedidos         enable row level security;
alter table pedido_lineas   enable row level security;
alter table contenido_sitio enable row level security;

-- security definer: la función necesita leer `perfiles` saltándose las
-- políticas, o al comprobar el rol se llamaría a sí misma en bucle.
create or replace function es_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
    select exists (
        select 1 from public.perfiles
        where id = auth.uid() and rol = 'Administrador'
    );
$$;

-- Las políticas no admiten "if not exists": se borran y se vuelven a crear
-- para que el script se pueda ejecutar más de una vez.

-- --- Catálogo: lo lee todo el mundo, lo edita solo el administrador ---
drop policy if exists "categorias lectura publica" on categorias;
create policy "categorias lectura publica"
    on categorias for select using (true);

drop policy if exists "categorias solo admin escribe" on categorias;
create policy "categorias solo admin escribe"
    on categorias for all using (es_admin()) with check (es_admin());

drop policy if exists "productos lectura publica" on productos;
create policy "productos lectura publica"
    on productos for select using (estado = true or es_admin());

drop policy if exists "productos solo admin escribe" on productos;
create policy "productos solo admin escribe"
    on productos for all using (es_admin()) with check (es_admin());

-- Lectura sin filtrar por `estado`: el panel de administración necesita ver
-- las tallas de un producto oculto igual que ve el resto de sus datos; el
-- filtro de visibilidad ya vive en la política de `productos`, no aquí.
drop policy if exists "producto_tallas lectura publica" on producto_tallas;
create policy "producto_tallas lectura publica"
    on producto_tallas for select using (true);

drop policy if exists "producto_tallas solo admin escribe" on producto_tallas;
create policy "producto_tallas solo admin escribe"
    on producto_tallas for all using (es_admin()) with check (es_admin());

drop policy if exists "contenido lectura publica" on contenido_sitio;
create policy "contenido lectura publica"
    on contenido_sitio for select using (true);

drop policy if exists "contenido solo admin escribe" on contenido_sitio;
create policy "contenido solo admin escribe"
    on contenido_sitio for all using (es_admin()) with check (es_admin());

-- --- Perfiles ---
drop policy if exists "perfil propio lectura" on perfiles;
create policy "perfil propio lectura"
    on perfiles for select using (id = auth.uid() or es_admin());

drop policy if exists "perfil propio actualizacion" on perfiles;
create policy "perfil propio actualizacion"
    on perfiles for update using (id = auth.uid()) with check (id = auth.uid());

-- --- Favoritos: cada quien los suyos ---
drop policy if exists "favoritos propios" on favoritos;
create policy "favoritos propios"
    on favoritos for all using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

-- --- Pedidos ---
drop policy if exists "pedidos propios lectura" on pedidos;
create policy "pedidos propios lectura"
    on pedidos for select using (usuario_id = auth.uid() or es_admin());

-- Se permite crear pedidos sin cuenta (usuario_id nulo) porque hoy se compra
-- como invitado. Cuando el login funcione, endurece esto a:
--     with check (usuario_id = auth.uid())
drop policy if exists "crear pedido" on pedidos;
create policy "crear pedido"
    on pedidos for insert with check (usuario_id is null or usuario_id = auth.uid());

drop policy if exists "pedidos solo admin actualiza" on pedidos;
create policy "pedidos solo admin actualiza"
    on pedidos for update using (es_admin()) with check (es_admin());

drop policy if exists "lineas de pedidos propios" on pedido_lineas;
create policy "lineas de pedidos propios"
    on pedido_lineas for select using (
        exists (
            select 1 from pedidos p
            where p.id = pedido_id and (p.usuario_id = auth.uid() or es_admin())
        )
    );

drop policy if exists "crear lineas de pedido" on pedido_lineas;
create policy "crear lineas de pedido"
    on pedido_lineas for insert with check (
        exists (
            select 1 from pedidos p
            where p.id = pedido_id
              and (p.usuario_id is null or p.usuario_id = auth.uid())
        )
    );


-- ============================================================================
--  8. Datos iniciales
--     Son los mismos que usa src/datos-demo.js, para que al conectar Supabase
--     la tienda se vea exactamente igual que ahora.
-- ============================================================================

insert into categorias (nombre, descripcion) values
    ('Clubes Europeos',      'Camisetas de los clubes más grandes de Europa.'),
    ('Selecciones',          'Camisetas de selecciones nacionales.'),
    ('Retro',                'Ediciones clásicas y de colección.'),
    ('Clubes Colombianos',   'Equipos del fútbol profesional colombiano.'),
    ('Ediciones Especiales', 'Lanzamientos limitados.')
on conflict (lower(nombre)) do nothing;


insert into productos (categoria_id, nombre, oem, precio, stock, tallas, descripcion, imagen_url)
select c.id, v.nombre, v.oem, v.precio, v.stock, v.tallas, v.descripcion, v.imagen_url
from (values
    ('Clubes Europeos', 'Real Madrid Local 2024/25',  'ADI-RM-2425',   189000, 24, array['S','M','L','XL','2XL'],
     'Camiseta local del Real Madrid, temporada 2024/25. Tejido transpirable.', '/images/REAL.jpg'),

    ('Clubes Europeos', 'FC Barcelona Local 2024/25', 'NIK-FCB-2425',  185000, 18, array['S','M','L','XL'],
     'Camiseta local del FC Barcelona con los colores blaugrana clásicos.',     '/images/BARCA3.jpg'),

    ('Retro',           'Selección Colombia Retro',   'COL-RETRO-90',  165000,  7, array['M','L','XL'],
     'Réplica retro de la Selección Colombia. Edición de colección.',           '/images/ColombiaR.jpeg'),

    ('Clubes Europeos', 'Liverpool FC Local',         'NIK-LFC-2425',  179000, 12, array['S','M','L','XL','2XL'],
     'Camiseta local del Liverpool FC, rojo característico de Anfield.',        '/images/LIVERPOL.jpg'),

    ('Clubes Europeos', 'Paris Saint-Germain Local',  'NIK-PSG-2425',  195000,  4, array['M','L','XL'],
     'Camiseta local del PSG con la banda central Hechter.',                    '/images/PSG.jpg'),

    ('Clubes Europeos', 'Juventus Local',             'ADI-JUV-2425',  175000,  0, array[]::text[],
     'Camiseta local de la Juventus, franjas blanquinegras.',                   '/images/JUVENTUS.jpg'),

    ('Selecciones',     'Selección Brasil Retro',     'BRA-RETRO-70',  172000,  9, array['S','M','L'],
     'Amarillo canarinho clásico. Edición retro de colección.',                 '/images/BrazilR.jpeg'),

    ('Clubes Europeos', 'Inter de Milán Local',       'NIK-INT-2425',  178000, 15, array['S','M','L','XL','2XL'],
     'Camiseta local del Inter, nerazzurri.',                                   '/images/INTER.jpg')
) as v (categoria, nombre, oem, precio, stock, tallas, descripcion, imagen_url)
join categorias c on lower(c.nombre) = lower(v.categoria)
on conflict (oem) do nothing;


-- ============================================================================
--  Después de ejecutar esto
--
--  1. Crea tu usuario en Authentication > Users (o registrándote en la web).
--  2. Conviértelo en administrador — cambia el correo por el tuyo:
--
--       update perfiles set rol = 'Administrador'
--       where id = (select id from auth.users where email = 'tu@correo.com');
--
--  3. Copia SUPABASE_URL y SUPABASE_ANON_KEY desde Project Settings > API
--     al archivo .env. La service_role NUNCA va al navegador.
-- ============================================================================

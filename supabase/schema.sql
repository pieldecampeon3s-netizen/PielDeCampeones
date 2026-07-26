-- Esquema traducido desde los modelos EF Core del proyecto .NET.
-- Ejecutar en el SQL Editor de Supabase. Convención Postgres: snake_case.
-- Ojo: los usuarios NO van aquí, los maneja Supabase Auth (auth.users).

create table if not exists categorias (
    id          bigint generated always as identity primary key,
    nombre      text not null,
    descripcion text
);

create table if not exists productos (
    id             bigint generated always as identity primary key,
    categoria_id   bigint references categorias (id) on delete restrict,
    nombre         text           not null,
    oem            text,                       -- era OriginalEquipmentManufacture
    precio         numeric(18, 2) not null default 0,
    stock          integer        not null default 0,
    descripcion    text,
    estado         boolean        not null default true,
    costo_unitario numeric(18, 2),
    fecha_ingreso  timestamptz    not null default now(),
    lote           text,
    imagen_url     text
);

create index if not exists productos_categoria_id_idx on productos (categoria_id);
create index if not exists productos_estado_idx on productos (estado);

create table if not exists ordenes (
    id              bigint generated always as identity primary key,
    usuario_id      uuid references auth.users (id) on delete set null,
    nombre_cliente  text           not null,
    direccion_envio text           not null,
    email           text           not null,
    telefono        text           not null,
    fecha_orden     timestamptz    not null default now(),
    total_orden     numeric(18, 2) not null default 0,
    estado          text           not null default 'Pendiente'
);

create table if not exists orden_detalles (
    id              bigint generated always as identity primary key,
    orden_id        bigint         not null references ordenes (id) on delete cascade,
    producto_id     bigint         not null references productos (id) on delete restrict,
    cantidad        integer        not null check (cantidad > 0),
    precio_unitario numeric(18, 2) not null
);

create index if not exists orden_detalles_orden_id_idx on orden_detalles (orden_id);

-- Textos editables desde el panel de administración
create table if not exists site_content (
    key   text primary key,
    value text not null
);

-- Rol de administrador. Supabase Auth guarda metadatos en auth.users.raw_app_meta_data;
-- esta tabla lo deja explícito y consultable desde las políticas RLS.
create table if not exists perfiles (
    id      uuid primary key references auth.users (id) on delete cascade,
    rol     text not null default 'Usuario' check (rol in ('Usuario', 'Administrador')),
    creado  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security. Sin esto, la anon key de Supabase deja escribir a cualquiera.
-- ---------------------------------------------------------------------------
alter table productos      enable row level security;
alter table categorias     enable row level security;
alter table ordenes        enable row level security;
alter table orden_detalles enable row level security;
alter table site_content   enable row level security;
alter table perfiles       enable row level security;

create or replace function es_admin()
returns boolean
language sql
security definer
stable
as $$
    select exists (
        select 1 from perfiles
        where id = auth.uid() and rol = 'Administrador'
    );
$$;

-- Catálogo: lectura pública, escritura solo del admin
create policy "productos visibles para todos"
    on productos for select using (estado = true or es_admin());
create policy "productos administrables por admin"
    on productos for all using (es_admin()) with check (es_admin());

create policy "categorias visibles para todos"
    on categorias for select using (true);
create policy "categorias administrables por admin"
    on categorias for all using (es_admin()) with check (es_admin());

create policy "contenido visible para todos"
    on site_content for select using (true);
create policy "contenido editable por admin"
    on site_content for all using (es_admin()) with check (es_admin());

-- Órdenes: cada quien ve las suyas; el admin las ve todas
create policy "ordenes propias"
    on ordenes for select using (usuario_id = auth.uid() or es_admin());
create policy "crear orden propia"
    on ordenes for insert with check (usuario_id = auth.uid());
create policy "ordenes administrables por admin"
    on ordenes for update using (es_admin()) with check (es_admin());

create policy "detalles de ordenes propias"
    on orden_detalles for select using (
        exists (
            select 1 from ordenes o
            where o.id = orden_id and (o.usuario_id = auth.uid() or es_admin())
        )
    );

create policy "perfil propio"
    on perfiles for select using (id = auth.uid() or es_admin());

-- ---------------------------------------------------------------------------
-- Datos iniciales
-- ---------------------------------------------------------------------------
insert into categorias (nombre, descripcion) values
    ('Clubes Europeos',      'Camisetas de los clubes más grandes de Europa.'),
    ('Selecciones',          'Camisetas de selecciones nacionales.'),
    ('Retro',                'Ediciones clásicas y de colección.'),
    ('Clubes Colombianos',   'Equipos del fútbol profesional colombiano.'),
    ('Ediciones Especiales', 'Lanzamientos limitados.')
on conflict do nothing;

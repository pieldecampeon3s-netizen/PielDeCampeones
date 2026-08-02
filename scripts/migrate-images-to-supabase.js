// Script para subir las imágenes existentes de public/images a Supabase
// y actualizar productos.imagen_url cuando apuntan a /images/<archivo>.

require('dotenv').config();
const path = require('path');
const fs = require('fs/promises');
const { createClient } = require('@supabase/supabase-js');
const db = require('../src/db');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'imagenes';
const CARPETA_IMAGENES = path.join(__dirname, '..', 'public', 'images');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Define SUPABASE_URL y SUPABASE_KEY en el .env antes de ejecutar este script.');
  process.exit(1);
}

if (!db.hayBaseDeDatos()) {
  console.error('DATABASE_URL no configurada. No se puede actualizar la BD.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function upload(localPath, destPath, contentType) {
  const data = await fs.readFile(localPath);
  const { error } = await supabase.storage.from(SUPABASE_BUCKET).upload(destPath, data, { contentType, upsert: true });
  if (error) throw error;
  const { data: publicData } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(destPath);
  return publicData && publicData.publicUrl ? publicData.publicUrl : publicData;
}

async function main() {
  try {
    const soloPlaceholder = process.argv.includes('--placeholder');
    const filas = await db.consulta("select id, imagen_url from productos where imagen_url like '/images/%' order by id");
    const existentes = [];
    const faltantes = [];
    for (const fila of filas) {
      const nombre = path.basename(fila.imagen_url);
      if (!nombre || nombre === 'placeholder.png') {
        continue;
      }

      const local = path.join(CARPETA_IMAGENES, nombre);
      try {
        const stats = await fs.stat(local);
        if (!stats.isFile()) throw new Error('not a file');
      } catch (err) {
        faltantes.push({ id: fila.id, imagen_url: fila.imagen_url });
        if (soloPlaceholder) {
          await db.consulta('update productos set imagen_url = $1 where id = $2', ['/images/placeholder.png', fila.id]);
        }
        continue;
      }

      existentes.push({ id: fila.id, nombre, local });
      console.log('Subiendo', nombre, '->', `${SUPABASE_BUCKET}/productos/${nombre}`);
      try {
        const publicUrl = await upload(local, `productos/${nombre}`, mimeFromName(nombre));
        console.log('URL pública:', publicUrl);
        await db.consulta('update productos set imagen_url = $1 where id = $2', [publicUrl, fila.id]);
        console.log('Actualizada BD para', fila.id);
      } catch (err) {
        console.error('Error subiendo', nombre, err.message);
      }
    }

    console.log('Migración finalizada.');
    console.log('Productos con imagen local existente:', existentes.length);
    console.log('Productos con imagen local faltante:', faltantes.length);
    if (faltantes.length) {
      console.log('Si quieres reemplazar las rutas faltantes por /images/placeholder.png, vuelve a ejecutar este script con --placeholder.');
      faltantes.slice(0, 50).forEach((f) => console.log(f.id, f.imagen_url));
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

function mimeFromName(name) {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'avif') return 'image/avif';
  return 'application/octet-stream';
}

main();

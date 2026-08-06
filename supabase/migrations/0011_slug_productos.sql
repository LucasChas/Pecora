-- ============================================================================
-- Pecora — Migración 0011: slugs únicos para los productos
--
-- Por qué: /producto/:id mostraba links feos e ilegibles (un uuid). Ahora cada
-- producto tiene un "slug" (ej: "body-manga-larga") generado a partir del
-- nombre, y /producto/:param acepta tanto el slug nuevo como el uuid viejo
-- (así los links ya compartidos siguen funcionando).
--
-- La app NUNCA calcula el slug: lo hace siempre la base, en un trigger, así no
-- hay dos implementaciones (TS + SQL) que puedan desincronizarse ni carreras
-- de unicidad desde el cliente.
--
-- Cómo correrla: pegá TODO este archivo en el SQL Editor de Supabase y ejecutá.
-- Es idempotente: se puede volver a correr sin romper nada.
-- ============================================================================

alter table public.productos add column if not exists slug text;
create unique index if not exists productos_slug_key on public.productos (slug);

-- Normaliza un texto a slug: minúsculas, sin acentos (translate, no hace falta
-- la extensión "unaccent"), y cualquier corrida de caracteres que no sean
-- letras/números se colapsa a un solo guion. "" si no queda nada usable.
create or replace function public.slugify(txt text)
returns text language sql immutable as $$
  select nullif(
    trim(both '-' from regexp_replace(
      translate(
        lower(coalesce(txt, '')),
        'áéíóúñüàèìòùâêîôûäëïöü',
        'aeiounuaeiouaeiouaeiou'
      ),
      '[^a-z0-9]+', '-', 'g'
    )),
    ''
  );
$$;

-- Slug único para un producto: arranca en slugify(txt) (o "producto" si el
-- nombre no deja nada usable) y si ya existe en otro producto, va probando
-- sufijos numéricos -2, -3, -4... hasta encontrar uno libre.
create or replace function public.slug_unico(txt text, self uuid)
returns text language plpgsql as $$
declare
  base text := coalesce(public.slugify(txt), 'producto');
  candidato text := base;
  n int := 1;
begin
  while exists (
    select 1 from public.productos
    where slug = candidato and id <> self
  ) loop
    n := n + 1;
    candidato := base || '-' || n;
  end loop;
  return candidato;
end;
$$;

-- Antes de insertar o de renombrar un producto, le asigna/recalcula el slug.
create or replace function public.productos_set_slug()
returns trigger language plpgsql as $$
begin
  if new.slug is null or (tg_op = 'UPDATE' and new.nombre is distinct from old.nombre) then
    new.slug := public.slug_unico(new.nombre, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists productos_slug on public.productos;
create trigger productos_slug
  before insert or update of nombre on public.productos
  for each row execute function public.productos_set_slug();

-- Backfill: le genera slug a los productos que todavía no tienen. Se procesan
-- en orden de creación para que, ante nombres duplicados, el producto más
-- viejo se quede con el slug "limpio" (sin sufijo) y el más nuevo reciba -2, -3...
do $$
declare
  r record;
begin
  for r in
    select id, nombre from public.productos
    where slug is null
    order by created_at asc
  loop
    update public.productos
    set slug = public.slug_unico(nombre, id)
    where id = r.id;
  end loop;
end $$;

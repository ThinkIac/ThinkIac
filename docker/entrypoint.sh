#!/usr/bin/env sh
set -eu

# SQLite stores belonging to packages are created next to their schemas. Link
# them into the named volume before boot so an image rebuild never loses users,
# settings or agent memory.
mkdir -p /data/packages
for package in /app/packages/*; do
  [ -d "$package" ] && [ -f "$package/schema.prisma" ] || continue
  name="$(basename "$package")"
  mkdir -p "/data/packages/$name"
  if [ ! -e "$package/.database" ]; then
    ln -s "/data/packages/$name/.database" "$package/.database"
  fi
done

if [ ! -e /app/.logos ]; then
  mkdir -p /data/logos
  ln -s /data/logos /app/.logos
fi

exec "$@"

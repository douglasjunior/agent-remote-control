import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';


const srcRoot = join(import.meta.dirname, '..', 'src');

function listSources(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      return listSources(path);
    }
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

for (const file of listSources(srcRoot)) {
  const original = readFileSync(file, 'utf8');
  const updated = original.replace(/(from\s+["'])@\/([^"']+)(["'])/g, (_match, open, target, close) => {
    let path = relative(dirname(file), join(srcRoot, target));
    if (!path.startsWith('.')) {
      path = `./${path}`;
    }
    return `${open}${path}.js${close}`;
  });
  if (updated !== original) {
    writeFileSync(file, updated);
    console.log(`rewrote ${relative(srcRoot, file)}`);
  }
}

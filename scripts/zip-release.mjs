import { createWriteStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const releaseDir = join(root, 'src-tauri', 'target', 'release');
const outPath = join(root, 'SwitchAI-v1.0.0-win64.zip');

console.log('Loading archiver...');
const Archiver = (await import('archiver')).default;
const archive = Archiver('zip', { zlib: { level: 9 } });
const output = createWriteStream(outPath);

output.on('close', () => {
  console.log(`Created ${outPath} (${archive.pointer()} bytes)`);
});
archive.on('error', (err) => { throw err; });
archive.pipe(output);

archive.file(join(releaseDir, 'switchai.exe'), { name: 'SwitchAI/switchai.exe' });
archive.file(join(releaseDir, 'switchai_lib.dll'), { name: 'SwitchAI/switchai_lib.dll' });
archive.directory(join(root, 'dist'), 'SwitchAI/dist');

await archive.finalize();
console.log('Done');

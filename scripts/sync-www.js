const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'static');
const destDir = path.join(__dirname, '..', 'www');

console.log(`[sync-www] Syncing ${srcDir} -> ${destDir} (excluding *.apk)...`);

if (!fs.existsSync(srcDir)) {
  console.error(`[sync-www] Source directory does not exist: ${srcDir}`);
  process.exit(1);
}

// Очистка целевой папки www перед копированием
if (fs.existsSync(destDir)) {
  fs.rmSync(destDir, { recursive: true, force: true });
}
fs.mkdirSync(destDir, { recursive: true });

function copyRecursive(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // Исключаем любые .apk файлы из сборки мобильного приложения
    if (entry.name.endsWith('.apk')) {
      console.log(`[sync-www] Skipping APK binary: ${entry.name}`);
      continue;
    }

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyRecursive(srcDir, destDir);
console.log(`[sync-www] Successfully synchronized static assets to www/ (no APK binaries included).`);

/**
 * Import hangtag Article Nos into data/article-map.json
 * Usage:
 *   node scripts/import_article_map.js path/to/map.csv
 * CSV columns: sku,article
 */
const fs = require('fs');
const path = require('path');
const { articleMapPath, loadArticleMap } = require('../article_map');
const { ensureDataDir } = require('../ensure_data');

ensureDataDir();

const csvPath = process.argv[2];
if (!csvPath || !fs.existsSync(csvPath)) {
  console.error('Usage: node scripts/import_article_map.js <file.csv>');
  process.exit(1);
}

const text = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '');
const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const map = loadArticleMap();
let added = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (i === 0 && /sku/i.test(line) && /article/i.test(line)) continue;
  const parts = line.split(',').map((p) => p.trim().replace(/^"|"$/g, ''));
  const sku = parts[0];
  const article = parts[1];
  if (!sku || !article || /sku/i.test(sku)) continue;
  map[sku] = String(article).slice(0, 15);
  added += 1;
}

fs.writeFileSync(articleMapPath(), JSON.stringify(map, null, 2) + '\n');
console.log(`[ArticleMap] Wrote ${Object.keys(map).length} SKUs (${added} from CSV) → ${articleMapPath()}`);

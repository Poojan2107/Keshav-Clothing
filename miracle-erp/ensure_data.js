/**
 * Ensure data directory + default files exist (Render disk / fresh deploy).
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');

function ensureDataDir() {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    console.log(`[KC Miracle] Created data dir: ${config.dataDir}`);
  }

  const overridesPath = path.join(config.dataDir, 'product-overrides.json');
  if (!fs.existsSync(overridesPath)) {
    const example = path.join(__dirname, 'data', 'product-overrides.example.json');
    const bundled = path.join(__dirname, 'data', 'product-overrides.json');
    if (fs.existsSync(bundled)) {
      fs.copyFileSync(bundled, overridesPath);
    } else if (fs.existsSync(example)) {
      fs.copyFileSync(example, overridesPath);
    } else {
      fs.writeFileSync(
        overridesPath,
        JSON.stringify(
          {
            'SHIP-KC': {
              hsn: '9965',
              gst: 18,
              prdnm: 'SHIP-KC',
              slab: 'GST 18%',
              group: 'Services'
            }
          },
          null,
          2
        )
      );
    }
    console.log(`[KC Miracle] Seeded product-overrides.json`);
  }

  const idMap = path.join(config.dataDir, 'id-map.json');
  if (!fs.existsSync(idMap)) {
    fs.writeFileSync(idMap, JSON.stringify({ accounts: {}, products: {}, orders: {}, meta: {} }, null, 2));
  }

  const articleMap = path.join(config.dataDir, 'article-map.json');
  if (!fs.existsSync(articleMap)) {
    const bundled = path.join(__dirname, 'data', 'article-map.json');
    if (fs.existsSync(bundled)) {
      fs.copyFileSync(bundled, articleMap);
    } else {
      fs.writeFileSync(articleMap, '{}\n');
    }
    console.log(`[KC Miracle] Seeded article-map.json`);
  }

  return config.dataDir;
}

module.exports = { ensureDataDir };

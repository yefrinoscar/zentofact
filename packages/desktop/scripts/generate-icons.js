const sharp = require('sharp');
const path = require('path');

const svgPath = path.join(__dirname, '..', 'resources', 'icon.svg');

async function generate() {
  await sharp(svgPath).resize(512, 512).png().toFile(
    path.join(__dirname, '..', 'resources', 'icon.png')
  );
  await sharp(svgPath).resize(256, 256).png().toFile(
    path.join(__dirname, '..', 'resources', 'icon-256.png')
  );
  console.log('Icons generated');
}

generate().catch(console.error);

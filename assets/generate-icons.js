/**
 * PWA Icon Generator for DocuShield
 * Generates PNG icons at all required sizes from the SVG logo.
 * Run: open generate-icons.html in a browser, then right-click > Save each canvas.
 * Or use this with Node.js canvas / sharp for automated generation.
 */

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const MASKABLE_SIZES = [192, 512];

function generateIcon(size, maskable = false) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Background
  const bgColor = maskable ? '#111415' : '#0B0C0D';
  ctx.fillStyle = bgColor;

  if (maskable) {
    // Maskable icons need full bleed (no rounded corners)
    ctx.fillRect(0, 0, size, size);
  } else {
    // Regular icons with subtle rounded corners
    const r = size * 0.15;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(size - r, 0);
    ctx.quadraticCurveTo(size, 0, size, r);
    ctx.lineTo(size, size - r);
    ctx.quadraticCurveTo(size, size, size - r, size);
    ctx.lineTo(r, size);
    ctx.quadraticCurveTo(0, size, 0, size - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fill();
  }

  // Shield
  const scale = size / 64;
  const cx = size / 2;
  const cy = size / 2;

  ctx.save();
  ctx.translate(cx - 14 * scale, cy - 16 * scale);
  ctx.scale(scale, scale);

  // Shield body
  ctx.beginPath();
  ctx.moveTo(14, 2);
  ctx.lineTo(25, 6.5);
  ctx.lineTo(25, 15.5);
  ctx.bezierCurveTo(25, 21.8, 19.8, 26.8, 14, 28.5);
  ctx.bezierCurveTo(8.2, 26.8, 3, 21.8, 3, 15.5);
  ctx.lineTo(3, 6.5);
  ctx.closePath();
  ctx.fillStyle = '#1A1C1E';
  ctx.fill();
  ctx.strokeStyle = '#5A7A99';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Circuit lines
  ctx.beginPath();
  ctx.moveTo(14, 8);
  ctx.lineTo(14, 12);
  ctx.moveTo(14, 15);
  ctx.lineTo(14, 22);
  ctx.strokeStyle = '#3FA98A';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(9.5, 12);
  ctx.bezierCurveTo(9.5, 14.5, 18.5, 14.5, 18.5, 17);
  ctx.bezierCurveTo(18.5, 19.5, 14, 21, 14, 21);
  ctx.stroke();

  // Top dot
  ctx.beginPath();
  ctx.arc(14, 7, 1.5, 0, Math.PI * 2);
  ctx.fillStyle = '#3FA98A';
  ctx.fill();

  ctx.restore();

  return canvas;
}

// This would be used in a browser context to generate and download icons
if (typeof document !== 'undefined') {
  window.generateAllIcons = function() {
    const container = document.getElementById('icons-output') || document.body;
    
    SIZES.forEach(size => {
      const canvas = generateIcon(size, false);
      const link = document.createElement('a');
      link.download = `icon-${size}.png`;
      link.href = canvas.toDataURL('image/png');
      link.textContent = `Download icon-${size}.png`;
      link.style.display = 'block';
      link.style.margin = '8px';
      link.style.color = '#a9caec';
      container.appendChild(canvas);
      container.appendChild(link);
    });

    MASKABLE_SIZES.forEach(size => {
      const canvas = generateIcon(size, true);
      const link = document.createElement('a');
      link.download = `icon-maskable-${size}.png`;
      link.href = canvas.toDataURL('image/png');
      link.textContent = `Download icon-maskable-${size}.png`;
      link.style.display = 'block';
      link.style.margin = '8px';
      link.style.color = '#72d9b7';
      container.appendChild(canvas);
      container.appendChild(link);
    });
  };
}

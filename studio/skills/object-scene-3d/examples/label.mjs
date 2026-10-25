// Этикетка для теста (в реальном ролике — фото этикетки клиента или studio image).
import sharp from "sharp";
const W = 2048, H = 476;
const hex = (cx, cy, r) => Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 3 * i + Math.PI / 6; return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`; }).join(" ");
let cells = "";
for (let y = 0; y < 6; y++) for (let x = 0; x < 40; x++) cells += `<polygon points="${hex(x * 60 + (y % 2) * 30, y * 52 + 10, 28)}" fill="none" stroke="#e9c27a" stroke-width="3" opacity=".45"/>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<rect width="100%" height="100%" fill="#fbf3e2"/>${cells}
<rect x="704" y="40" width="640" height="396" rx="36" fill="#fbf3e2" stroke="#7a4a1e" stroke-width="8"/>
<text x="1024" y="150" font-family="Helvetica Neue, Arial" font-weight="700" font-size="52" fill="#7a4a1e" text-anchor="middle" letter-spacing="10">ПАСЕКА</text>
<text x="1024" y="300" font-family="Georgia, Times New Roman" font-weight="700" font-size="150" fill="#3b2412" text-anchor="middle">Мёд</text>
<text x="1024" y="392" font-family="Helvetica Neue, Arial" font-size="46" fill="#7a4a1e" text-anchor="middle" letter-spacing="4">липовый · 250 г</text>
</svg>`;
await sharp(Buffer.from(svg)).png().toFile("public/img/label.png");
console.log("ok");

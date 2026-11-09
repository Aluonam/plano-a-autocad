// Reconocedor de planos dibujados a mano.
// Entrada: la imagen limpia en blanco y negro (PNG). Salida: un modelo con muros, puertas,
// ventanas y huecos, más el resto del dibujo como líneas, y un DXF R12 con capas y bloques.
// Todo trabaja en píxeles de la imagen (x a la derecha, y hacia abajo) hasta escribir el DXF.
(function () {
'use strict';
// En el navegador (o en un worker) no hay require: las funciones de PNG solo se usan en Node.
const zlib = typeof require === 'function' ? require('zlib') : null;

// ---------------------------------------------------------------- PNG
function leerPng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('No es un PNG');
  let p = 8, W = 0, H = 0, prof = 0, tipo = 0, entrelazado = 0;
  const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p), t = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (t === 'IHDR') { W = d.readUInt32BE(0); H = d.readUInt32BE(4); prof = d[8]; tipo = d[9]; entrelazado = d[12]; }
    else if (t === 'IDAT') idat.push(d);
    else if (t === 'IEND') break;
    p += 12 + len;
  }
  const canales = { 0: 1, 2: 3, 4: 2, 6: 4 }[tipo];
  if (prof !== 8 || entrelazado || !canales) throw new Error('Formato de PNG no admitido');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const fila = W * canales, px = Buffer.alloc(fila * H);
  let prev = Buffer.alloc(fila);
  for (let y = 0; y < H; y++) {
    const f = raw[y * (fila + 1)], src = raw.subarray(y * (fila + 1) + 1, (y + 1) * (fila + 1)), cur = px.subarray(y * fila, (y + 1) * fila);
    for (let i = 0; i < fila; i++) {
      const a = i >= canales ? cur[i - canales] : 0, b = prev[i], c = i >= canales ? prev[i - canales] : 0;
      let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    prev = cur;
  }
  const tinta = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const o = i * canales;
    let g, alfa = 255;
    if (canales <= 2) { g = px[o]; if (canales === 2) alfa = px[o + 1]; }
    else { g = 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2]; if (canales === 4) alfa = px[o + 3]; }
    tinta[i] = alfa >= 128 && g < 128 ? 1 : 0;
  }
  return { W, H, tinta };
}

function crc32(b) { let r = ~0; for (const x of b) { r ^= x; for (let k = 0; k < 8; k++) r = r & 1 ? 0xedb88320 ^ (r >>> 1) : r >>> 1; } return ~r >>> 0; }
function trozoPng(tipo, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(tipo), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function escribirPngRgb(W, H, rgb) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) Buffer.from(rgb.buffer, rgb.byteOffset + y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozoPng('IHDR', ih), trozoPng('IDAT', zlib.deflateSync(raw)), trozoPng('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- utilidades de imagen
// Distancia (chaflán 1 / raíz de 2) de cada píxel marcado al no marcado más cercano.
// bordeFondo: lo que queda fuera de la imagen cuenta como no marcado.
function distancia(mask, W, H, bordeFondo = true) {
  const INF = 1e9, d = new Float32Array(W * H), r2 = Math.SQRT2;
  for (let i = 0; i < W * H; i++) d[i] = mask[i] ? INF : 0;
  const fuera = bordeFondo ? 1 : INF;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!d[i]) continue;
    let v = d[i];
    v = Math.min(v, x > 0 ? d[i - 1] + 1 : fuera);
    if (y > 0) { v = Math.min(v, d[i - W] + 1); if (x > 0) v = Math.min(v, d[i - W - 1] + r2); if (x < W - 1) v = Math.min(v, d[i - W + 1] + r2); }
    else v = Math.min(v, fuera);
    d[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x; if (!d[i]) continue;
    let v = d[i];
    v = Math.min(v, x < W - 1 ? d[i + 1] + 1 : fuera);
    if (y < H - 1) { v = Math.min(v, d[i + W] + 1); if (x < W - 1) v = Math.min(v, d[i + W + 1] + r2); if (x > 0) v = Math.min(v, d[i + W - 1] + r2); }
    else v = Math.min(v, fuera);
    d[i] = v;
  }
  return d;
}
// Distancia de cada píxel al píxel marcado más cercano (0 en los marcados).
function distanciaA(mask, W, H) {
  const inv = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) inv[i] = mask[i] ? 0 : 1;
  return distancia(inv, W, H, false);
}
function mediana(v) { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; }
function percentil(v, p) { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; }

// Grosores de trazo: en el eje de cada trazo la distancia al fondo es la mitad de su grosor.
function grosores(tinta, dt, W, H) {
  const hist = new Float64Array(80);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, v = dt[i]; if (!v) continue;
    if (v < dt[i - 1] || v < dt[i + 1] || v < dt[i - W] || v < dt[i + W] || v < dt[i - W - 1] || v < dt[i - W + 1] || v < dt[i + W - 1] || v < dt[i + W + 1]) continue;
    hist[Math.min(79, Math.round(2 * v - 1))]++;
  }
  // Umbral de Otsu entre trazo fino y trazo grueso.
  let total = 0, suma = 0; for (let k = 0; k < 80; k++) { total += hist[k]; suma += k * hist[k]; }
  let wB = 0, sB = 0, mejor = -1, umbral = 0;
  for (let k = 0; k < 79; k++) {
    wB += hist[k]; if (!wB) continue; const wF = total - wB; if (!wF) break;
    sB += k * hist[k]; const mB = sB / wB, mF = (suma - sB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > mejor) { mejor = v; umbral = k; }
  }
  const pesoMedio = (desde, hasta) => { let w = 0, s = 0; for (let k = desde; k <= hasta; k++) { w += hist[k]; s += k * hist[k]; } return w ? s / w : 0; };
  let fino = pesoMedio(0, umbral), grueso = pesoMedio(umbral + 1, 79);
  let gruesos = 0; for (let k = umbral + 1; k < 80; k++) gruesos += hist[k];
  return { umbral: umbral + 0.5, fino, grueso, proporcionGruesa: total ? gruesos / total : 0 };
}

// ---------------------------------------------------------------- muros
// Bandas de píxeles de muro horizontales (o verticales): tramos largos en filas seguidas.
function bandas(mask, W, H, horizontal, largoMin, puente) {
  const N = horizontal ? H : W, M = horizontal ? W : H;
  const en = horizontal ? (i, j) => mask[i * W + j] : (i, j) => mask[j * W + i];
  let activos = [];
  const hechos = [];
  for (let i = 0; i < N; i++) {
    const tramos = [];
    let j = 0;
    while (j < M) {
      if (!en(i, j)) { j++; continue; }
      const s = j; let e = j, k = j + 1, hueco = 0;
      while (k < M) { if (en(i, k)) { e = k; hueco = 0; } else if (++hueco > puente) break; k++; }
      if (e - s + 1 >= largoMin) tramos.push([s, e]);
      j = e + 1;
    }
    const usados = new Set(), siguen = [];
    for (const t of tramos) {
      let mejor = null, solape = 0;
      for (const g of activos) {
        if (usados.has(g)) continue;
        const o = Math.min(t[1], g.e) - Math.max(t[0], g.s);
        if (o > solape) { solape = o; mejor = g; }
      }
      if (mejor && solape >= 0.5 * Math.min(t[1] - t[0], mejor.e - mejor.s)) {
        usados.add(mejor); mejor.filas.push([i, t[0], t[1]]); mejor.s = t[0]; mejor.e = t[1]; siguen.push(mejor);
      } else siguen.push({ filas: [[i, t[0], t[1]]], s: t[0], e: t[1] });
    }
    for (const g of activos) if (!usados.has(g)) hechos.push(g);
    activos = siguen;
  }
  hechos.push(...activos);
  return hechos.map((g) => {
    let pc = 0, pl = 0;
    for (const [i, s, e] of g.filas) { const l = e - s + 1; pc += (i + 0.5) * l; pl += l; }
    return {
      o: horizontal ? 'h' : 'v', c: pc / pl, t: g.filas.length,
      a: percentil(g.filas.map((f) => f[1]), 0.5), b: percentil(g.filas.map((f) => f[2]), 0.5) + 1,
    };
  });
}

function agrupar1d(valores, tol) { // [{v, peso, ref}] -> grupos con media ponderada
  const orden = [...valores].sort((a, b) => a.v - b.v), grupos = [];
  for (const x of orden) {
    const g = grupos[grupos.length - 1];
    if (g && x.v - g.ultimo <= tol) { g.items.push(x); g.ultimo = x.v; } else grupos.push({ items: [x], ultimo: x.v });
  }
  for (const g of grupos) { let s = 0, p = 0; for (const x of g.items) { s += x.v * x.peso; p += x.peso; } g.media = s / p; }
  return grupos;
}

function fusionarColineales(muros, tolC, huecoMax) {
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (let i = 0; i < muros.length && !cambio; i++) for (let j = i + 1; j < muros.length && !cambio; j++) {
      const m = muros[i], n = muros[j];
      if (m.o !== n.o || Math.abs(m.c - n.c) > tolC) continue;
      const hueco = Math.max(m.a, n.a) - Math.min(m.b, n.b);
      if (hueco > huecoMax) continue;
      const lm = m.b - m.a, ln = n.b - n.a;
      m.c = (m.c * lm + n.c * ln) / (lm + ln); m.t = (m.t * lm + n.t * ln) / (lm + ln);
      m.a = Math.min(m.a, n.a); m.b = Math.max(m.b, n.b);
      muros.splice(j, 1); cambio = true;
    }
  }
  return muros;
}

function regularizarMuros(muros, grueso) {
  // 1. Mismo eje: los muros que deberían estar alineados se alinean.
  for (const o of ['h', 'v']) {
    const lista = muros.filter((m) => m.o === o).map((m) => ({ v: m.c, peso: m.b - m.a, ref: m }));
    for (const g of agrupar1d(lista, 0.6 * grueso)) for (const x of g.items) x.ref.c = g.media;
  }
  fusionarColineales(muros, 0.5 * grueso, 0.6 * grueso);
  // 2. Grosor: uno o dos grosores (exterior e interior) para todo el plano.
  const ts = muros.map((m) => m.t).sort((a, b) => a - b);
  let clases = [mediana(ts)];
  if (ts.length >= 4) {
    let c1 = ts[0], c2 = ts[ts.length - 1];
    for (let it = 0; it < 10; it++) {
      const g1 = ts.filter((t) => Math.abs(t - c1) <= Math.abs(t - c2)), g2 = ts.filter((t) => Math.abs(t - c1) > Math.abs(t - c2));
      if (!g1.length || !g2.length) break; c1 = mediana(g1); c2 = mediana(g2);
    }
    const cuantos1 = ts.filter((t) => Math.abs(t - c1) <= Math.abs(t - c2)).length, cuantos2 = ts.length - cuantos1;
    if (c2 / c1 >= 1.4 && cuantos1 >= 2 && cuantos2 >= 2) clases = [c1, c2];
  }
  for (const m of muros) { const c = clases.reduce((a, k) => (Math.abs(k - m.t) < Math.abs(a - m.t) ? k : a), clases[0]); if (Math.abs(m.t - c) <= 0.35 * c) m.t = c; }
  // 3. Esquinas: cada extremo se lleva hasta la cara exterior del muro perpendicular cercano.
  const tolE = 2.2 * grueso;
  for (let vuelta = 0; vuelta < 2; vuelta++) {
    for (const m of muros) {
      m.unido = m.unido || { a: false, b: false };
      for (const lado of ['a', 'b']) {
        const fin = m[lado], dir = lado === 'b' ? 1 : -1;
        let mejor = null, dist = tolE;
        for (const p of muros) {
          if (p.o === m.o) continue;
          if (m.c < p.a - tolE - m.t / 2 || m.c > p.b + tolE + m.t / 2) continue; // el muro puede llegar a la esquina, más allá del tramo del otro
          const d = Math.abs(fin - p.c) - p.t / 2; // se mide desde la cara del muro perpendicular, no desde su eje
          if (d <= dist) { dist = d; mejor = p; }
        }
        if (!mejor) continue;
        m[lado] = mejor.c + dir * mejor.t / 2;
        m.unido[lado] = true;
        mejor.tocado = true;
        if (m.c > mejor.b) mejor.b = m.c + m.t / 2;
        if (m.c < mejor.a) mejor.a = m.c - m.t / 2;
      }
    }
  }
  fusionarColineales(muros, 0.5 * grueso, 0.3 * grueso);
  // Un trozo corto que no se une a ningún otro muro suele ser un poste, una letra gruesa o un borde.
  for (const m of muros) m.suelto = !(m.b - m.a >= 9 * m.t || m.tocado || (m.unido && (m.unido.a || m.unido.b)));
  return muros.filter((m) => m.b - m.a >= 1.5 * m.t);
}

function rectMuro(m) {
  return m.o === 'h' ? { x0: m.a, x1: m.b, y0: m.c - m.t / 2, y1: m.c + m.t / 2 } : { x0: m.c - m.t / 2, x1: m.c + m.t / 2, y0: m.a, y1: m.b };
}

// Contornos de la unión de rectángulos (rejilla de coordenadas comprimidas).
function contornosUnion(rects) {
  const xs = [...new Set(rects.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r.y0, r.y1]))].sort((a, b) => a - b);
  const nx = xs.length - 1, ny = ys.length - 1;
  if (nx < 1 || ny < 1) return [];
  const ix = new Map(xs.map((v, i) => [v, i])), iy = new Map(ys.map((v, i) => [v, i]));
  const cub = new Uint8Array(nx * ny);
  for (const r of rects) for (let j = iy.get(r.y0); j < iy.get(r.y1); j++) for (let i = ix.get(r.x0); i < ix.get(r.x1); i++) cub[j * nx + i] = 1;
  const c = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && cub[j * nx + i];
  const salidas = new Map();
  const arista = (a, b) => { const k = a.join(','); if (!salidas.has(k)) salidas.set(k, []); salidas.get(k).push(b); };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!c(i, j)) continue;
    if (!c(i, j - 1)) arista([i, j], [i + 1, j]);
    if (!c(i + 1, j)) arista([i + 1, j], [i + 1, j + 1]);
    if (!c(i, j + 1)) arista([i + 1, j + 1], [i, j + 1]);
    if (!c(i - 1, j)) arista([i, j + 1], [i, j]);
  }
  const lazos = [];
  for (const [k0, lista0] of salidas) {
    while (lista0.length) {
      const inicio = k0.split(',').map(Number);
      let actual = lista0.shift(), previo = inicio;
      const lazo = [inicio];
      let guarda = 0;
      while (actual.join(',') !== k0 && guarda++ < 1e6) {
        lazo.push(actual);
        const opciones = salidas.get(actual.join(','));
        if (!opciones || !opciones.length) break;
        const d = [actual[0] - previo[0], actual[1] - previo[1]], dcha = [-d[1], d[0]];
        let mejor = 0, valor = -9;
        opciones.forEach((o, n) => { const v = (o[0] - actual[0]) * dcha[0] + (o[1] - actual[1]) * dcha[1]; if (v > valor) { valor = v; mejor = n; } });
        const sig = opciones.splice(mejor, 1)[0];
        previo = actual; actual = sig;
      }
      // Quita los vértices intermedios de los tramos rectos.
      const pts = lazo.map(([i, j]) => [xs[i], ys[j]]);
      const limpio = pts.filter((p, n) => {
        const a = pts[(n - 1 + pts.length) % pts.length], b = pts[(n + 1) % pts.length];
        return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
      });
      if (limpio.length >= 4) lazos.push(limpio);
    }
  }
  return lazos;
}
function areaFirmada(l) { let s = 0; for (let i = 0; i < l.length; i++) { const a = l[i], b = l[(i + 1) % l.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
function dentro(p, l) {
  let r = false;
  for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
    const a = l[i], b = l[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) r = !r;
  }
  return r;
}

// ---------------------------------------------------------------- esqueleto y trazos
function esqueleto(mask, W, H) {
  const m = Uint8Array.from(mask);
  let candidatos = [];
  for (let i = 0; i < W * H; i++) if (m[i]) candidatos.push(i);
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (let paso = 0; paso < 2; paso++) {
      const borrar = [];
      for (const i of candidatos) {
        if (!m[i]) continue;
        const x = i % W, y = (i - x) / W;
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) { borrar.push(i); continue; }
        const p2 = m[i - W], p3 = m[i - W + 1], p4 = m[i + 1], p5 = m[i + W + 1], p6 = m[i + W], p7 = m[i + W - 1], p8 = m[i - 1], p9 = m[i - W - 1];
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
        if (A !== 1) continue;
        if (paso === 0 ? (p2 && p4 && p6) || (p4 && p6 && p8) : (p2 && p4 && p8) || (p2 && p6 && p8)) continue;
        borrar.push(i);
      }
      for (const i of borrar) m[i] = 0;
      if (borrar.length) cambio = true;
    }
    candidatos = candidatos.filter((i) => m[i]);
  }
  return m;
}
function vecinosEsq(m, W, H, i) {
  const x = i % W, y = (i - x) / W, r = [];
  const orto = [[1, 0], [-1, 0], [0, 1], [0, -1]], diag = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const en = (dx, dy) => { const X = x + dx, Y = y + dy; return X >= 0 && Y >= 0 && X < W && Y < H && m[Y * W + X]; };
  for (const [dx, dy] of orto) if (en(dx, dy)) r.push(i + dy * W + dx);
  for (const [dx, dy] of diag) if (en(dx, dy) && !en(dx, 0) && !en(0, dy)) r.push(i + dy * W + dx);
  return r;
}
function trazosEsqueleto(m, W, H) {
  const grado = new Map();
  for (let i = 0; i < W * H; i++) if (m[i]) grado.set(i, vecinosEsq(m, W, H, i));
  const visto = new Set(), aristas = new Set(), caminos = [];
  const clave = (a, b) => (a < b ? a + ':' + b : b + ':' + a);
  const andar = (inicio, siguiente) => {
    const camino = [inicio];
    let prev = inicio, cur = siguiente;
    aristas.add(clave(inicio, siguiente));
    for (;;) {
      camino.push(cur);
      const v = grado.get(cur);
      if (v.length !== 2 || visto.has(cur)) break;
      visto.add(cur);
      const sig = v[0] === prev ? v[1] : v[0];
      if (aristas.has(clave(cur, sig))) break;
      aristas.add(clave(cur, sig));
      prev = cur; cur = sig;
      if (cur === inicio) { camino.push(cur); break; }
    }
    return camino;
  };
  for (const [i, v] of grado) {
    if (v.length === 2) continue;
    for (const n of v) if (!aristas.has(clave(i, n))) caminos.push(andar(i, n));
  }
  for (const [i, v] of grado) { // lazos cerrados sin nudos
    if (v.length === 2 && !visto.has(i)) { visto.add(i); caminos.push(andar(i, v[0])); }
  }
  return caminos.map((c) => c.map((i) => [i % W + 0.5, Math.floor(i / W) + 0.5]));
}
function simplificar(pts, eps) {
  if (pts.length < 3) return pts;
  const [p0, pn] = [pts[0], pts[pts.length - 1]];
  if (p0[0] === pn[0] && p0[1] === pn[1]) {
    // Figura cerrada: se parte por el punto más lejano del inicio y se simplifica cada mitad.
    let lejos = 1, d = -1;
    pts.forEach((p, k) => { const v = Math.hypot(p[0] - p0[0], p[1] - p0[1]); if (v > d) { d = v; lejos = k; } });
    if (lejos <= 0 || lejos >= pts.length - 1) return pts;
    return [...simplificar(pts.slice(0, lejos + 1), eps).slice(0, -1), ...simplificar(pts.slice(lejos), eps)];
  }
  const guardar = new Uint8Array(pts.length); guardar[0] = guardar[pts.length - 1] = 1;
  const pila = [[0, pts.length - 1]];
  while (pila.length) {
    const [a, b] = pila.pop();
    let max = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    for (let k = a + 1; k < b; k++) {
      const d = L > 1e-9 ? Math.abs(dy * (pts[k][0] - ax) - dx * (pts[k][1] - ay)) / L : Math.hypot(pts[k][0] - ax, pts[k][1] - ay);
      if (d > max) { max = d; idx = k; }
    }
    if (max > eps) { guardar[idx] = 1; pila.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, k) => guardar[k]);
}
// Ortogonalizar, como el modo orto de AutoCAD: los tramos casi horizontales o casi verticales pasan a serlo del todo.
// Cada vértice toma la Y de su tramo horizontal y la X de su tramo vertical, así que las esquinas siguen unidas.
function ortogonalizar(pts, tolerancia = 8) {
  if (pts.length < 2) return pts;
  const n = pts.length, cerrada = n > 2 && pts[0][0] === pts[n - 1][0] && pts[0][1] === pts[n - 1][1];
  const fijaX = pts.map(() => []), fijaY = pts.map(() => []);
  for (let k = 1; k < n; k++) {
    const a = pts[k - 1], b = pts[k], ang = Math.atan2(Math.abs(b[1] - a[1]), Math.abs(b[0] - a[0])) * 180 / Math.PI;
    if (ang <= tolerancia) { const y = (a[1] + b[1]) / 2; fijaY[k - 1].push(y); fijaY[k].push(y); }
    else if (ang >= 90 - tolerancia) { const x = (a[0] + b[0]) / 2; fijaX[k - 1].push(x); fijaX[k].push(x); }
  }
  if (cerrada) { fijaX[0].push(...fijaX[n - 1]); fijaY[0].push(...fijaY[n - 1]); fijaX[n - 1] = fijaX[0]; fijaY[n - 1] = fijaY[0]; }
  const media = (l, d) => (l.length ? l.reduce((t, v) => t + v, 0) / l.length : d);
  const out = [];
  pts.forEach((p, i) => {
    const q = [media(fijaX[i], p[0]), media(fijaY[i], p[1])], u = out[out.length - 1];
    if (!u || Math.abs(u[0] - q[0]) > 1e-6 || Math.abs(u[1] - q[1]) > 1e-6) out.push(q);
  });
  return out.length >= 2 ? out : pts;
}
// Rectificar: si un tramo largo de la polilínea cabe en un pasillo estrecho alrededor de una recta casi
// horizontal o vertical (un muro o un borde que solo ondula por la foto), se sustituye por esa recta.
function rectificar(pts, tol, largoMin) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let mejor = i + 1;
    for (let j = pts.length - 1; j > i + 1; j--) {
      const a = pts[i], b = pts[j], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      if (L < largoMin) continue;
      const ang = Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI;
      if (ang > 12 && ang < 78) continue;
      let cabe = true;
      for (let k = i + 1; k < j && cabe; k++) if (Math.abs(dy * (pts[k][0] - a[0]) - dx * (pts[k][1] - a[1])) / L > tol) cabe = false;
      if (cabe) { mejor = j; break; }
    }
    out.push(pts[mejor]);
    i = mejor;
  }
  return out;
}
function longitud(pts) { let s = 0; for (let k = 1; k < pts.length; k++) s += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); return s; }

// ---------------------------------------------------------------- reconocimiento
// opciones: { muros: 'grueso' | 'dobles', unidadesPorPx?, unidad: 'm'|'cm'|'mm' }
function reconocer(png, opciones = {}) { return reconocerMascara(leerPng(png), opciones); }

// imagen: { W, H, tinta } con tinta[i] = 1 donde hay trazo.
function reconocerMascara(imagen, opciones = {}) {
  const { W, H } = imagen;
  // Marcas a mano (máscaras por tipo): lo pintado como «borrar» se ignora desde el principio.
  const marcas = opciones.marcas || null;
  let tinta = imagen.tinta;
  if (marcas && marcas.borrar) { tinta = Uint8Array.from(tinta); for (let i = 0; i < tinta.length; i++) if (marcas.borrar[i]) tinta[i] = 0; }
  const N = W * H;
  let base = tinta;
  const lado = Math.max(W, H);
  // Cierre morfológico: rellena los huecos de hasta 2r entre líneas cercanas.
  const cerrar = (mask, r) => {
    const d1 = distanciaA(mask, W, H), dil = new Uint8Array(N);
    for (let i = 0; i < N; i++) dil[i] = d1[i] <= r ? 1 : 0;
    const d2 = distancia(dil, W, H, false), cerr = new Uint8Array(N);
    for (let i = 0; i < N; i++) cerr[i] = d2[i] > r ? 1 : 0;
    return cerr;
  };
  // Apertura: deja solo lo que tiene al menos 2·radio de grosor.
  const abrir = (mask, radio) => {
    const d = distancia(mask, W, H), nuc = new Uint8Array(N);
    for (let i = 0; i < N; i++) nuc[i] = d[i] >= radio + 0.5 ? 1 : 0;
    const dn2 = distanciaA(nuc, W, H), res = new Uint8Array(N);
    for (let i = 0; i < N; i++) res[i] = mask[i] && dn2[i] <= radio + 0.5 ? 1 : 0;
    return res;
  };
  // ¿Ventana? Líneas finas paralelas o rayado dentro del grosor del muro, en el tramo [a, b].
  const pareceVentana = (o, c, a, b, t) => {
    let maxCob = 0, tintaDentro = 0, total = 0;
    for (let pe = Math.ceil(c - t / 2); pe < c + t / 2; pe++) {
      let fila = 0, n = 0;
      for (let al = Math.ceil(a); al < b; al++) {
        const [x, y] = o === 'h' ? [al, pe] : [pe, al];
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        n++; if (tinta[y * W + x]) fila++;
      }
      if (n) { maxCob = Math.max(maxCob, fila / n); tintaDentro += fila; total += n; }
    }
    return maxCob >= 0.75 || (total > 0 && tintaDentro / total >= 0.18);
  };
  // Un muro de dos líneas tiene sus dos caras dibujadas casi enteras (las vigas discontinuas o los textos, no).
  const carasDibujadas = (m) => {
    const holgura = Math.max(1, Math.round(0.2 * m.t));
    let ok = 0;
    for (const cara of [m.c - m.t / 2, m.c + m.t / 2]) {
      let hay = 0, n = 0, corte = 0, corteMax = 0;
      for (let al = Math.ceil(m.a); al < m.b; al++) {
        n++;
        let h = false;
        for (let pe = Math.round(cara) - holgura; pe <= Math.round(cara) + holgura && !h; pe++) {
          const [x, y] = m.o === 'h' ? [al, pe] : [pe, al];
          if (x >= 0 && y >= 0 && x < W && y < H && tinta[y * W + x]) h = true;
        }
        if (h) { hay++; corte = 0; } else corteMax = Math.max(corteMax, ++corte);
      }
      if (n && hay / n >= 0.85 && corteMax <= 1.2 * m.t) ok++;
    }
    return ok === 2;
  };
  // Proporción del eje del muro con tinta: 0 en dos líneas vacías, algo en un muro rayado, 1 en un trazo macizo.
  const rayadoInterior = (m) => {
    let hay = 0, n = 0;
    for (let al = Math.ceil(m.a); al < m.b; al++) {
      n++;
      for (let pe = Math.round(m.c - 0.15 * m.t); pe <= Math.round(m.c + 0.15 * m.t); pe++) {
        const [x, y] = m.o === 'h' ? [al, pe] : [pe, al];
        if (x >= 0 && y >= 0 && x < W && y < H && tinta[y * W + x]) { hay++; break; }
      }
    }
    return n ? hay / n : 0;
  };
  if (opciones.muros === 'dobles') {
    // Muros a dos líneas: se cierran los huecos entre líneas paralelas cercanas.
    base = cerrar(tinta, Math.max(2, Math.round(lado * 0.006)));
  }
  const dt = distancia(base, W, H);
  const g = grosores(base, dt, W, H);
  const avisos = [];
  if (!(g.grueso >= 1.4 * Math.max(1, g.fino)) || g.proporcionGruesa < 0.03) {
    avisos.push('No se distinguen bien los muros del resto del dibujo. Repasa los muros con un trazo más grueso que el resto.');
  }
  let grueso = Math.max(2, g.grueso);
  const modoLineas = opciones.muros === 'lineas';
  // Muros: lo que sobrevive a una apertura del tamaño del umbral de grosor.
  const radio = Math.max(1, g.umbral / 2);
  const nucleo = new Uint8Array(N);
  for (let i = 0; i < N; i++) nucleo[i] = dt[i] >= radio + 0.5 ? 1 : 0;
  const dn = distanciaA(nucleo, W, H), masa = new Uint8Array(N);
  for (let i = 0; i < N; i++) masa[i] = base[i] && dn[i] <= radio + 0.5 ? 1 : 0;

  const largoMin = Math.max(6, Math.round(2.5 * grueso));
  const puente = Math.max(1, Math.round(0.5 * grueso));
  let muros = [...bandas(masa, W, H, true, largoMin, puente), ...bandas(masa, W, H, false, largoMin, puente)]
    .filter((m) => m.t >= 0.45 * grueso && m.t <= 2.6 * grueso && m.b - m.a >= 2.5 * m.t);
  if (opciones.muros !== 'dobles' && !modoLineas) {
    // Además de los trazos gruesos, los muros de fábrica dibujados con dos líneas y rayado entre medias.
    const rFab = Math.max(2, Math.round(Math.min(0.9 * grueso, 0.006 * lado))); // el hueco entre las dos líneas de un muro de fábrica no crece con el grosor de los muros macizos
    const masaDoble = abrir(cerrar(tinta, rFab), Math.max(1, 0.45 * rFab));
    const solapa = (m) => muros.some((n) => n.o === m.o && Math.abs(n.c - m.c) < 0.8 * grueso &&
      Math.min(n.b, m.b) - Math.max(n.a, m.a) > 0.5 * (m.b - m.a));
    const dobles = [...bandas(masaDoble, W, H, true, largoMin, puente), ...bandas(masaDoble, W, H, false, largoMin, puente)]
      .filter((m) => {
        if (m.t < Math.min(0.8 * grueso, 1.6 * rFab) || m.t > Math.min(3.2 * grueso, 0.025 * lado) || m.b - m.a < 3 * m.t || solapa(m) || !carasDibujadas(m)) return false;
        const r = rayadoInterior(m);
        return r >= 0.15 && r <= 0.85;
      });
    muros.push(...dobles);
  }
  // Modo líneas: todas las líneas del dibujo se extraen como segmentos; los trozos de una misma línea se
  // encadenan siguiéndola aunque ondule (papel arrugado) y se sustituyen por una única recta en su posición media;
  // cada pareja de rectas paralelas a distancia de muro es un muro, del grosor que tenga en el dibujo.
  function murosDeLineas(mascara = tinta) {
    const caminos = trazosEsqueleto(esqueleto(mascara, W, H), W, H);
    const eps = Math.max(1.2, 0.0012 * lado), minL = Math.max(6, 0.008 * lado);
    const seg = { h: [], v: [] };
    for (const cam of caminos) {
      const pts = simplificar(cam, eps);
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1], b = pts[k], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
        if (L < minL) continue;
        const ang = Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI;
        if (ang <= 12) seg.h.push({ c: (a[1] + b[1]) / 2, a: Math.min(a[0], b[0]), b: Math.max(a[0], b[0]), w: L });
        else if (ang >= 78) seg.v.push({ c: (a[0] + b[0]) / 2, a: Math.min(a[1], b[1]), b: Math.max(a[1], b[1]), w: L });
      }
    }
    const t1 = Math.max(2, 0.0025 * lado), g1 = Math.max(4, 0.012 * lado), rectas = { h: [], v: [] };
    for (const o of ['h', 'v']) {
      const lineas = [];
      for (const sg of seg[o].sort((p, q) => p.a - q.a)) {
        let mejor = null, dmin = t1;
        for (const L of lineas) { if (sg.a > L.b + g1) continue; const d = Math.abs(L.cFin - sg.c); if (d <= dmin) { dmin = d; mejor = L; } }
        if (mejor) { mejor.piezas.push(sg); if (sg.b >= mejor.b) { mejor.b = sg.b; mejor.cFin = sg.c; } }
        else lineas.push({ piezas: [sg], a: sg.a, b: sg.b, cFin: sg.c });
      }
      for (const L of lineas) { let sc = 0, sw = 0; for (const p of L.piezas) { sc += p.c * p.w; sw += p.w; } L.c = sc / sw; L.largo = L.b - L.a; }
      rectas[o] = lineas.filter((L) => L.largo >= 2 * minL);
    }
    const tmin = Math.max(3, 0.0035 * lado), tmax = Math.max(12, 0.035 * lado), res = [];
    for (const o of ['h', 'v']) {
      const L = rectas[o].sort((p, q) => p.c - q.c), pares = [];
      for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
        const t = L[j].c - L[i].c;
        if (t < tmin) continue;
        if (t > tmax) break;
        const a = Math.max(L[i].a, L[j].a), b = Math.min(L[i].b, L[j].b);
        if (b - a < Math.max(3 * t, 0.5 * Math.min(L[i].largo, L[j].largo))) continue;
        pares.push({ i, j, t, a, b });
      }
      pares.sort((p, q) => p.t - q.t);
      // Cada lado de cada línea se reparte por tramos: una línea exterior larga puede ser muro con varios tramos
      // de la línea interior, y una pareja corta (un mueble) solo ocupa su propio tramo.
      const abajo = new Map(), arriba = new Map();
      const ocupado = (mapa, k, a, b) => (mapa.get(k) || []).reduce((t, [x, y]) => t + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);
      const ocupar = (mapa, k, a, b) => { if (!mapa.has(k)) mapa.set(k, []); mapa.get(k).push([a, b]); };
      for (const p of pares) {
        const largo = p.b - p.a;
        if (ocupado(abajo, p.i, p.a, p.b) > 0.3 * largo || ocupado(arriba, p.j, p.a, p.b) > 0.3 * largo) continue;
        ocupar(abajo, p.i, p.a, p.b); ocupar(arriba, p.j, p.a, p.b);
        res.push({ o, c: (L[p.i].c + L[p.j].c) / 2, t: p.t, a: p.a, b: p.b });
      }
    }
    // Un plano tiene pocos grosores de muro (exterior, tabiques…). Se agrupan los grosores por la longitud que suman;
    // los grupos con al menos un 12 % de la longitud total son grosores de muro, y una pareja con otro grosor
    // (el respaldo de un sofá, los peldaños de una escalera) no es un muro.
    const total = res.reduce((t, m) => t + (m.b - m.a), 0);
    // Densidad de grosores ponderada por longitud; sus picos son los grosores de muro candidatos.
    const dens = (c) => res.reduce((t, m) => t + (m.b - m.a) * Math.exp(-0.5 * ((m.t - c) / Math.max(1, 0.12 * c)) ** 2), 0);
    const tMax = Math.max(...res.map((m) => m.t), 1), picos = [];
    let previo = -1, actual = dens(1);
    for (let c = 1; c <= tMax + 1; c += 0.5) {
      const siguiente = dens(c + 0.5);
      if (actual > previo && actual >= siguiente) picos.push(c);
      previo = actual; actual = siguiente;
    }
    // Cada pareja va al pico más cercano; los picos que reúnen al menos un 12 % de la longitud son grosores de muro.
    const masa = picos.map(() => 0);
    for (const m of res) { let k = 0; picos.forEach((c, i) => { if (Math.abs(m.t - c) < Math.abs(m.t - picos[k])) k = i; }); if (Math.abs(m.t - picos[k]) <= Math.max(2, 0.25 * picos[k])) masa[k] += m.b - m.a; }
    const clases = picos.filter((c, i) => masa[i] >= 0.12 * total);
    const validos = clases.length ? res.filter((m) => clases.some((c) => Math.abs(m.t - c) <= Math.max(2, 0.25 * c))) : res;
    return { muros: validos, grueso: Math.max(2, (mediana(validos.map((m) => m.t)) || 2 * grueso) / 2), clases };
  }
  if (!modoLineas && opciones.muros !== 'dobles') {
    // Además de los trazos gruesos, los tabiques dibujados con dos líneas finas (habituales en planos impresos).
    const dm = distanciaA(masa, W, H), fina = new Uint8Array(N);
    for (let i = 0; i < N; i++) fina[i] = tinta[i] && dm[i] > 1.5 ? 1 : 0;
    const solapaGrueso = (m) => muros.some((n) => n.o === m.o && Math.abs(n.c - m.c) < Math.max(n.t, m.t) && Math.min(n.b, m.b) - Math.max(n.a, m.a) > 0.3 * (m.b - m.a));
    for (const m of murosDeLineas(fina).muros) if (m.t < 0.9 * grueso && !solapaGrueso(m)) muros.push({ ...m, delgado: true });
  }
  if (modoLineas) {
    const r = murosDeLineas();
    muros = r.muros; grueso = r.grueso; avisos.length = 0; masa.fill(0);
    // Trozos alineados de un mismo muro, del mismo grosor y separados menos que su grosor (la línea interior
    // partida por un baño o un armario), son un único muro. Una puerta o una ventana deja un hueco mayor.
    for (let cambio = true; cambio;) {
      cambio = false;
      for (let i = 0; i < muros.length && !cambio; i++) for (let j = 0; j < muros.length && !cambio; j++) {
        const m = muros[i], n = muros[j];
        if (i === j || m.o !== n.o || n.a < m.a) continue;
        const tMax = Math.max(m.t, n.t), hueco = n.a - m.b;
        if (Math.abs(m.c - n.c) > 0.35 * tMax || Math.abs(m.t - n.t) > 0.25 * tMax || hueco > 1.2 * Math.min(m.t, n.t)) continue;
        const lm = m.b - m.a, ln = n.b - n.a;
        muros[i] = { ...m, c: (m.c * lm + n.c * ln) / (lm + ln), t: (m.t * lm + n.t * ln) / (lm + ln), b: Math.max(m.b, n.b) };
        muros.splice(j, 1); cambio = true;
      }
    }
  }
  // Muros marcados a mano: los trazos pintados como muro pasan a ser muros aunque no lo parezcan.
  function murosMarcados(mk) {
    const sel = new Uint8Array(N);
    for (let i = 0; i < N; i++) sel[i] = tinta[i] && mk[i] ? 1 : 0;
    const banda = cerrar(sel, Math.max(2, Math.round(0.9 * grueso)));
    for (let i = 0; i < N; i++) if (!mk[i]) banda[i] = 0;
    const dB = distancia(banda, W, H), res = [];
    for (const camino of trazosEsqueleto(esqueleto(banda, W, H), W, H)) {
      const pts = simplificar(camino, Math.max(1.5, 0.5 * grueso));
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1], b = pts[k], dx = b[0] - a[0], dy = b[1] - a[1];
        if (Math.hypot(dx, dy) < 2 * grueso) continue;
        const ang = Math.atan2(Math.abs(dy), Math.abs(dx)) * 180 / Math.PI;
        if (ang > 15 && ang < 75) continue; // de momento, solo muros horizontales y verticales
        const gs = [];
        for (let q = 0; q <= 10; q++) {
          const x = Math.floor(a[0] + dx * q / 10), y = Math.floor(a[1] + dy * q / 10);
          if (x >= 0 && y >= 0 && x < W && y < H && dB[y * W + x]) gs.push(2 * dB[y * W + x] - 1);
        }
        const t = Math.max(0.6 * grueso, Math.min(2.6 * grueso, mediana(gs) || grueso));
        res.push(ang <= 15
          ? { o: 'h', c: (a[1] + b[1]) / 2, a: Math.min(a[0], b[0]) - t / 2, b: Math.max(a[0], b[0]) + t / 2, t, forzado: true }
          : { o: 'v', c: (a[0] + b[0]) / 2, a: Math.min(a[1], b[1]) - t / 2, b: Math.max(a[1], b[1]) + t / 2, t, forzado: true });
      }
    }
    return res;
  }
  if (marcas && marcas.muro) for (const m of murosMarcados(marcas.muro)) muros.push(m);
  muros = regularizarMuros(muros, grueso);
  for (const m of muros) if (m.forzado) m.suelto = false;
  // Un trozo corto y suelto se conserva si una ventana lo une a otro muro en el mismo eje (fachadas con
  // ventanas seguidas); si no, suele ser un poste, una letra gruesa o un borde, y se descarta.
  const ppm0 = opciones.pxPorMetro;
  const ventanaMax = ppm0 ? 3.0 * ppm0 : 18 * grueso;
  for (let vuelta = 0, cambio = true; cambio && vuelta < 20; vuelta++) {
    cambio = false;
    for (const m of muros) {
      if (!m.suelto) continue;
      const vecino = muros.some((n) => n !== m && !n.suelto && n.o === m.o && Math.abs(n.c - m.c) <= 0.6 * grueso &&
        [[m.b, n.a], [n.b, m.a]].some(([a, b]) => b - a >= 0.3 * grueso && b - a <= ventanaMax && pareceVentana(m.o, m.c, a, b, Math.min(m.t, n.t))));
      if (vecino) { m.suelto = false; cambio = true; }
    }
  }
  for (const m of muros) if (m.forzado) m.suelto = false;
  muros = muros.filter((m) => !m.suelto);
  if ((modoLineas || muros.some((m) => m.delgado)) && muros.length) {
    // Un mueble dibujado con dos líneas (respaldo de un sofá, un armario) forma una pieza suelta; los muros del
    // edificio se tocan entre sí. Se quedan los grupos de muros con al menos una quinta parte del grupo mayor.
    const rs = muros.map(rectMuro), pad = Math.max(2, grueso), padre = muros.map((_, i) => i);
    const raiz = (i) => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const r = rs[i], q = rs[j];
      if (r.x0 - pad <= q.x1 && q.x0 - pad <= r.x1 && r.y0 - pad <= q.y1 && q.y0 - pad <= r.y1) padre[raiz(i)] = raiz(j);
    }
    const total = new Map();
    muros.forEach((m, i) => total.set(raiz(i), (total.get(raiz(i)) || 0) + (m.b - m.a)));
    const mayor = Math.max(...total.values());
    muros = muros.filter((m, i) => m.forzado || (!modoLineas && !m.delgado) || total.get(raiz(i)) >= 0.2 * mayor || m.b - m.a >= 0.15 * lado);
  }

  // Muros a dos líneas: un tramo con una línea en el centro del muro es una ventana.
  const ventanasDobles = [];
  if (opciones.muros === 'dobles') {
    const largoMinVentana = opciones.pxPorMetro ? 0.4 * opciones.pxPorMetro : 3 * grueso;
    const nuevos = [];
    for (const m of muros) {
      const dentroBanda = [];
      for (let al = Math.ceil(m.a); al < m.b; al++) {
        let hay = false;
        for (let pe = Math.round(m.c - 0.15 * m.t); pe <= Math.round(m.c + 0.15 * m.t) && !hay; pe++) {
          const [x, y] = m.o === 'h' ? [al, pe] : [pe, al];
          if (x >= 0 && y >= 0 && x < W && y < H && tinta[y * W + x]) hay = true;
        }
        dentroBanda.push(hay);
      }
      let inicio = m.a, k = 0;
      const tramos = [];
      while (k < dentroBanda.length) {
        if (!dentroBanda[k]) { k++; continue; }
        let f = k; while (f < dentroBanda.length && dentroBanda[f]) f++;
        const a = Math.ceil(m.a) + k, b = Math.ceil(m.a) + f;
        if (b - a >= largoMinVentana && a - m.a > 0.5 * m.t && m.b - b > 0.5 * m.t) tramos.push([a, b]);
        k = f;
      }
      for (const [a, b] of tramos) {
        if (a - inicio >= 0.5 * m.t) nuevos.push({ ...m, a: inicio, b: a, unido: { a: m.unido && m.unido.a && inicio === m.a, b: false } });
        ventanasDobles.push({ tipo: 'ventana', o: m.o, c: m.c, a, b, t: m.t });
        inicio = b;
      }
      nuevos.push(tramos.length ? { ...m, a: inicio, unido: { a: false, b: m.unido && m.unido.b } } : m);
    }
    muros = nuevos;
  }

  // Puertas y ventanas marcadas a mano sobre un muro: se abre el hueco y se fuerza su tipo.
  const forzadas = [];
  const marcaEnBanda = (mk, o, c, t, al) => {
    for (let pe = Math.round(c - t / 2); pe <= Math.round(c + t / 2); pe++) {
      const [x, y] = o === 'h' ? [Math.round(al), pe] : [pe, Math.round(al)];
      if (x >= 0 && y >= 0 && x < W && y < H && mk[y * W + x]) return true;
    }
    return false;
  };
  const enBorrado = (x, y) => {
    if (!marcas || !marcas.borrar) return false;
    const X = Math.round(x), Y = Math.round(y);
    return X >= 0 && Y >= 0 && X < W && Y < H && marcas.borrar[Y * W + X] === 1;
  };
  if (marcas && marcas.borrar) {
    // Los tramos de muro cuyo eje cae en la zona borrada desaparecen (el resto del muro se conserva).
    const nuevos = [];
    for (const m of muros) {
      let inicio = null;
      const cerrar = (fin) => { if (inicio !== null && fin - inicio >= 1.5 * m.t) nuevos.push({ ...m, a: inicio, b: fin, unido: { a: inicio === m.a && !!(m.unido && m.unido.a), b: fin === m.b && !!(m.unido && m.unido.b) } }); inicio = null; };
      for (let al = m.a; al <= m.b; al += 1) {
        const [x, y] = m.o === 'h' ? [al, m.c] : [m.c, al];
        if (enBorrado(x, y)) cerrar(al); else if (inicio === null) inicio = al;
      }
      cerrar(m.b);
    }
    muros = nuevos;
  }
  for (const tipo of ['puerta', 'ventana']) {
    const mk = marcas && marcas[tipo];
    if (!mk) continue;
    const nuevos = [];
    for (const m of muros) {
      const tramos = [];
      let k = Math.ceil(m.a);
      while (k < m.b) {
        if (!marcaEnBanda(mk, m.o, m.c, m.t, k)) { k++; continue; }
        let f = k; while (f < m.b && marcaEnBanda(mk, m.o, m.c, m.t, f)) f++;
        if (f - k >= 1.5 * m.t) tramos.push([k, f]);
        k = f;
      }
      if (!tramos.length) { nuevos.push(m); continue; }
      let inicio = m.a;
      for (const [a, b] of tramos) {
        if (a - inicio >= 0.5 * m.t) nuevos.push({ ...m, a: inicio, b: a, unido: { a: !!(m.unido && m.unido.a && inicio === m.a), b: false } });
        forzadas.push({ o: m.o, c: m.c, a: Math.max(a, m.a), b: Math.min(b, m.b), t: m.t, forzado: tipo });
        inicio = b;
      }
      if (m.b - inicio >= 0.5 * m.t) nuevos.push({ ...m, a: inicio, unido: { a: false, b: !!(m.unido && m.unido.b) } });
    }
    muros = nuevos;
  }

  // Píxeles explicados por los muros (con un pequeño margen).
  const cubierto = new Uint8Array(N), margen = Math.max(1, 0.3 * grueso);
  for (const m of muros) {
    const r = rectMuro(m);
    for (let y = Math.max(0, Math.floor(r.y0 - margen)); y < Math.min(H, Math.ceil(r.y1 + margen)); y++)
      for (let x = Math.max(0, Math.floor(r.x0 - margen)); x < Math.min(W, Math.ceil(r.x1 + margen)); x++) cubierto[y * W + x] = 1;
  }
  // Pilares: manchas gruesas y compactas que no forman parte de un muro.
  const pilares = [];
  if (opciones.muros !== 'dobles') {
    const visto = new Uint8Array(N);
    for (let i0 = 0; i0 < N; i0++) {
      if (!masa[i0] || cubierto[i0] || visto[i0]) continue;
      const pila = [i0]; visto[i0] = 1;
      let x0 = W, y0 = H, x1 = 0, y1 = 0, area = 0;
      while (pila.length) {
        const i = pila.pop(), x = i % W, y = (i - x) / W;
        area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (const j of [i - 1, i + 1, i - W, i + W]) if (j >= 0 && j < N && masa[j] && !cubierto[j] && !visto[j]) { visto[j] = 1; pila.push(j); }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (bw >= 1.3 * grueso && bh >= 1.3 * grueso && bw <= 3 * grueso && bh <= 3 * grueso &&
          Math.max(bw, bh) / Math.min(bw, bh) <= 1.6 && area >= 0.65 * bw * bh) {
        // De un poste sale al menos una línea recta y continua (cerramiento, barandilla); de una letra gruesa, no.
        const cx0 = (x0 + x1) / 2, cy0 = (y0 + y1) / 2, largoRayo = Math.round(4 * grueso);
        const rayo = (dx, dy) => {
          let hay = 0;
          const inicio = dx ? (dx > 0 ? x1 : x0) : (dy > 0 ? y1 : y0);
          for (let k = 2; k <= largoRayo; k++) {
            let h = false;
            for (let lado = -1; lado <= 1 && !h; lado++) {
              const X = dx ? inicio + dx * k : Math.round(cx0) + lado, Y = dy ? inicio + dy * k : Math.round(cy0) + lado;
              if (X >= 0 && Y >= 0 && X < W && Y < H && tinta[Y * W + X]) h = true;
            }
            if (h) hay++;
          }
          return hay / (largoRayo - 1);
        };
        const X0 = 0, X1 = Math.max(rayo(1, 0), rayo(-1, 0), rayo(0, 1), rayo(0, -1)) >= 0.9 ? 6 * grueso : 0, Y0 = 0, Y1 = 0;
        if (Math.max(X1 - X0, Y1 - Y0) >= 6 * grueso) {
          const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2, s = Math.max(bw, bh) / 2;
          pilares.push({ x0: cx - s, y0: cy - s, x1: cx + s, y1: cy + s });
        }
      }
    }
    for (const p of pilares)
      for (let y = Math.max(0, Math.floor(p.y0 - margen)); y < Math.min(H, Math.ceil(p.y1 + margen)); y++)
        for (let x = Math.max(0, Math.floor(p.x0 - margen)); x < Math.min(W, Math.ceil(p.x1 + margen)); x++) cubierto[y * W + x] = 1;
  }
  if (marcas && marcas.pilar) {
    // Pilares marcados a mano: cada mancha pintada como pilar.
    const visto = new Uint8Array(N), mk = marcas.pilar;
    for (let i0 = 0; i0 < N; i0++) {
      if (!tinta[i0] || !mk[i0] || visto[i0]) continue;
      const pila = [i0]; visto[i0] = 1;
      let x0 = W, y0 = H, x1 = 0, y1 = 0, area = 0;
      while (pila.length) {
        const i = pila.pop(), x = i % W, y = (i - x) / W;
        area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (const j of [i - 1, i + 1, i - W, i + W]) if (j >= 0 && j < N && tinta[j] && mk[j] && !visto[j]) { visto[j] = 1; pila.push(j); }
      }
      if (area < 4) continue;
      const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2, lado = Math.max(0.6 * grueso, Math.max(x1 - x0 + 1, y1 - y0 + 1) / 2);
      const p = { x0: cx - lado, y0: cy - lado, x1: cx + lado, y1: cy + lado };
      pilares.push(p);
      for (let y = Math.max(0, Math.floor(p.y0 - margen)); y < Math.min(H, Math.ceil(p.y1 + margen)); y++)
        for (let x = Math.max(0, Math.floor(p.x0 - margen)); x < Math.min(W, Math.ceil(p.x1 + margen)); x++) cubierto[y * W + x] = 1;
    }
  }
  for (let k = pilares.length - 1; k >= 0; k--) { const p = pilares[k]; if (enBorrado((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2)) pilares.splice(k, 1); }
  const resto = new Uint8Array(N);
  for (let i = 0; i < N; i++) resto[i] = tinta[i] && !cubierto[i] ? 1 : 0;
  const dResto = distanciaA(resto, W, H);

  // ---- huecos en los muros
  const candidatos = [];
  const huecoMin = 1.8 * grueso, huecoMax = Math.max(30 * grueso, lado * 0.25);
  for (const o of ['h', 'v']) {
    const lista = muros.filter((m) => m.o === o).sort((a, b) => a.c - b.c || a.a - b.a);
    for (const m of lista) {
      // Siguiente muro en el mismo eje.
      let sig = null;
      for (const n of lista) if (n !== m && Math.abs(n.c - m.c) <= 0.5 * grueso && n.a >= m.b && (!sig || n.a < sig.a)) sig = n;
      if (sig && sig.a - m.b >= huecoMin && sig.a - m.b <= huecoMax) candidatos.push({ o, c: m.c, a: m.b, b: sig.a, t: Math.min(m.t, sig.t) });
    }
    // Extremo libre de un muro frente a un muro perpendicular.
    for (const m of lista) for (const lado2 of ['a', 'b']) {
      if (m.unido && m.unido[lado2]) continue;
      const dir = lado2 === 'b' ? 1 : -1, fin = m[lado2];
      let mejor = null, dist = huecoMax;
      for (const p of muros) {
        if (p.o === o || m.c < p.a || m.c > p.b) continue;
        const d = dir * (p.c - fin) - p.t / 2;
        if (d >= huecoMin && d < dist) { dist = d; mejor = p; }
      }
      const ya = lista.some((n) => n !== m && Math.abs(n.c - m.c) <= 0.5 * grueso && (dir > 0 ? n.a >= fin && n.a < fin + dist : n.b <= fin && n.b > fin - dist));
      if (mejor && !ya) candidatos.push(dir > 0 ? { o, c: m.c, a: fin, b: fin + dist, t: m.t } : { o, c: m.c, a: fin - dist, b: fin, t: m.t });
    }
  }
  const punto = (o, al, pe) => (o === 'h' ? [al, pe] : [pe, al]);
  const tocado = (x, y, tol) => { const X = Math.round(x), Y = Math.round(y); return X >= 0 && Y >= 0 && X < W && Y < H && dResto[Y * W + X] <= tol; };
  // Ancho de puerta admisible: con escala conocida, de 0,5 a 1,3 m por hoja; si no, según el grosor del muro.
  const ppm = opciones.pxPorMetro;
  const puertaMin = ppm ? 0.5 * ppm : huecoMin, puertaMax = ppm ? 1.3 * ppm : (modoLineas ? Math.max(9 * grueso, 0.09 * lado) : 9 * grueso);
  function puntuarArco(o, bisagra, otro, cara, R) {
    const u = Math.sign(otro - bisagra), tol = Math.min(Math.max(2, 0.08 * R), 2 + 0.5 * grueso);
    let arco = 0, n = 0, hoja = 0, nh = 0, lleno = 0, nl = 0, racha = 0, rachaMax = 0;
    for (let k = 0; k <= 20; k++) {
      const th = (8 + 74 * k / 20) * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
      const [x, y] = punto(o, bisagra + u * R * cs, cara.pe + cara.s * R * sn);
      n++; if (tocado(x, y, tol)) { arco++; rachaMax = Math.max(rachaMax, ++racha); } else racha = 0;
      // Dentro del giro de una puerta no suele haber dibujo.
      for (const f of [0.45, 0.7]) {
        const [xi, yi] = punto(o, bisagra + u * R * f * cs, cara.pe + cara.s * R * f * sn);
        nl++; if (tocado(xi, yi, 0.5)) lleno++;
      }
    }
    for (let k = 1; k <= 8; k++) {
      const [x, y] = punto(o, bisagra, cara.pe + cara.s * R * k / 9);
      nh++; if (tocado(x, y, tol)) hoja++;
    }
    const vacio = 1 - lleno / nl;
    return { arco: vacio >= 0.75 ? Math.min(arco, rachaMax + 3) / n : 0, hoja: hoja / nh };
  }
  const tipoMarcado = (h) => {
    if (!marcas) return null;
    for (const tipo of ['puerta', 'ventana']) {
      const mk = marcas[tipo];
      if (!mk) continue;
      let si = 0, n = 0;
      for (let al = Math.ceil(h.a); al < h.b; al++) { n++; if (marcaEnBanda(mk, h.o, h.c, h.t, al)) si++; }
      if (n && si / n >= 0.3) return tipo;
    }
    return null;
  };
  for (let i = forzadas.length - 1; i >= 0; i--) candidatos.unshift(forzadas[i]);
  const aberturas = [...ventanasDobles];
  const consumir = ventanasDobles.map((v) => ({ forma: 'caja', o: v.o, c: v.c, a: v.a, b: v.b, t: v.t }));
  for (const h of candidatos) {
    const g0 = h.b - h.a;
    if (aberturas.some((x) => x.o === h.o && Math.abs(x.c - h.c) < grueso && Math.min(x.b, h.b) - Math.max(x.a, h.a) > 0.3 * g0)) continue;
    { const medio = (h.a + h.b) / 2, [mx, my] = h.o === 'h' ? [medio, h.c] : [h.c, medio]; if (enBorrado(mx, my)) continue; }
    const forz = h.forzado || tipoMarcado(h);
    if (forz === 'ventana') {
      aberturas.push({ tipo: 'ventana', o: h.o, c: h.c, a: h.a, b: h.b, t: h.t });
      consumir.push({ forma: 'caja', o: h.o, c: h.c, a: h.a, b: h.b, t: h.t });
      continue;
    }
    // ¿Puerta? Un arco de radio el ancho del hueco, a un lado del muro. Si está marcada como puerta, lo es
    // seguro: solo se busca el lado y la bisagra que mejor encajan con el dibujo.
    const marcada = forz === 'puerta';
    let mejor = marcada ? (g0 > 1.4 * puertaMax
      ? { v: -1, tipo: 'puerta-doble', bisagras: [[h.a, (h.a + h.b) / 2], [h.b, (h.a + h.b) / 2]], s: 1, R: g0 / 2 }
      : { v: -1, tipo: 'puerta', bisagras: [[h.a, h.b]], s: 1, R: g0 }) : null;
    for (const s of [-1, 1]) {
      const cara = { pe: h.c + s * h.t / 2, s };
      if (marcada || (g0 >= puertaMin && g0 <= puertaMax)) {
        for (const [bis, otro] of [[h.a, h.b], [h.b, h.a]]) {
          const p = puntuarArco(h.o, bis, otro, cara, g0);
          const v = p.arco + 0.25 * p.hoja;
          if ((marcada || p.arco >= 0.6) && (!mejor || v > mejor.v)) mejor = { v, tipo: 'puerta', bisagras: [[bis, otro]], s, R: g0 };
        }
      }
      const mitad = (h.a + h.b) / 2;
      if (marcada || (g0 / 2 >= puertaMin * 0.8 && g0 / 2 <= puertaMax)) {
        const p1 = puntuarArco(h.o, h.a, mitad, cara, g0 / 2), p2 = puntuarArco(h.o, h.b, mitad, cara, g0 / 2);
        const v2 = Math.min(p1.arco, p2.arco) + 0.1;
        if ((marcada ? v2 > 0.1 : p1.arco >= 0.6 && p2.arco >= 0.6) && (!mejor || v2 > mejor.v)) mejor = { v: v2, tipo: 'puerta-doble', bisagras: [[h.a, mitad], [h.b, mitad]], s, R: g0 / 2 };
      }
    }
    if (mejor) {
      for (const [bis, otro] of mejor.bisagras) {
        const u = Math.sign(otro - bis);
        const centro = punto(h.o, bis, h.c + mejor.s * h.t / 2);
        aberturas.push({ tipo: 'puerta', o: h.o, c: h.c, a: Math.min(bis, otro), b: Math.max(bis, otro), t: h.t, bisagra: centro,
          al: punto(h.o, u, 0), pe: punto(h.o, 0, mejor.s), ancho: mejor.R });
        consumir.push({ forma: 'arco', centro, R: mejor.R, al: punto(h.o, u, 0), pe: punto(h.o, 0, mejor.s) });
      }
      continue;
    }
    if (g0 <= ventanaMax && pareceVentana(h.o, h.c, h.a, h.b, h.t)) {
      aberturas.push({ tipo: 'ventana', o: h.o, c: h.c, a: h.a, b: h.b, t: h.t });
      consumir.push({ forma: 'caja', o: h.o, c: h.c, a: h.a, b: h.b, t: h.t });
    } else aberturas.push({ tipo: 'hueco', o: h.o, c: h.c, a: h.a, b: h.b, t: h.t });
  }

  // Quita del resto las líneas que ya representan las puertas y ventanas.
  for (const z of consumir) {
    if (z.forma === 'caja') {
      const r = rectMuro({ o: z.o, c: z.c, a: z.a, b: z.b, t: z.t + 2 * margen });
      for (let y = Math.max(0, Math.floor(r.y0)); y < Math.min(H, Math.ceil(r.y1)); y++)
        for (let x = Math.max(0, Math.floor(r.x0)); x < Math.min(W, Math.ceil(r.x1)); x++) resto[y * W + x] = 0;
    } else {
      const tol = Math.max(2.5, 0.2 * z.R), [cx, cy] = z.centro, R = z.R;
      for (let y = Math.max(0, Math.floor(cy - R - tol)); y < Math.min(H, cy + R + tol); y++)
        for (let x = Math.max(0, Math.floor(cx - R - tol)); x < Math.min(W, cx + R + tol); x++) {
          const vx = x + 0.5 - cx, vy = y + 0.5 - cy;
          const a = vx * z.al[0] + vy * z.al[1], p = vx * z.pe[0] + vy * z.pe[1];
          const dArco = a >= -tol && p >= -tol ? Math.abs(Math.hypot(a, p) - R) : 1e9;
          const dHoja = p >= -tol && p <= R + tol ? Math.abs(a) : 1e9;
          if (Math.min(dArco, dHoja) <= tol) resto[y * W + x] = 0;
        }
    }
  }

  // ---- resto del dibujo: componentes, clasificación y trazos
  const comp = new Int32Array(N).fill(-1), comps = [];
  for (let i0 = 0; i0 < N; i0++) {
    if (!resto[i0] || comp[i0] >= 0) continue;
    const id = comps.length, pila = [i0];
    comp[i0] = id;
    let x0 = W, y0 = H, x1 = 0, y1 = 0, area = 0, gruesa = 0, tocaMuro = false;
    while (pila.length) {
      const i = pila.pop(), x = i % W, y = (i - x) / W;
      area++; if (masa[i]) gruesa++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const j = Y * W + X; if (cubierto[j]) tocaMuro = true; if (resto[j] && comp[j] < 0) { comp[j] = id; pila.push(j); }
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1, mayor = Math.max(bw, bh), menor = Math.min(bw, bh);
    let capa = 'DETALLES';
    if (area < Math.max(4, 0.15 * grueso * grueso)) capa = null; // motas
    else if (tocaMuro && mayor <= 2.5 * grueso) capa = null; // rebabas del borde del muro
    else if (mayor <= 4.5 * grueso && mayor / menor < 5) capa = 'TEXTO-A-MANO';
    else if (gruesa > 0.5 * area && mayor > 4.5 * grueso) capa = 'REVISAR';
    comps.push({ capa });
  }
  const esq = esqueleto(resto, W, H);
  const lineas = [];
  for (const camino of trazosEsqueleto(esq, W, H)) {
    const [x, y] = camino[0].map(Math.floor), c = comp[y * W + x];
    const capa = c >= 0 ? comps[c].capa : 'DETALLES';
    if (!capa) continue;
    let pts = simplificar(camino, Math.max(0.9, 0.18 * grueso));
    if (capa === 'DETALLES' || capa === 'REVISAR') pts = ortogonalizar(rectificar(pts, modoLineas ? Math.max(3, 0.008 * lado) : Math.max(3, 1.2 * grueso, 0.006 * lado), modoLineas ? 0.03 * lado : Math.max(8 * grueso, 0.06 * lado)));
    if (longitud(pts) < Math.max(2, 0.5 * grueso) && capa !== 'TEXTO-A-MANO') continue;
    lineas.push({ capa, pts });
  }

  // ---- edificio principal: muros que se tocan o que une una puerta o ventana
  const padre = muros.map((_, i) => i);
  const raiz = (i) => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
  const unir = (i, j) => { padre[raiz(i)] = raiz(j); };
  const rects = muros.map(rectMuro);
  const tocan = (r, s, e) => r.x0 - e <= s.x1 && s.x0 - e <= r.x1 && r.y0 - e <= s.y1 && s.y0 - e <= r.y1;
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (tocan(rects[i], rects[j], Math.max(2, grueso))) unir(i, j);
  for (const a of aberturas) {
    if (a.tipo === 'hueco') continue;
    const r = rectMuro(a), lados = rects.map((s, i) => (tocan(r, s, 2) ? i : -1)).filter((i) => i >= 0);
    for (let n = 1; n < lados.length; n++) unir(lados[0], lados[n]);
  }
  const largoGrupo = new Map();
  muros.forEach((m, i) => largoGrupo.set(raiz(i), (largoGrupo.get(raiz(i)) || 0) + (m.b - m.a)));
  let grupoMayor = -1, largoMayor = 0;
  for (const [g2, l] of largoGrupo) if (l > largoMayor) { largoMayor = l; grupoMayor = g2; }
  let principal = null;
  muros.forEach((m, i) => {
    if ((largoGrupo.get(raiz(i)) || 0) < 0.15 * largoMayor) return; // grupos pequeños: cajetín, restos sueltos
    const r = rects[i];
    principal = principal ? { x0: Math.min(principal.x0, r.x0), y0: Math.min(principal.y0, r.y0), x1: Math.max(principal.x1, r.x1), y1: Math.max(principal.y1, r.y1) } : { ...r };
  });

  // ---- contornos de los muros
  const lazos = contornosUnion(muros.map(rectMuro));
  const signoExterior = Math.sign(areaFirmada([[0, 0], [1, 0], [1, 1], [0, 1]])); // recorrido con el interior a la derecha
  const exteriores = lazos.filter((l) => Math.sign(areaFirmada(l)) === signoExterior);
  const interiores = lazos.filter((l) => Math.sign(areaFirmada(l)) !== signoExterior);
  // Un punto dentro de cada zona de muro, para el relleno.
  const puntosRelleno = [];
  for (const ext of exteriores) {
    const huecos = interiores.filter((h) => dentro(h[0], ext));
    const m = muros.map(rectMuro).map((r) => [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2]).find((p) => dentro(p, ext) && !huecos.some((h) => dentro(p, h)));
    if (m) puntosRelleno.push(m);
  }

  return {
    W, H, grosor: { fino: g.fino, grueso }, muros, aberturas, pilares, lineas, lazos, exteriores, principal, puntosRelleno: [...puntosRelleno, ...pilares.map((p) => [(p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2])], avisos,
    resumen: {
      muros: muros.length,
      puertas: aberturas.filter((a) => a.tipo === 'puerta').length,
      ventanas: aberturas.filter((a) => a.tipo === 'ventana').length,
      huecos: aberturas.filter((a) => a.tipo === 'hueco').length,
      pilares: pilares.length,
    },
  };
}

// ---------------------------------------------------------------- DXF
const CAPAS = [
  ['MUROS', 7], ['MUROS-RELLENO', 253], ['PILARES', 7], ['PUERTAS', 4], ['VENTANAS', 5], ['TEXTO-A-MANO', 2],
  ['DETALLES', 8], ['REVISAR', 1], ['COTAS', 3],
];
function dxfR12(modelo, k) {
  const H = modelo.H, out = [];
  const par = (c, v) => out.push(String(c), typeof v === 'number' ? (Number.isInteger(v) && Math.abs(c) >= 60 && Math.abs(c) < 80 ? String(v) : v.toFixed(6)) : String(v));
  const P = ([x, y]) => [x * k, (H - y) * k];
  const V = ([x, y]) => [x, -y];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ampliar = ([x, y]) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  par(0, 'SECTION'); par(2, 'HEADER'); par(9, '$ACADVER'); par(1, 'AC1009');
  par(9, '$INSBASE'); par(10, 0); par(20, 0); par(30, 0); par(0, 'ENDSEC');
  par(0, 'SECTION'); par(2, 'TABLES');
  par(0, 'TABLE'); par(2, 'LTYPE'); par(70, 1); par(0, 'LTYPE'); par(2, 'CONTINUOUS'); par(70, 0); par(3, 'Solid line'); par(72, 65); par(73, 0); par(40, 0); par(0, 'ENDTAB');
  par(0, 'TABLE'); par(2, 'LAYER'); par(70, CAPAS.length + 1);
  for (const [n, c] of [['0', 7], ...CAPAS]) { par(0, 'LAYER'); par(2, n); par(70, 0); par(62, c); par(6, 'CONTINUOUS'); }
  par(0, 'ENDTAB'); par(0, 'ENDSEC');
  // Bloques: puerta de ancho 1 con la bisagra en el origen, y ventana de 1 x 1.
  par(0, 'SECTION'); par(2, 'BLOCKS');
  par(0, 'BLOCK'); par(8, '0'); par(2, 'PUERTA'); par(70, 0); par(10, 0); par(20, 0); par(30, 0); par(3, 'PUERTA');
  par(0, 'LINE'); par(8, '0'); par(10, 0); par(20, 0); par(30, 0); par(11, 0); par(21, 1); par(31, 0);
  par(0, 'ARC'); par(8, '0'); par(10, 0); par(20, 0); par(30, 0); par(40, 1); par(50, 0); par(51, 90);
  par(0, 'ENDBLK'); par(8, '0');
  par(0, 'BLOCK'); par(8, '0'); par(2, 'VENTANA'); par(70, 0); par(10, 0); par(20, 0); par(30, 0); par(3, 'VENTANA');
  for (const [a, b] of [[[0, -0.5], [1, -0.5]], [[1, -0.5], [1, 0.5]], [[1, 0.5], [0, 0.5]], [[0, 0.5], [0, -0.5]], [[0, 0], [1, 0]]]) {
    par(0, 'LINE'); par(8, '0'); par(10, a[0]); par(20, a[1]); par(30, 0); par(11, b[0]); par(21, b[1]); par(31, 0);
  }
  par(0, 'ENDBLK'); par(8, '0');
  par(0, 'ENDSEC');
  par(0, 'SECTION'); par(2, 'ENTITIES');
  const polilinea = (capa, pts, cerrada) => {
    par(0, 'POLYLINE'); par(8, capa); par(66, 1); par(10, 0); par(20, 0); par(30, 0); par(70, cerrada ? 1 : 0);
    for (const p of pts) { const [x, y] = P(p); ampliar([x, y]); par(0, 'VERTEX'); par(8, capa); par(10, x); par(20, y); par(30, 0); }
    par(0, 'SEQEND'); par(8, capa);
  };
  for (const l of modelo.lazos) polilinea('MUROS', l, true);
  for (const p of modelo.pilares || []) polilinea('PILARES', [[p.x0, p.y0], [p.x1, p.y0], [p.x1, p.y1], [p.x0, p.y1]], true);
  for (const a of modelo.aberturas) {
    if (a.tipo === 'puerta') {
      const [x, y] = P(a.bisagra), al = V(a.al), pe = V(a.pe);
      const rot = Math.atan2(al[1], al[0]) * 180 / Math.PI;
      const izquierda = [-al[1], al[0]];
      const s = pe[0] * izquierda[0] + pe[1] * izquierda[1] >= 0 ? 1 : -1;
      par(0, 'INSERT'); par(8, 'PUERTAS'); par(2, 'PUERTA'); par(10, x); par(20, y); par(30, 0);
      par(41, a.ancho * k); par(42, s * a.ancho * k); par(43, 1); par(50, rot);
    } else if (a.tipo === 'ventana') {
      const ini = a.o === 'h' ? [a.a, a.c] : [a.c, a.a];
      const [x, y] = P(ini), al = V(a.o === 'h' ? [1, 0] : [0, 1]);
      par(0, 'INSERT'); par(8, 'VENTANAS'); par(2, 'VENTANA'); par(10, x); par(20, y); par(30, 0);
      par(41, (a.b - a.a) * k); par(42, a.t * k); par(43, 1); par(50, Math.atan2(al[1], al[0]) * 180 / Math.PI);
    }
  }
  for (const l of modelo.lineas) if (l.pts.length >= 2) polilinea(l.capa, l.pts, false);
  par(0, 'ENDSEC'); par(0, 'EOF');
  return { texto: out.join('\r\n') + '\r\n', extension: { minX, minY, maxX, maxY } };
}

// Imagen de control con lo reconocido en colores (para revisar el reconocedor).
function imagenControl(modelo, png) {
  const { W, H, tinta } = leerPng(png);
  const rgb = new Uint8Array(W * H * 3).fill(255);
  for (let i = 0; i < W * H; i++) if (tinta[i]) rgb.set([200, 200, 200], i * 3);
  const pinta = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < W && y < H) rgb.set(c, (y * W + x) * 3); };
  for (const p of modelo.pilares || []) for (let y = p.y0; y < p.y1; y++) for (let x = p.x0; x < p.x1; x++) pinta(x, y, [140, 0, 200]);
  for (const m of modelo.muros) { const r = rectMuro(m); for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) pinta(x, y, [200, 40, 40]); }
  const colores = { 'TEXTO-A-MANO': [200, 150, 0], DETALLES: [90, 90, 90], REVISAR: [255, 0, 200] };
  for (const l of modelo.lineas) for (let n = 1; n < l.pts.length; n++) {
    const [a, b] = [l.pts[n - 1], l.pts[n]], pasos = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
    for (let s = 0; s <= pasos; s++) pinta(a[0] + (b[0] - a[0]) * s / (pasos || 1), a[1] + (b[1] - a[1]) * s / (pasos || 1), colores[l.capa]);
  }
  for (const a of modelo.aberturas) {
    if (a.tipo === 'puerta') {
      for (let s = 0; s <= 60; s++) { const th = s / 60 * Math.PI / 2; pinta(a.bisagra[0] + a.ancho * (Math.cos(th) * a.al[0] + Math.sin(th) * a.pe[0]), a.bisagra[1] + a.ancho * (Math.cos(th) * a.al[1] + Math.sin(th) * a.pe[1]), [0, 160, 0]); }
      for (let s = 0; s <= 30; s++) pinta(a.bisagra[0] + a.ancho * s / 30 * a.pe[0], a.bisagra[1] + a.ancho * s / 30 * a.pe[1], [0, 160, 0]);
    } else {
      const r = rectMuro(a), c = a.tipo === 'ventana' ? [0, 90, 255] : [255, 160, 0];
      for (let x = r.x0; x <= r.x1; x++) { pinta(x, r.y0, c); pinta(x, r.y1, c); }
      for (let y = r.y0; y <= r.y1; y++) { pinta(r.x0, y, c); pinta(r.x1, y, c); }
    }
  }
  return escribirPngRgb(W, H, rgb);
}

// Convierte los trazos pintados en la tablet ({tipo, r, pts} en píxeles de la imagen) en una máscara por tipo.
function mascaraDeTrazos(trazos, W, H) {
  const tipos = ['muro', 'puerta', 'ventana', 'pilar', 'borrar'], m = {};
  for (const t of trazos || []) {
    if (!tipos.includes(t.tipo) || !t.pts || !t.pts.length) continue;
    const mk = m[t.tipo] || (m[t.tipo] = new Uint8Array(W * H));
    const r = Math.max(1, t.r), r2 = r * r;
    const sello = (cx, cy) => {
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++)
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++)
          if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2) mk[y * W + x] = 1;
    };
    sello(t.pts[0][0], t.pts[0][1]);
    for (let k = 1; k < t.pts.length; k++) {
      const a = t.pts[k - 1], b = t.pts[k], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (r / 2)));
      for (let q = 1; q <= n; q++) sello(a[0] + (b[0] - a[0]) * q / n, a[1] + (b[1] - a[1]) * q / n);
    }
  }
  return Object.keys(m).length ? m : null;
}

// Calco: todo el dibujo como líneas, sin reconocer nada.
function calcar(imagen) {
  const { W, H, tinta } = imagen;
  const lineas = [];
  for (const camino of trazosEsqueleto(esqueleto(tinta, W, H), W, H)) {
    const pts = simplificar(camino, 0.9);
    if (pts.length >= 2 && longitud(pts) >= 2) lineas.push({ capa: 'DIBUJO', pts });
  }
  return { W, H, grosor: { fino: 1, grueso: 1 }, muros: [], aberturas: [], pilares: [], lineas, lazos: [], exteriores: [],
    principal: null, puntosRelleno: [], avisos: [], resumen: { muros: 0, puertas: 0, ventanas: 0, huecos: 0, pilares: 0, lineas: lineas.length } };
}

const API = { reconocer, reconocerMascara, calcar, mascaraDeTrazos, esqueleto, trazosEsqueleto, rectMuro, dxfR12, imagenControl, leerPng };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else self.Reconocer = API;
})();

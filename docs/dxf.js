// De la imagen limpia al DXF para AutoCAD, sin servidor: escala, reconocimiento y escritura.
// Formato DXF R12 (AC1009), el que AutoCAD y casi cualquier programa de CAD abren sin problemas.
// Funciona en el navegador (worker) y en Node.
(function () {
'use strict';
const R = typeof module !== 'undefined' && module.exports && typeof require === 'function' ? require('./reconocer.js') : self.Reconocer;

const MM_POR_UNIDAD = { mm: 1, cm: 10, m: 1000 };
const ANCHO_PUERTA_M = 0.8; // ancho supuesto de una puerta cuando no hay medida de referencia
const CAPAS = [
  ['MUROS', 7], ['MUROS-RELLENO', 252], ['PILARES', 7], ['PUERTAS', 4], ['VENTANAS', 5],
  ['COTAS', 3], ['TEXTO-A-MANO', 2], ['DETALLES', 8], ['REVISAR', 1], ['DIBUJO', 7],
];

// opciones: { tipo: 'plano'|'calco', muros: 'grueso'|'dobles', unidad: 'm'|'cm'|'mm', referencia?: {p1, p2, real} }
function convertirPlano(imagen, opciones) {
  const unidad = MM_POR_UNIDAD[opciones.unidad] ? opciones.unidad : 'm';
  const metrosPorUnidad = MM_POR_UNIDAD[unidad] / 1000;
  const ref = opciones.referencia;
  const pxRef = ref ? Math.hypot(ref.p2[0] - ref.p1[0], ref.p2[1] - ref.p1[1]) : 0;
  let k, origenEscala, modelo;
  // Si en «trazo grueso» no se distinguen muros (todas las líneas son finas, como en un plano impreso),
  // se reconoce automáticamente en el modo de líneas.
  const reconocerConModo = (img, op) => {
    let m = R.reconocerMascara(img, op);
    const fino = m.grosor.grueso / Math.max(img.W, img.H) < 0.003; // trazos más gruesos por debajo del 3 por mil
    if ((op.muros || 'grueso') === 'grueso' && (fino || m.avisos.some((t) => t.startsWith('No se distinguen')))) {
      m = R.reconocerMascara(img, { ...op, muros: 'lineas' });
      m.avisos = ['Todas las líneas son finas: se ha reconocido como plano impreso, con los muros a dos líneas.', ...m.avisos];
    }
    return m;
  };
  // Marcas pintadas a mano en la tablet (muro, puerta, ventana, pilar, borrar).
  const marcas = opciones.trazos && opciones.trazos.length ? R.mascaraDeTrazos(opciones.trazos, imagen.W, imagen.H) : null;
  if (opciones.tipo === 'calco') {
    let img = imagen;
    if (marcas && marcas.borrar) img = { W: imagen.W, H: imagen.H, tinta: imagen.tinta.map((v, i) => (marcas.borrar[i] ? 0 : v)) };
    modelo = R.calcar(img);
    if (pxRef > 0) { k = ref.real / pxRef; origenEscala = 'medida'; }
    else { k = (25.4 / 72) / MM_POR_UNIDAD[unidad]; origenEscala = 'ninguna'; }
  } else if (pxRef > 0) {
    k = ref.real / pxRef; // unidades de dibujo por píxel
    origenEscala = 'medida';
    modelo = reconocerConModo(imagen, { muros: opciones.muros, marcas, pxPorMetro: 1 / (k * metrosPorUnidad) });
  } else {
    modelo = reconocerConModo(imagen, { muros: opciones.muros, marcas });
    // Las puertas que marcó el usuario mandan; si no hay, hacen falta al menos dos detectadas de ancho parecido.
    const puertas = modelo.aberturas.filter((a) => a.tipo === 'puerta');
    const marcadas = puertas.filter((a) => a.marcada).map((a) => a.ancho).sort((a, b) => a - b);
    let anchos = puertas.map((a) => a.ancho).sort((a, b) => a - b);
    if (anchos.length) anchos = anchos.filter((w) => w >= 0.5 * anchos[anchos.length - 1]);
    if (marcadas.length) anchos = marcadas;
    if (marcadas.length || anchos.length >= 2) {
      k = (ANCHO_PUERTA_M / metrosPorUnidad) / anchos[anchos.length >> 1];
      origenEscala = 'puertas';
      modelo = reconocerConModo(imagen, { muros: opciones.muros, marcas, pxPorMetro: 1 / (k * metrosPorUnidad) });
    } else {
      k = (25.4 / 72) / MM_POR_UNIDAD[unidad];
      origenEscala = 'ninguna';
    }
  }
  return { dxf: escribirDxf(modelo, k, ref && pxRef > 0 ? ref : null), modelo, k, origenEscala, unidad };
}

function escribirDxf(modelo, k, ref) {
  const H = modelo.H;
  const P = ([x, y]) => [x * k, (H - y) * k]; // píxeles -> unidades de dibujo (y hacia arriba)
  const V = ([x, y]) => [x, -y];
  const num = (v) => { const s = (Math.abs(v) < 1e-9 ? 0 : v).toFixed(6); return s.replace(/\.?0+$/, '') || '0'; };
  const cuerpo = [], bloques = [];
  const par = (lista, c, v) => lista.push(String(c), typeof v === 'number' ? (c >= 60 && c < 80 ? String(Math.round(v)) : num(v)) : String(v));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ampliar = ([x, y]) => { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; };

  const linea = (L, capa, a, b) => { par(L, 0, 'LINE'); par(L, 8, capa); par(L, 10, a[0]); par(L, 20, a[1]); par(L, 30, 0); par(L, 11, b[0]); par(L, 21, b[1]); par(L, 31, 0); };
  const polilinea = (L, capa, pts, cerrada) => {
    par(L, 0, 'POLYLINE'); par(L, 8, capa); par(L, 66, 1); par(L, 10, 0); par(L, 20, 0); par(L, 30, 0); par(L, 70, cerrada ? 1 : 0);
    for (const p of pts) { par(L, 0, 'VERTEX'); par(L, 8, capa); par(L, 10, p[0]); par(L, 20, p[1]); par(L, 30, 0); ampliar(p); }
    par(L, 0, 'SEQEND'); par(L, 8, capa);
  };
  const solido = (L, capa, x0, y0, x1, y1) => { // rectángulo relleno (orden de vértices de SOLID: 1, 2, 4, 3)
    par(L, 0, 'SOLID'); par(L, 8, capa);
    par(L, 10, x0); par(L, 20, y0); par(L, 30, 0); par(L, 11, x1); par(L, 21, y0); par(L, 31, 0);
    par(L, 12, x0); par(L, 22, y1); par(L, 32, 0); par(L, 13, x1); par(L, 23, y1); par(L, 33, 0);
  };
  const rectMundo = (r) => { const a = P([r.x0, r.y1]), b = P([r.x1, r.y0]); return [a[0], a[1], b[0], b[1]]; };

  // Muros: relleno debajo y contorno encima; pilares igual.
  for (const m of modelo.muros) { const [x0, y0, x1, y1] = rectMundo(R.rectMuro(m)); solido(cuerpo, 'MUROS-RELLENO', x0, y0, x1, y1); }
  for (const p of modelo.pilares || []) { const [x0, y0, x1, y1] = rectMundo(p); solido(cuerpo, 'MUROS-RELLENO', x0, y0, x1, y1); }
  for (const l of modelo.lazos) polilinea(cuerpo, 'MUROS', l.map(P), true);
  for (const p of modelo.pilares || []) { const [x0, y0, x1, y1] = rectMundo(p); polilinea(cuerpo, 'PILARES', [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], true); }

  // Puertas y ventanas como bloques.
  for (const a of modelo.aberturas) {
    if (a.tipo === 'puerta') {
      const [x, y] = P(a.bisagra), al = V(a.al), pe = V(a.pe);
      const izquierda = [-al[1], al[0]];
      const s = pe[0] * izquierda[0] + pe[1] * izquierda[1] >= 0 ? 1 : -1;
      par(cuerpo, 0, 'INSERT'); par(cuerpo, 8, 'PUERTAS'); par(cuerpo, 2, 'PUERTA'); par(cuerpo, 10, x); par(cuerpo, 20, y); par(cuerpo, 30, 0);
      par(cuerpo, 41, a.ancho * k); par(cuerpo, 42, s * a.ancho * k); par(cuerpo, 43, 1); par(cuerpo, 50, Math.atan2(al[1], al[0]) * 180 / Math.PI);
      ampliar([x, y]);
    } else if (a.tipo === 'ventana') {
      const [x, y] = P(a.o === 'h' ? [a.a, a.c] : [a.c, a.a]), al = V(a.o === 'h' ? [1, 0] : [0, 1]);
      par(cuerpo, 0, 'INSERT'); par(cuerpo, 8, 'VENTANAS'); par(cuerpo, 2, 'VENTANA'); par(cuerpo, 10, x); par(cuerpo, 20, y); par(cuerpo, 30, 0);
      par(cuerpo, 41, (a.b - a.a) * k); par(cuerpo, 42, a.t * k); par(cuerpo, 43, 1); par(cuerpo, 50, Math.atan2(al[1], al[0]) * 180 / Math.PI);
      ampliar([x, y]);
    }
  }
  for (const l of modelo.lineas) if (l.pts.length >= 2) polilinea(cuerpo, l.capa, l.pts.map(P), false);
  if (minX === Infinity) { minX = minY = 0; maxX = modelo.W * k; maxY = H * k; }

  // Cotas: generales del edificio y la de la medida de referencia, como DIMENSION de AutoCAD.
  const h = Math.max(maxX - minX, maxY - minY) * 0.015 || 1; // altura del texto de cota
  const cotas = [];
  const pr = modelo.principal;
  if (pr) {
    const a = P([pr.x0, pr.y1]), b = P([pr.x1, pr.y0]); // esquina inferior izquierda y superior derecha
    cotas.push({ p1: a, p2: [b[0], a[1]], u: [1, 0], lugar: [(a[0] + b[0]) / 2, a[1] - 4 * h], alineada: false });
    cotas.push({ p1: [b[0], a[1]], p2: b, u: [0, 1], lugar: [b[0] + 4 * h, (a[1] + b[1]) / 2], alineada: false });
  }
  if (ref) {
    const a = P(ref.p1), b = P(ref.p2), d = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(d[0], d[1]) || 1;
    const u = [d[0] / L, d[1] / L], n = [-u[1], u[0]];
    const centro = [(minX + maxX) / 2, (minY + maxY) / 2], medio = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const s = (medio[0] - centro[0]) * n[0] + (medio[1] - centro[1]) * n[1] >= 0 ? 1 : -1;
    cotas.push({ p1: a, p2: b, u, lugar: [medio[0] + s * n[0] * 8 * h, medio[1] + s * n[1] * 8 * h], alineada: true });
  }
  cotas.forEach((c, i) => cota(c, i + 1));
  function cota(c, n) {
    const { p1, p2, u, lugar } = c;
    const nor = [-u[1], u[0]];
    const proy = (p) => (lugar[0] - p[0]) * nor[0] + (lugar[1] - p[1]) * nor[1];
    const d1 = [p1[0] + nor[0] * proy(p1), p1[1] + nor[1] * proy(p1)], d2 = [p2[0] + nor[0] * proy(p2), p2[1] + nor[1] * proy(p2)];
    const medida = Math.abs((p2[0] - p1[0]) * u[0] + (p2[1] - p1[1]) * u[1]);
    const nombre = '*D' + n, B = [];
    par(B, 0, 'BLOCK'); par(B, 8, 'COTAS'); par(B, 2, nombre); par(B, 70, 1); par(B, 10, 0); par(B, 20, 0); par(B, 30, 0); par(B, 3, nombre);
    for (const [p, d] of [[p1, d1], [p2, d2]]) { // líneas de referencia, con separación del objeto y prolongación
      const v = [d[0] - p[0], d[1] - p[1]], Lv = Math.hypot(v[0], v[1]) || 1, w = [v[0] / Lv, v[1] / Lv];
      linea(B, 'COTAS', [p[0] + w[0] * 0.4 * h, p[1] + w[1] * 0.4 * h], [d[0] + w[0] * 0.6 * h, d[1] + w[1] * 0.6 * h]);
    }
    linea(B, 'COTAS', d1, d2);
    const t = 0.35 * h; // trazos oblicuos de arquitectura en los extremos
    for (const d of [d1, d2]) linea(B, 'COTAS', [d[0] - (u[0] + nor[0]) * t, d[1] - (u[1] + nor[1]) * t], [d[0] + (u[0] + nor[0]) * t, d[1] + (u[1] + nor[1]) * t]);
    let ang = Math.atan2(u[1], u[0]) * 180 / Math.PI;
    if (ang > 90.001 || ang <= -90) ang += 180;
    // Texto centrado, a 0,8 alturas por fuera de la línea de cota (vale para cualquier orientación).
    const fuera = Math.sign(proy(p1)) || 1;
    const sobre = [(d1[0] + d2[0]) / 2 + nor[0] * 0.8 * h * fuera, (d1[1] + d2[1]) / 2 + nor[1] * 0.8 * h * fuera];
    const texto = medida.toFixed(2);
    par(B, 0, 'TEXT'); par(B, 8, 'COTAS'); par(B, 10, sobre[0]); par(B, 20, sobre[1]); par(B, 30, 0); par(B, 40, h); par(B, 1, texto);
    par(B, 50, ang); par(B, 7, 'STANDARD'); par(B, 72, 1); par(B, 73, 2); par(B, 11, sobre[0]); par(B, 21, sobre[1]); par(B, 31, 0);
    par(B, 0, 'ENDBLK'); par(B, 8, 'COTAS');
    for (const x of B) bloques.push(x);
    par(cuerpo, 0, 'DIMENSION'); par(cuerpo, 8, 'COTAS'); par(cuerpo, 2, nombre); par(cuerpo, 3, 'STANDARD');
    par(cuerpo, 10, d2[0]); par(cuerpo, 20, d2[1]); par(cuerpo, 30, 0);
    par(cuerpo, 11, sobre[0]); par(cuerpo, 21, sobre[1]); par(cuerpo, 31, 0);
    par(cuerpo, 70, c.alineada ? 1 : 0); par(cuerpo, 1, '');
    par(cuerpo, 13, p1[0]); par(cuerpo, 23, p1[1]); par(cuerpo, 33, 0); par(cuerpo, 14, p2[0]); par(cuerpo, 24, p2[1]); par(cuerpo, 34, 0);
    if (!c.alineada) par(cuerpo, 50, Math.atan2(u[1], u[0]) * 180 / Math.PI);
    for (const p of [d1, d2]) ampliar(p);
  }

  // Cabecera, tablas y bloques.
  const out = [];
  const margen = 2 * h;
  par(out, 0, 'SECTION'); par(out, 2, 'HEADER');
  par(out, 9, '$ACADVER'); par(out, 1, 'AC1009');
  par(out, 9, '$INSBASE'); par(out, 10, 0); par(out, 20, 0); par(out, 30, 0);
  par(out, 9, '$EXTMIN'); par(out, 10, minX - margen); par(out, 20, minY - margen); par(out, 30, 0);
  par(out, 9, '$EXTMAX'); par(out, 10, maxX + margen); par(out, 20, maxY + margen); par(out, 30, 0);
  par(out, 9, '$LIMMIN'); par(out, 10, minX - margen); par(out, 20, minY - margen);
  par(out, 9, '$LIMMAX'); par(out, 10, maxX + margen); par(out, 20, maxY + margen);
  par(out, 9, '$LUNITS'); par(out, 70, 2); par(out, 9, '$LUPREC'); par(out, 70, 2);
  par(out, 9, '$TEXTSIZE'); par(out, 40, h);
  par(out, 9, '$DIMSCALE'); par(out, 40, 1); par(out, 9, '$DIMTXT'); par(out, 40, h); par(out, 9, '$DIMASZ'); par(out, 40, 0.7 * h);
  par(out, 9, '$DIMTSZ'); par(out, 40, 0.5 * h); par(out, 9, '$DIMEXO'); par(out, 40, 0.4 * h); par(out, 9, '$DIMEXE'); par(out, 40, 0.6 * h);
  par(out, 9, '$DIMGAP'); par(out, 40, 0.3 * h); par(out, 9, '$DIMTAD'); par(out, 70, 1); par(out, 9, '$DIMTIH'); par(out, 70, 0); par(out, 9, '$DIMTOH'); par(out, 70, 0);
  par(out, 0, 'ENDSEC');
  par(out, 0, 'SECTION'); par(out, 2, 'TABLES');
  par(out, 0, 'TABLE'); par(out, 2, 'LTYPE'); par(out, 70, 1);
  par(out, 0, 'LTYPE'); par(out, 2, 'CONTINUOUS'); par(out, 70, 0); par(out, 3, 'Solid line'); par(out, 72, 65); par(out, 73, 0); par(out, 40, 0);
  par(out, 0, 'ENDTAB');
  par(out, 0, 'TABLE'); par(out, 2, 'LAYER'); par(out, 70, CAPAS.length + 1);
  for (const [n, c] of [['0', 7], ...CAPAS]) { par(out, 0, 'LAYER'); par(out, 2, n); par(out, 70, 0); par(out, 62, c); par(out, 6, 'CONTINUOUS'); }
  par(out, 0, 'ENDTAB');
  par(out, 0, 'TABLE'); par(out, 2, 'STYLE'); par(out, 70, 1);
  par(out, 0, 'STYLE'); par(out, 2, 'STANDARD'); par(out, 70, 0); par(out, 40, 0); par(out, 41, 1); par(out, 50, 0); par(out, 71, 0); par(out, 42, h); par(out, 3, 'txt'); par(out, 4, '');
  par(out, 0, 'ENDTAB');
  par(out, 0, 'TABLE'); par(out, 2, 'DIMSTYLE'); par(out, 70, 1);
  par(out, 0, 'DIMSTYLE'); par(out, 2, 'STANDARD'); par(out, 70, 0);
  par(out, 40, 1); par(out, 41, 0.7 * h); par(out, 42, 0.4 * h); par(out, 43, 0); par(out, 44, 0.6 * h); par(out, 140, h); par(out, 142, 0.5 * h); par(out, 147, 0.3 * h);
  par(out, 77, 1); par(out, 73, 0); par(out, 74, 0);
  par(out, 0, 'ENDTAB');
  par(out, 0, 'ENDSEC');
  par(out, 0, 'SECTION'); par(out, 2, 'BLOCKS');
  // PUERTA: ancho 1, bisagra en el origen, hoja abierta a lo largo de +Y y giro hasta +X.
  par(out, 0, 'BLOCK'); par(out, 8, '0'); par(out, 2, 'PUERTA'); par(out, 70, 0); par(out, 10, 0); par(out, 20, 0); par(out, 30, 0); par(out, 3, 'PUERTA');
  linea(out, '0', [0, 0], [0, 1]);
  par(out, 0, 'ARC'); par(out, 8, '0'); par(out, 10, 0); par(out, 20, 0); par(out, 30, 0); par(out, 40, 1); par(out, 50, 0); par(out, 51, 90);
  par(out, 0, 'ENDBLK'); par(out, 8, '0');
  // VENTANA: largo 1 por grosor 1, con el eje del muro en y = 0.
  par(out, 0, 'BLOCK'); par(out, 8, '0'); par(out, 2, 'VENTANA'); par(out, 70, 0); par(out, 10, 0); par(out, 20, 0); par(out, 30, 0); par(out, 3, 'VENTANA');
  for (const [a, b] of [[[0, -0.5], [1, -0.5]], [[1, -0.5], [1, 0.5]], [[1, 0.5], [0, 0.5]], [[0, 0.5], [0, -0.5]], [[0, 0], [1, 0]]]) linea(out, '0', a, b);
  par(out, 0, 'ENDBLK'); par(out, 8, '0');
  for (const x of bloques) out.push(x);
  par(out, 0, 'ENDSEC');
  par(out, 0, 'SECTION'); par(out, 2, 'ENTITIES');
  for (const x of cuerpo) out.push(x);
  par(out, 0, 'ENDSEC'); par(out, 0, 'EOF');
  return out.join('\r\n') + '\r\n';
}

const CAD = { convertirPlano, escribirDxf, CAPAS };
if (typeof module !== 'undefined' && module.exports) module.exports = CAD;
else self.CAD = CAD;
})();

// De la imagen limpia a un plano de CAD: reconoce muros, puertas y ventanas, escribe el DXF
// y lo termina en CADCraft (unidades, relleno de muros, cotas) guardando DXF, DWG y vista previa.
'use strict';
const fs = require('fs');
const path = require('path');
const { reconocer, dxfR12, imagenControl } = require('./reconocer');

const MM_POR_UNIDAD = { mm: 1, cm: 10, m: 1000 };
const INSUNITS = { mm: 4, cm: 5, m: 6 };
const ANCHO_PUERTA_M = 0.8; // ancho supuesto de una puerta cuando no hay medida de referencia

// opciones: { unidad, referencia?: {p1:[x,y], p2:[x,y], real}, muros: 'grueso'|'dobles' }
async function planoACad(png, dir, nombre, opciones, ejecutar, CC) {
  const unidad = opciones.unidad;
  const metrosPorUnidad = MM_POR_UNIDAD[unidad] / 1000;
  const ref = opciones.referencia;
  let k, origenEscala, modelo;
  if (ref) {
    const px = Math.hypot(ref.p2[0] - ref.p1[0], ref.p2[1] - ref.p1[1]);
    k = ref.real / px; // unidades por píxel
    origenEscala = 'medida';
    modelo = reconocer(png, { muros: opciones.muros, pxPorMetro: 1 / (k * metrosPorUnidad) });
  } else {
    modelo = reconocer(png, { muros: opciones.muros });
    const anchos = modelo.aberturas.filter((a) => a.tipo === 'puerta').map((a) => a.ancho).sort((a, b) => a - b);
    if (anchos.length >= 2) {
      k = (ANCHO_PUERTA_M / metrosPorUnidad) / anchos[anchos.length >> 1];
      origenEscala = 'puertas';
      modelo = reconocer(png, { muros: opciones.muros, pxPorMetro: 1 / (k * metrosPorUnidad) });
    } else {
      k = (25.4 / 72) / MM_POR_UNIDAD[unidad]; // tamaño de la hoja a 72 ppp
      origenEscala = 'ninguna';
    }
  }

  const reconocido = path.join(dir, 'reconocido.dxf');
  const { texto, extension } = dxfR12(modelo, k);
  fs.writeFileSync(reconocido, texto, 'latin1');
  fs.writeFileSync(path.join(dir, 'control.png'), imagenControl(modelo, png));

  // Acabado en CADCraft.
  const W = (p) => [p[0] * k, (modelo.H - p[1]) * k];
  // Las cotas generales miden el edificio principal.
  const pr = modelo.principal;
  const muros = pr ? [W([pr.x0, pr.y0]), W([pr.x1, pr.y1])] : [];
  const ext = muros.length
    ? { minX: Math.min(...muros.map((p) => p[0])), maxX: Math.max(...muros.map((p) => p[0])), minY: Math.min(...muros.map((p) => p[1])), maxY: Math.max(...muros.map((p) => p[1])) }
    : extension;
  const h = Math.max(ext.maxX - ext.minX, ext.maxY - ext.minY) * 0.015 || 1; // altura del texto de cota
  const cmds = [
    ['units', { insunits: INSUNITS[unidad], lunits: 2, luprec: 2 }],
    ['dimstyle', { name: 'COTAS', current: true, DIMTXT: h, DIMASZ: h * 0.8, DIMEXO: h * 0.4, DIMEXE: h * 0.6, DIMGAP: h * 0.3, DIMDEC: 2, DIMTSZ: h * 0.6, DIMLUNIT: 2 }],
  ];
  if (modelo.puntosRelleno.length) {
    cmds.push(['layer.current', { name: 'MUROS-RELLENO' }]);
    cmds.push(['hatch', { points: modelo.puntosRelleno.map(W), pattern: 'SOLID' }]);
  }
  cmds.push(['layer.current', { name: 'COTAS' }]);
  if (muros.length) {
    const sep = 4 * h;
    cmds.push(['dimlinear', { p1: [ext.minX, ext.minY], p2: [ext.maxX, ext.minY], at: [(ext.minX + ext.maxX) / 2, ext.minY - sep] }]);
    cmds.push(['dimlinear', { p1: [ext.maxX, ext.minY], p2: [ext.maxX, ext.maxY], at: [ext.maxX + sep, (ext.minY + ext.maxY) / 2] }]);
  }
  if (ref) {
    const a = W(ref.p1), b = W(ref.p2), d = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(...d) || 1, n = [-d[1] / L, d[0] / L];
    // Hacia el lado contrario al centro del edificio, y más lejos que las cotas generales para no taparlas.
    const centro = [(ext.minX + ext.maxX) / 2, (ext.minY + ext.maxY) / 2], medio = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const s = (medio[0] - centro[0]) * n[0] + (medio[1] - centro[1]) * n[1] >= 0 ? 1 : -1;
    cmds.push(['dimaligned', { p1: a, p2: b, at: [medio[0] + s * n[0] * 8 * h, medio[1] + s * n[1] * 8 * h] }]);
  }
  cmds.push(['layer.current', { name: '0' }]);
  cmds.push(['zoom', { mode: 'extents' }]);
  const dxf = path.join(dir, nombre + '.dxf');
  cmds.push(['saveas', { path: dxf.replace(/\\/g, '/'), version: 2018 }]);
  const args = ['run', reconocido];
  for (const [id, p] of cmds) args.push('--cmd', `${id} ${JSON.stringify(p)}`);
  const salida = await ejecutar(CC, args);
  const errores = salida.split(/\r?\n/).filter((l) => /"error"/i.test(l));

  return { modelo, k, origenEscala, dxf, salidaCadcraft: salida, errores };
}

module.exports = { planoACad };

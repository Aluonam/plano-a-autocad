// Worker: reconoce el plano y escribe el DXF sin bloquear la pantalla.
'use strict';
importScripts('reconocer.js', 'dxf.js');
self.onmessage = (e) => {
  try {
    const { W, H, tinta, opciones } = e.data;
    const r = self.CAD.convertirPlano({ W, H, tinta }, opciones);
    const m = r.modelo;
    self.postMessage({
      ok: true, dxf: r.dxf, k: r.k, origenEscala: r.origenEscala, unidad: r.unidad,
      // Lo necesario para dibujar la vista previa.
      modelo: { W: m.W, H: m.H, muros: m.muros, aberturas: m.aberturas, pilares: m.pilares || [], lineas: m.lineas, lazos: m.lazos, principal: m.principal, resumen: m.resumen, avisos: m.avisos },
    });
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
};

# Plano a AutoCAD

Aplicación para tablet que convierte la foto de un plano dibujado a mano en un **DXF para AutoCAD**,
con los muros, pilares, puertas, ventanas y cotas ya reconocidos y cada cosa en su capa.

Funciona entera en la tablet: la foto no se sube a ningún sitio y, una vez instalada, no necesita conexión.

**Abrir la aplicación:** https://aluonam.github.io/plano-a-autocad/

## Cómo se usa

1. **Foto**: haz la foto del plano con la tablet, o abre una imagen o un escaneo.
2. **Esquinas**: arrastra los pinzamientos a las esquinas de la hoja; la foto se endereza. Si un borde sale curvado
   (papel abombado o la lente del móvil), lleva su rombo central al borde real y también se endereza.
3. **Limpieza**: ajusta hasta que las líneas se vean limpias.
4. **Datos**: elige el tipo de dibujo, toca los dos extremos de una medida conocida y escribe cuánto mide.
5. **Resultado**: «Abrir en CADCraft» lo abre dentro de la propia aplicación para revisarlo, editarlo y guardarlo
   en DWG o DXF. También puedes «Compartir DXF» o «Guardar DXF» para llevarlo a AutoCAD u otro programa.
6. **Comparar con la foto**: muestra la foto enderezada en naranja debajo del dibujo, para ver qué falta.
7. **Corregir**: si algo no se ha reconocido bien, pinta encima con el rotulador de Muro, Puerta, Ventana o Pilar,
   o con Borrar para que se ignore, y pulsa «Aplicar correcciones».

[CADCraft](https://github.com/storytold/cadcraft) es un programa de CAD de código libre (MIT o Apache-2.0). Va
incluido en la aplicación (carpeta `docs/cadcraft/`, sin modificar) y funciona en el navegador de la tablet; la
primera vez que se abre se descarga (unos 5 MB comprimido) y después funciona sin conexión.

## Qué contiene el DXF

| Capa | Contenido |
|---|---|
| `MUROS`, `MUROS-RELLENO` | Muros reconocidos (trazo grueso, dos líneas o fábrica rayada), con relleno sólido |
| `PILARES` | Postes y pilares |
| `PUERTAS` | Bloque `PUERTA` con su ancho, giro y sentido de apertura |
| `VENTANAS` | Bloque `VENTANA` |
| `COTAS` | Cotas de AutoCAD: ancho y fondo totales, y la medida de referencia |
| `TEXTO-A-MANO` | Los textos tal como están dibujados, para repasarlos |
| `DETALLES` | Mobiliario y demás líneas |
| `REVISAR` | Lo que no se ha sabido interpretar |
| `DIBUJO` | En el modo «Calco», todo el dibujo línea a línea |

Las unidades son las elegidas en la aplicación (metros por defecto). Si redefines los bloques `PUERTA` y
`VENTANA` con los de tu biblioteca, se actualizan todos a la vez. El formato es DXF R12, el más compatible.

## Instalarla en la tablet

La aplicación es una página web que se instala como una aplicación (PWA). Está publicada con GitHub
Pages desde la carpeta `docs/` de este repositorio; cada cambio que se sube a `main` se publica solo.

1. Abre en la tablet https://aluonam.github.io/plano-a-autocad/
2. Instálala:
   - **iPad**: Safari › Compartir › *Añadir a pantalla de inicio*.
   - **Android**: Chrome › menú › *Instalar aplicación*.
3. A partir de ahí se abre desde su icono y funciona sin conexión.

GitHub solo sirve el código de la aplicación. Las fotos y los planos se procesan en la propia tablet y
solo se guardan donde tú elijas al pulsar *Guardar* o *Compartir*.

## Usarla desde el PC en la red local

Sin publicarla, también se puede servir desde un PC con [Node.js](https://nodejs.org):

1. Ejecuta `Abrir en la red local.bat` (o `node servir.js`). La ventana muestra la dirección, por ejemplo
   `http://192.168.1.137:8080`.
2. Ábrela en la tablet, conectada a la misma red.

Así funciona todo salvo instalarla como aplicación, usarla sin conexión y el botón *Compartir*, que los
navegadores solo permiten con HTTPS; *Guardar DXF* sí funciona. El servidor solo entrega los ficheros de la
aplicación y solo atiende a redes privadas: las fotos se procesan en la tablet y no llegan al PC.

## Estructura

| Carpeta | Contenido |
|---|---|
| `docs/cadcraft/` | CADCraft web 0.18.0 sin modificar, con sus licencias (ver su `LEEME.md`) |
| `docs/` | La aplicación de la tablet: `index.html` (interfaz), `reconocer.js` (reconocimiento de muros, puertas, ventanas y pilares), `dxf.js` (escala y escritura del DXF), `trabajo.js` (proceso en segundo plano) y `sw.js` (uso sin conexión) |
| `plano-app/` | Versión anterior para PC con Windows: servidor local que además genera DWG con [CADCraft](https://github.com/storytold/cadcraft). Opcional |
| `instalar.ps1` | Descarga y verifica CADCraft y VectorCraft para la versión de PC |

Para probar la aplicación en un ordenador basta con servir la carpeta `docs/` en `localhost`.

## Limitaciones

- Los textos a mano no se leen: quedan como trazos en `TEXTO-A-MANO`.
- Los muros diagonales o curvos no se reconocen y van a `REVISAR`.
- En croquis muy cargados aparecen algunas puertas o ventanas de más, o falta algún tramo de muro.
- Sin medida de referencia, la escala se estima suponiendo puertas de 80 cm.
- El DWG se genera desde CADCraft (Archivo › Guardar como); la aplicación por sí sola escribe DXF.
- CADCraft está en desarrollo temprano y su interfaz está pensada para ratón: en tablet funciona, pero los botones son pequeños.

## Créditos

CADCraft y VectorCraft son del equipo ArtCraft (MIT o Apache-2.0). La versión web de CADCraft se incluye sin
modificar en `docs/cadcraft/`; VectorCraft y la versión de escritorio de CADCraft no se incluyen. Sus nombres y
logotipos son marcas de ArtCraft.

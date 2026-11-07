# Plano a AutoCAD

Aplicación para tablet que convierte la foto de un plano dibujado a mano en un **DXF para AutoCAD**,
con los muros, pilares, puertas, ventanas y cotas ya reconocidos y cada cosa en su capa.

Funciona entera en la tablet: la foto no se sube a ningún sitio y, una vez instalada, no necesita conexión.

**Abrir la aplicación:** https://aluonam.github.io/plano-a-autocad/

## Cómo se usa

1. **Foto**: haz la foto del plano con la tablet, o abre una imagen o un escaneo.
2. **Esquinas**: arrastra los pinzamientos a las esquinas de la hoja; la foto se endereza.
3. **Limpieza**: ajusta hasta que las líneas se vean limpias.
4. **Datos**: elige el tipo de dibujo, toca los dos extremos de una medida conocida y escribe cuánto mide.
5. **Resultado**: «Compartir o abrir en AutoCAD» (abre el menú del sistema: AutoCAD, Drive, correo…) o «Guardar DXF».

AutoCAD abre el DXF directamente. Si necesitas DWG, usa *Guardar como* en AutoCAD.

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
| `docs/` | La aplicación de la tablet: `index.html` (interfaz), `reconocer.js` (reconocimiento de muros, puertas, ventanas y pilares), `dxf.js` (escala y escritura del DXF), `trabajo.js` (proceso en segundo plano) y `sw.js` (uso sin conexión) |
| `plano-app/` | Versión anterior para PC con Windows: servidor local que además genera DWG con [CADCraft](https://github.com/storytold/cadcraft). Opcional |
| `instalar.ps1` | Descarga y verifica CADCraft y VectorCraft para la versión de PC |

Para probar la aplicación en un ordenador basta con servir la carpeta `docs/` en `localhost`.

## Limitaciones

- Los textos a mano no se leen: quedan como trazos en `TEXTO-A-MANO`.
- Los muros diagonales o curvos no se reconocen y van a `REVISAR`.
- En croquis muy cargados aparecen algunas puertas o ventanas de más, o falta algún tramo de muro.
- Sin medida de referencia, la escala se estima suponiendo puertas de 80 cm.
- En la tablet no se genera DWG: AutoCAD lo crea al guardar el DXF.

## Créditos

La versión de PC usa CADCraft y VectorCraft, del equipo ArtCraft (MIT o Apache-2.0), que no se incluyen
en este repositorio. Sus nombres y logotipos son marcas de ArtCraft.

# Plano a AutoCAD

Herramienta personal para pasar un plano dibujado a mano a AutoCAD. Haces una foto con el móvil,
marcas las esquinas de la hoja, indicas una medida de referencia y descargas un **DWG** o **DXF** con:

| Capa | Contenido |
|---|---|
| `MUROS`, `MUROS-RELLENO` | Muros reconocidos (trazo grueso, dos líneas o fábrica rayada), con su relleno |
| `PILARES` | Postes y pilares |
| `PUERTAS` | Bloque `PUERTA` con su ancho, giro y sentido de apertura |
| `VENTANAS` | Bloque `VENTANA` |
| `COTAS` | Cotas generales y la de la medida de referencia |
| `TEXTO-A-MANO` | Los textos tal como están dibujados, para repasarlos |
| `DETALLES` | Mobiliario y demás líneas |
| `REVISAR` | Lo que no se ha sabido interpretar |

Si redefines los bloques `PUERTA` y `VENTANA` con los de tu biblioteca, se actualizan todos a la vez.
También hay un modo «Calco exacto» que copia el dibujo línea a línea, sin reconocer nada.

## Cómo funciona

- La página (`plano-app/public/index.html`) corre en el navegador del móvil: endereza la foto y la limpia.
- El servidor (`plano-app/server.js`, Node.js sin dependencias) corre en un PC con Windows:
  - `reconocer.js` reconoce muros, puertas, ventanas y pilares, y escribe el DXF.
  - `plano.js` lo termina con [CADCraft](https://github.com/storytold/cadcraft): unidades, relleno, cotas, DWG.
  - El modo calco usa [VectorCraft](https://github.com/storytold/vectorcraft).
- Las fotos y los planos se quedan en el PC, en `plano-app/planos/`. No se envía nada a internet.

## Instalación (PC con Windows)

1. Instala [Node.js](https://nodejs.org) 18 o posterior.
2. Clona el repositorio y ejecuta el instalador, que descarga VectorCraft y CADCraft y comprueba su huella SHA-256:
   ```powershell
   git clone <url-del-repositorio> plano-a-autocad
   cd plano-a-autocad
   powershell -ExecutionPolicy Bypass -File .\instalar.ps1
   ```
3. Arranca con `plano-app\Iniciar Plano a AutoCAD.bat`. Deja abierta la ventana negra mientras lo uses.

## Uso en casa (misma wifi)

La ventana del servidor muestra la dirección para el móvil con la clave incluida, por ejemplo:
```
http://192.168.1.137:8765/?clave=XXXXXXXXXXXXXXXX
```
Ábrela una vez en el móvil; la clave queda guardada en ese dispositivo. En el propio PC no se pide clave.

## Uso fuera de casa, de forma segura (Tailscale)

**No abras el puerto 8765 en el router.** Usa [Tailscale](https://tailscale.com), una red privada (VPN)
gratuita para uso personal: el móvil y el PC se ven como si estuvieran en la misma wifi, cifrado
y sin exponer nada a internet.

1. Crea una cuenta en Tailscale e instálalo en el PC y en el móvil o la tablet, con la misma cuenta.
2. En la consola de Tailscale, en *DNS*, activa **MagicDNS** y **HTTPS Certificates**.
3. En el PC, con la herramienta arrancada, publica la página solo dentro de tu red privada:
   ```powershell
   tailscale serve --bg 8765
   ```
   Te dará una dirección como `https://nombre-del-pc.tu-red.ts.net`.
4. En el móvil, con Tailscale conectado, abre esa dirección añadiendo la clave:
   `https://nombre-del-pc.tu-red.ts.net/?clave=XXXXXXXXXXXXXXXX`
5. Instálala como aplicación: en Android, menú de Chrome › **Instalar aplicación**; en iPhone o iPad,
   Safari › Compartir › **Añadir a pantalla de inicio**.

El PC tiene que estar encendido y con la herramienta arrancada. **No uses `tailscale funnel`**: eso sí
la publicaría en internet.

### Qué protege

- El servidor solo atiende a redes privadas (casa, Tailscale y el propio PC) y rechaza el resto.
- Cualquier dispositivo que no sea el PC necesita la clave, que se guarda en una cookie `HttpOnly`.
- La clave está en `plano-app/clave.txt`, que no se sube a GitHub. Para cambiarla, borra ese fichero
  y reinicia: se genera otra y hay que volver a entrar con el enlace nuevo en cada dispositivo.

## Limitaciones

- Los textos a mano no se leen: quedan como trazos en `TEXTO-A-MANO`.
- Los muros diagonales o curvos no se reconocen y van a `REVISAR`.
- En croquis muy cargados aparecen algunas puertas o ventanas de más, o falta algún tramo de muro.
- Sin medida de referencia, la escala se estima suponiendo puertas de 80 cm.
- El DWG lo escribe CADCraft (formato 2018); si algún programa no lo abre bien, usa el DXF.

## Créditos

VectorCraft y CADCraft son del equipo ArtCraft (MIT o Apache-2.0); no se incluyen en este repositorio.
Sus nombres y logotipos son marcas de ArtCraft.

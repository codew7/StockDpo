# StockDpo — Inventario

App de una sola página para registrar **entradas y salidas de stock** desde el celular, en el depósito. Sin backend: el navegador habla directo con Firebase (auth + base de datos) y con Google Sheets (catálogo, solo lectura).

Flujo objetivo, en mínimos toques: **elegir tipo → escanear → confirmar cantidad → guardar**.

## Archivos

| Archivo | Rol |
|---|---|
| `index.html` | La app completa: HTML + CSS + JS en un único archivo (~1700 líneas). |
| `sw.js` | Service worker: precache del shell, SWR para Sheets y CDN, passthrough para Firebase. |
| `config.js` | `firebaseConfig` + `GOOGLE_SHEETS_CONFIG`. Se carga con `<script src="./config.js">`. |
| `database.rules.json` | Reglas de seguridad de Realtime Database. **No se aplican solas**: hay que pegarlas en la consola o correr `firebase deploy --only database`. |

Todo el JS de la app vive en un único `<script>` al final de `index.html`. El bloque de configuración editable (`DB_PREFIX`, `CATALOGO`, `HIST_LIMIT`) está al principio de ese script, bajo el encabezado `⚙️ CONFIGURACIÓN`.

## Ejecutar y probar

**Hay que servir por HTTP**, no abrir el archivo con `file://`:

```bash
python -m http.server 8080 --bind 127.0.0.1
```

El service worker y `getUserMedia` (cámara) exigen contexto seguro; `localhost`/`127.0.0.1` cuenta como seguro.

Dos limitaciones conocidas al probar en local:

- **Google Sheets devuelve `403 API_KEY_HTTP_REFERRER_BLOCKED`.** La API key tiene restricción de referrer y no incluye `127.0.0.1`. No es un bug del código. Para probar el catálogo real hay que agregar `http://127.0.0.1:*` a los referrers permitidos de la key; si no, se simula la respuesta interceptando `window.fetch`.
- **La cámara falla con `NotFoundError`** en máquinas sin webcam disponible para Chrome. El manejo de error funciona: avisa por toast y cierra el escáner.

Para inspeccionar vistas sin iniciar sesión, desde la consola del navegador:

```js
document.getElementById('login').classList.add('hidden');
indexarCatalogo([{codigo:'10001', nombre:'ARTÍCULO', barcodes:['779...'], foto:'', fotoAlt:'', valorU:100, valorC:1000}]);
stockMap = {'10001': 5}; stockCargado = true;
abrirMovimiento('SALIDA');
```

## Firebase

Proyecto **`stockdpo`**, exclusivo de esta app. Ojo: `articulos.html` y `pedidosv2.html` (otras apps del mismo dueño, no están en este repo) usan el proyecto **`pedidos-87064`** vía `../config.js`. Son bases distintas — no mezclar.

### Modelo de datos

```
inventario/
  movimientos/<pushKey>  { Codigo, Nombre, Cantidad, Tipo, DestinoShowroom,
                           FechaHora, FechaHoraTxt, Usuario }
  stock/<Codigo>         <número>   ← contador actual
```

- `Tipo`: `"ENTRADA"` | `"SALIDA"`. `Cantidad` siempre positiva; el signo lo define `Tipo`.
- `DestinoShowroom`: **solo en salidas.** `true` = salón de ventas, `false` = otro destino (depósito, ajuste, devolución). El checkbox del paso 2 arranca marcado y se oculta cuando el tipo es ENTRADA; en ese caso el campo no se escribe.
- `FechaHora`: `ServerValue.TIMESTAMP`. `FechaHoraTxt`: legible en GMT-3.
- `Usuario`: email de `auth.currentUser`.

### Escritura de un movimiento

Dos operaciones, en este orden (`registrarMovimiento()`):

1. `transaction()` sobre `inventario/stock/<Codigo>`: `v => (v == null ? 0 : v) + delta`.
2. `set()` del movimiento en `inventario/movimientos/<pushKey>`.

Si el paso 2 falla, el paso 1 se **revierte** con una transaction inversa. Después de escribir hay una **verificación obligatoria**: se relee el `pushKey` con `once('value')` bajo `conTimeout()` y se falla ruidosamente si no existe. Sin eso, un fallo silencioso pasa por éxito.

### Reglas de seguridad

Raíz cerrada (`.read`/`.write` en `false`); solo `inventario/movimientos` y `inventario/stock` conceden acceso, siempre con `auth != null`. El histórico es **append-only** (`".write": "auth != null && !data.exists()"`) y `FechaHora === now` impide backdating.

`DestinoShowroom` es opcional en el `.validate` del nodo, pero **obligatorio cuando `Tipo === 'SALIDA'`**: `newData.child('Tipo').val() !== 'SALIDA' || newData.hasChild('DestinoShowroom')`.

⚠️ **`"$otro": { ".validate": false }` rechaza cualquier campo no declarado.** Si se agrega un campo al movimiento en el código, hay que declararlo también en `database.rules.json` o la escritura se rechaza entera.

## Catálogo (Google Sheets)

`GET /v4/spreadsheets/{ID}/values/{rango}?key={API_KEY}`, solo lectura desde el cliente. Rango `Lista!A2:Z` (arranca en A2, sin fila de encabezado).

Mapeo de columnas — el mismo que usa `pedidosv2.html` en `cargarSheets()`:

| Col. | Índice | Campo |
|---|---|---|
| B | 1 | Imagen — CSV posicional: el 1º link es la foto, el 4º la alternativa |
| C | 2 | Código interno |
| D | 3 | Nombre |
| G | 6 | Precio unitario |
| H | 7 | Precio por bulto |
| L | 11 | Códigos de barras (CSV) |

**La columna K (stock) se ignora deliberadamente.** Ver decisiones, abajo.

El catálogo se cachea en `localStorage` con TTL de 10 min bajo `inv.catalogo.v3`. **Al cambiar la forma de los items hay que subir esa versión**, o los clientes viejos leen datos con la estructura anterior.

Los códigos de barras se indexan normalizados a mayúsculas (`normBarcode()`) porque CODE-39 y CODABAR pueden venir en distinto case que la hoja. Un mismo código puede pertenecer a varios artículos: `buscarCandidatos()` devuelve **todos** y la UI abre un bottom sheet para elegir, en vez de quedarse con el primero.

## Escáner

`html5-qrcode`, con los criterios ya probados en producción en `articulos.html`/`pedidosv2.html`:

- Formatos: EAN-13, EAN-8, UPC-A, UPC-E, CODE-128, CODE-39, ITF, CODABAR, QR.
- `gtinCheckOk()` — checksum mod-10 para EAN/UPC/ITF-14.
- `codigoEscaneadoValido(code, fmt)` — descarta lecturas parciales según el formato (ITF siempre par, etc.).
- **Consenso de 2 lecturas idénticas** consecutivas antes de aceptar (`SCAN_CONSENSO`). Una lectura defectuosa casi nunca se repite idéntica.
- iOS necesita alta resolución + `focusMode: continuous`, con reintento a config básica si los constraints fallan. Con la config básica, Safari no decodifica códigos 1D.
- Vibración de 60 ms al confirmar.

**La cámara nunca se abre sola**: solo al tocar "Escanear código".

## Diseño

Sistema visual heredado de `articulos.html`: paleta neutra con acento verde lima, tarjetas con sombras suaves, topbar con `backdrop-filter`, bottom sheets, Plus Jakarta Sans + JetBrains Mono para datos numéricos y códigos. Todos los tokens están en `:root`; usarlos en vez de valores literales.

Mobile-first: el escritorio es secundario. Respetar `env(safe-area-inset-*)`.

Patrones de feedback, portados tal cual y que conviene mantener:

- `showBlock(texto)` / `hideBlock()` para operaciones bloqueantes.
- `toast(msg, 'ok'|'err')`.
- Chip de conexión alimentado por `.info/connected` + `verificarConexionFirebase()` antes de escribir.
- `conTimeout(promise, ms, msg)` en toda operación de red.
- `procesoCriticoEnEjecucion` + `beforeunload` mientras se guarda.

## PWA

Manifest **generado en runtime** (`instalarManifest()`) como Blob, con `start_url` y `scope` absolutos: con un manifest que no es un archivo servido, las rutas relativas no se resuelven contra el documento y la instalación falla. Íconos SVG como data URI.

`sw.js` cachea el shell (`./`, `./index.html`, `./config.js`), hace stale-while-revalidate para Sheets y CDN, y **no intercepta Firebase** (el SDK maneja su propia cola offline). Al cambiar el HTML hay que subir `CACHE_VERSION`.

## Decisiones tomadas (no revertir sin preguntar)

- **El stock es independiente de la planilla.** El contador de Firebase arranca en 0 y solo acumula los movimientos registrados en esta app. La columna K de la hoja no se lee: son dos contadores distintos y mezclarlos daría números que no corresponden a ningún movimiento registrado acá. Consecuencia esperada: hasta cargar el inventario inicial (con entradas normales), los números pueden quedar negativos.
- **El catálogo sale solo de Sheets.** Existió un fallback al nodo `articulos` de Firebase; se eliminó.
- **Una salida mayor al stock se permite**, con aviso visible pero no bloqueante. El stock puede quedar negativo y eso es información, no un error a esconder.
- **`stockMeta` fue eliminado.** Guardaba `ultimoMov`/`ultimaFecha` y nunca se leía; el último movimiento de un código sale del histórico, que ya tiene `.indexOn`.
- **El paso 1 no tiene input de código manual**: solo "Escanear código" y "Buscar por nombre", dos tarjetas idénticas. El buscador del bottom sheet igual acepta código interno y de barras además del nombre.

## Gotchas verificados

- **`html5Qr.stop()` lanza de forma SÍNCRONA** si el escáner todavía no arrancó (cerrar apenas se abre, o denegar el permiso de cámara). Un `.catch()` no lo atrapa. `closeScanner()` lo envuelve en `try/catch`; el mismo patrón sin proteger existe en `articulos.html` y `pedidosv2.html`.
- **Parseo de precios**: `pedidosv2.html` usa `.replace(/,/g,'')`, que asume formato inglés y lee `"$ 3.500,50"` como `3.5005`. Acá `precioSheet()` detecta el separador decimal por posición y soporta ambos formatos.
- Los movimientos viejos pueden no tener `DestinoShowroom` ni `Usuario`: la UI los omite en vez de asumir un valor.

## Pendiente

- **`config.js` no define `databaseURL`.** El código lo deriva del `projectId` (`https://<projectId>-default-rtdb.firebaseio.com`) con un aviso en consola. Si la base está en otra región hay que declararlo explícitamente: `https://<projectId>-default-rtdb.<region>.firebasedatabase.app`.
- `config.js` está commiteado y contiene las API keys. En una app 100% cliente esas keys viajan igual al navegador —la protección real son las reglas de la base y la restricción de referrer de la key de Sheets—, pero el propio archivo pide agregarse a `.gitignore`. No hay `.gitignore` en el repo.

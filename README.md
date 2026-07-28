# Editor de Mapas Interiores — MVP

MVP funcional de un sistema para crear manualmente mapas interiores navegables a partir de la imagen de un plano. Permite subir un plano, ubicar la entrada principal, agregar POIs y zonas, y conectarlos gráficamente; al guardar genera automáticamente una imagen por cada POI con la ruta resaltada hasta la entrada, más instrucciones de navegación en JSON que usan tanto POIs como zonas como referencias.

Pensado para integrarse más adelante a un backend mayor en NestJS/MongoDB, y para que un futuro servicio (por ejemplo, basado en Ollama) pueda consultar un POI puntual y obtener la imagen de ruta ya generada junto con los datos necesarios para construir instrucciones de navegación.

---

## Novedades de esta entrega (fixes reportados)

**1. Los caminos ahora se pueden editar manualmente (ya no son solo líneas rectas).**
Cada conexión (`Edge`) admite una lista de *waypoints* (puntos de control) entre origen y destino. Con la herramienta "🖐️ Mover":
- **Doble clic sobre una conexión** agrega un punto de control en ese lugar (el trazado deja de ser recto ahí).
- **Arrastrar un punto** lo reubica, para acoplar el camino a un pasillo o curva real del plano.
- **Doble clic sobre un punto** lo elimina.

El cálculo de la ruta más corta (Dijkstra) también se actualizó para usar la longitud real del trazado (incluyendo los waypoints) en vez de la distancia recta entre POIs, y las imágenes generadas dibujan el camino siguiendo exactamente esos puntos.

**2. La imagen de la derecha no se actualizaba al regenerar → era caché del navegador.**
El archivo se regeneraba siempre con el mismo nombre (`<poiId>.png`), así que el navegador seguía mostrando la versión vieja cacheada. Se agregó un parámetro de versión (`?v=timestamp`) a la ruta de cada imagen generada, más una cabecera `Cache-Control: no-store` en el servidor para esa carpeta. Ahora cada "Guardar y generar rutas" refresca la miniatura correctamente.

**3. Ver las imágenes generadas desde una carpeta → dos formas nuevas.**
- Si usás `docker compose`, `backend/uploads/` y `backend/generated/` ahora son carpetas reales de tu disco (antes eran volúmenes internos de Docker, invisibles desde fuera). Podés abrir `backend/generated/<idDelMapa>/` directamente en el explorador de archivos.
- Además, en el editor aparece un botón **"⬇️ Descargar imágenes (.zip)"** que arma y descarga un .zip con todas las imágenes de ruta generadas para ese mapa.

**4. Nuevo: instrucciones de navegación en JSON (entrada -> POI).**
Junto con la imagen de cada POI, ahora también se genera automáticamente un JSON con instrucciones paso a paso ("avanzar", "girar_derecha", "dar_vuelta", etc.), narradas siempre en sentido **entrada → POI destino** (nunca al revés). Se calculan a partir de la misma geometría de la ruta (POIs + waypoints), sin IA ni intervención manual. Ver la sección **"Instrucciones de navegación (JSON)"** más abajo para el detalle del formato y las decisiones de diseño.

**5. Nuevo: zonas (recuadros con nombre) integradas a la generación de rutas.**
Se puede dibujar zonas rectangulares con nombre (ej. "Salón Principal", "Baño") con la herramienta "▭ Agregar zona", arrastrando sobre el plano. Las zonas son una segunda fuente de referencias además de los POIs: si el camino calculado pasa por dentro de una zona (aunque no haya un POI exactamente ahí), esa zona se usa como referencia en las instrucciones de navegación, exactamente igual que lo haría un POI con nombre. Si dos zonas se solapan en un punto de la ruta, gana la más chica (por área). Ver la sección **"Zonas"** más abajo para el detalle completo.

---

## Descripción del proyecto

El usuario sube la imagen de un plano, marca gráficamente la entrada principal, agrega POIs con un clic (solo pide el nombre), dibuja zonas con nombre arrastrando un recuadro, y conecta los POIs entre sí dibujando el grafo de caminos con el mouse. Nunca escribe coordenadas, identificadores ni relaciones. Al guardar, el backend recalcula el camino más corto entre cada POI y la entrada, genera una imagen del plano con esa ruta resaltada (incluyendo las zonas dibujadas de fondo) y arma las instrucciones de navegación en JSON usando POIs y zonas como referencias.

El plano (imagen) es únicamente un fondo visual. Toda la navegación se basa exclusivamente en el grafo (POIs + conexiones + zonas) creado por el usuario; la imagen nunca se analiza ni se usa como fuente de información.

Alcance de este MVP: un único edificio, un único piso, un único nodo de entrada, sin autenticación ni multiusuario, sin autodetección ni OCR/IA sobre el plano.

---

## Arquitectura

```
┌─────────────┐      REST/JSON       ┌──────────────┐      Mongoose       ┌───────────┐
│   Frontend  │ ───────────────────▶ │   Backend    │ ──────────────────▶ │  MongoDB  │
│ React + Vite│ ◀─────────────────── │   NestJS     │ ◀────────────────── │           │
│  (Konva)    │   /uploads /generated│              │                     └───────────┘
└─────────────┘                      │  ┌────────┐  │
                                      │  │ Image  │  │  node-canvas
                                      │  │ Gen.   │──┼──▶ genera PNG por POI
                                      │  │ Service│  │
                                      │  └────────┘  │
                                      └──────────────┘
```

- **Frontend**: React + TypeScript + Vite. Un editor gráfico basado en Canvas (Konva) donde el usuario hace todo el trabajo con clics y arrastres. Consume la API REST del backend.
- **Backend**: NestJS + TypeScript, organizado en módulos independientes (`maps`, `image-generation`), con su propio controlador, servicio y DTOs validados con `class-validator`.
- **MongoDB**: persiste el mapa completo (plano + grafo) como un único documento por mapa, usando Mongoose con subdocumentos embebidos.
- **Generador de imágenes**: servicio de dominio independiente que usa `node-canvas` para calcular el camino más corto (Dijkstra) entre un POI y la entrada, y dibujarlo sobre una copia del plano.

Las responsabilidades están separadas en capas: el `MapsController` solo expone HTTP, el `MapsService` contiene las reglas de negocio (validaciones, persistencia), y el `ImageGenerationService` es un servicio de dominio aislado, sin conocimiento de HTTP ni de Mongoose, reutilizable desde cualquier otro flujo futuro.

---

## Decisiones de diseño

**Konva / react-konva para el canvas.** Se evaluaron Fabric.js y Konva. Se eligió Konva porque su integración con React mediante `react-konva` permite modelar el editor como árbol de componentes declarativos (POIs y conexiones son componentes React que reaccionan al estado), tiene soporte nativo y simple de pan/zoom sobre un `Stage`, y su manejo de eventos por nodo (`onClick`, `onDragEnd`, `cancelBubble`) facilita implementar herramientas exclusivas (mover / conectar / eliminar) sin lógica manual de hit-testing.

**node-canvas para la generación de imágenes.** Corre en el mismo runtime de Node del backend, sin depender de un navegador headless, y ofrece una API de Canvas 2D idéntica a la del navegador (`drawImage`, `strokeStyle`, `arc`, etc.), lo que simplifica dibujar la ruta resaltada sobre el plano.

**Modelo de datos embebido (un documento Mongo por mapa).** El plano y su grafo (POIs + aristas + zonas) se guardan como subdocumentos dentro del documento `Map`, en un arreglo `floors`. Para el MVP ese arreglo tiene un único elemento, pero la estructura ya soporta múltiples pisos sin cambiar el esquema: alcanza con agregar elementos a `floors`. Se evitó modelar POIs/aristas/zonas como colecciones separadas porque en este alcance siempre se leen y escriben junto con el mapa completo (no hay consultas parciales que lo justifiquen), y el documento único simplifica la transacción de "guardar grafo + generar imágenes".

**Dijkstra sobre la longitud real del trazado (waypoints incluidos) en vez de BFS.** Las conexiones se dibujan libremente sobre un plano con coordenadas reales y pueden tener puntos de control intermedios, por lo que la ruta "más corta" en cantidad de saltos no necesariamente es la más corta en distancia real. Se pondera cada arista por la longitud de su polilínea completa (origen → waypoints → destino), no solo por la distancia recta entre los dos POIs.

**Zonas como fallback de referencia, no como nodos del grafo.** Una zona no participa del pathfinding (no agrega ni quita conexiones, no tiene peso): es puramente una anotación geométrica que se consulta *después* de calcular la ruta más corta, para enriquecer las instrucciones de navegación. Un waypoint sin nombre que cae dentro de una zona se trata, a partir de ahí, igual que un POI con nombre en todo el pipeline de `navigation-instructions.util.ts` (no se descarta por zigzag, se usa como `referencia`). Si dos zonas se solapan en ese punto, gana la más chica por área, porque es la referencia más específica (ej. un "Baño" puntual dentro de un "Pasillo Este" más grande).

**Guardado como reemplazo completo del grafo.** El frontend mantiene el grafo en memoria mientras el usuario edita, y solo lo envía completo al backend al presionar "Guardar". Esto evita mezclar el modelo de edición interactiva (que necesita ser muy fluido) con llamadas de red por cada clic, y hace que la generación de imágenes sea un paso explícito y predecible.

**Sin autenticación ni multiusuario.** Excluido explícitamente del alcance; el modelo de datos y la API no asumen usuarios, lo que deja el camino libre para agregarlos como una capa encima sin reestructurar lo existente.

---

## Estructura del proyecto

```
interior-map-editor/
├── docker-compose.yml
├── backend/                       # API NestJS
│   ├── src/
│   │   ├── main.ts                # bootstrap, CORS, archivos estáticos
│   │   ├── app.module.ts
│   │   ├── maps/                  # módulo principal del dominio "mapa"
│   │   │   ├── maps.controller.ts # endpoints REST
│   │   │   ├── maps.service.ts    # reglas de negocio y persistencia
│   │   │   ├── schemas/map.schema.ts   # Map → Floor → Poi / Edge / Zone (Mongoose)
│   │   │   └── dto/               # validación de entrada (class-validator)
│   │   └── image-generation/      # servicio de dominio independiente
│   │       ├── pathfinding.util.ts     # Dijkstra sobre el grafo de POIs
│   │       ├── navigation-instructions.util.ts  # genera el JSON de instrucciones paso a paso
│   │       └── image-generation.service.ts  # dibuja la ruta con node-canvas
│   ├── uploads/                   # planos subidos (volumen)
│   └── generated/                 # imágenes de ruta generadas (volumen)
└── frontend/                      # SPA React + Vite
    └── src/
        ├── api/mapApi.ts          # cliente HTTP del backend
        ├── types/index.ts         # tipos compartidos con el backend
        ├── components/
        │   ├── CanvasEditor.tsx   # editor gráfico (Konva): pan/zoom, POIs, conexiones, zonas
        │   ├── Toolbar.tsx        # herramientas: mover, entrada, POI, conectar, zona, eliminar
        │   └── NamePromptModal.tsx
        └── pages/
            ├── MapListPage.tsx    # listado / creación / borrado de mapas
            └── MapEditorPage.tsx  # pantalla principal del editor
```

---

## Instalación

Requisitos: Node.js 20+, MongoDB corriendo localmente (o usar Docker, ver más abajo), y las librerías nativas de `node-canvas` (Cairo/Pango) si se ejecuta el backend fuera de Docker.

```bash
# Backend
cd backend
cp .env.example .env
npm install

# Frontend
cd ../frontend
cp .env.example .env
npm install
```

## Ejecución (modo desarrollo, sin Docker)

```bash
# Terminal 1: MongoDB (si no se usa Docker para esto)
mongod --dbpath /ruta/a/tu/data

# Terminal 2: backend
cd backend
npm run start:dev
# → http://localhost:3000

# Terminal 3: frontend
cd frontend
npm run dev
# → http://localhost:5173
```

## Docker

Con Docker y Docker Compose instalados, todo el sistema (MongoDB + backend + frontend) se levanta con un único comando desde la raíz del proyecto:

```bash
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend / API: http://localhost:3000
- MongoDB: expuesto en `27017` (opcional, útil para inspeccionar datos)

Los planos y las imágenes generadas se guardan en `backend/uploads/` y `backend/generated/` (carpetas reales de tu proyecto, montadas dentro del contenedor — podés abrirlas directamente en el explorador de archivos), y los datos de Mongo persisten en el volumen `mongo_data`.

## Verificación de este entrega (qué se probó)

Antes de armar el zip final se corrieron estas verificaciones (sin necesitar Docker/Mongo levantados):

- `npx tsc --noEmit` en `backend/` → sin errores de tipos (incluye el nuevo `Zone`, `ZoneDto` y las firmas actualizadas de `buildNavigationInstructions`/`drawRouteImage`).
- `npx nest build` en `backend/` → compila limpio.
- `npx tsc --noEmit` + `npm run build` (Vite) en `frontend/` → sin errores de tipos, build de producción generado correctamente (incluye el nuevo modo `'zone'` del editor y los componentes `Rect` de Konva).
- Test funcional aislado de `findZoneAt()` y `buildNavigationInstructions()` con un escenario simulado (entrada → waypoint dentro de dos zonas solapadas → POI): se verificó que gana la zona más chica ("Nicho" sobre "Pasillo Este") y que el JSON de instrucciones usa correctamente esa zona como `referencia` en el paso de giro correspondiente.

### Cómo probar la feature de zonas end-to-end (checklist manual)

Con el proyecto corriendo (Docker o modo desarrollo, ver más abajo):

1. Crear un mapa y subir un plano.
2. Definir la entrada y agregar al menos un POI.
3. Elegir **"▭ Agregar zona"**, arrastrar sobre el plano (por ejemplo, cubriendo el tramo de pasillo entre la entrada y el POI) y ponerle un nombre.
4. Conectar la entrada con el POI con **"🔗 Conectar"**, agregando (con "🖐️ Mover" + doble clic sobre la conexión) al menos un punto de control que caiga *dentro* del recuadro de la zona.
5. Tocar **"💾 Guardar y generar rutas"**.
6. Abrir **"📋 Ver instrucciones (JSON)"** del POI: el paso correspondiente a ese punto de control debería mostrar `"referencia"` con el nombre de la zona (como `pasar_por` si el camino sigue derecho ahí, o como parte de un giro si cambia de dirección).
7. Verificar también que la imagen PNG generada (miniatura en el panel derecho) muestra el recuadro de la zona dibujado sobre el plano.
8. Opcional: dibujar una segunda zona más chica solapada sobre la primera, guardar de nuevo, y confirmar que la instrucción ahora usa el nombre de la zona más chica.

---

## Variables de entorno

**backend/.env**

| Variable       | Descripción                                      | Default                                  |
|----------------|---------------------------------------------------|-------------------------------------------|
| `PORT`         | Puerto HTTP del backend                            | `3000`                                    |
| `MONGODB_URI`  | Cadena de conexión a MongoDB                       | `mongodb://mongo:27017/interior-maps`     |
| `UPLOADS_DIR`  | Carpeta donde se guardan los planos subidos        | `uploads`                                 |
| `GENERATED_DIR`| Carpeta donde se guardan las imágenes generadas    | `generated`                               |
| `CORS_ORIGIN`  | Origen permitido para CORS (URL del frontend)      | `http://localhost:5173`                   |

**frontend/.env**

| Variable       | Descripción                     | Default                 |
|----------------|----------------------------------|--------------------------|
| `VITE_API_URL` | URL base de la API del backend  | `http://localhost:3000` |

---

## Guía de uso

1. **Crear un mapa.** En la pantalla principal, tocar "+ Nuevo mapa" e ingresar un nombre.
2. **Subir el plano.** Dentro del editor, tocar "Subir plano" y elegir una imagen PNG o JPG. El plano aparece automáticamente centrado y ajustado a la pantalla.
3. **Seleccionar la entrada principal.** Elegir la herramienta "🚪 Definir entrada" y hacer clic en el punto del plano donde está la puerta principal. Se marca en verde. Puede reubicarse en cualquier momento con la misma herramienta ("Reubicar entrada").
4. **Agregar POIs.** Elegir "📍 Agregar POI", hacer clic en el plano donde está el punto de interés (una oficina, un baño, un aula, etc.) y escribir únicamente su nombre en el cuadro que aparece.
5. **Agregar zonas.** Elegir "▭ Agregar zona" y arrastrar sobre el plano para dibujar un recuadro (ej. sobre un salón completo o un sector de pasillo), luego escribir su nombre. A diferencia de un POI (un punto), una zona ocupa un área: cualquier tramo de ruta que pase por dentro se referenciará con el nombre de la zona en las instrucciones de navegación, aunque no haya un POI puntual ahí. Doble clic sobre una zona la renombra.
6. **Conectar POIs.** Elegir "🔗 Conectar", hacer clic en un POI y luego en otro para crear un camino entre ambos. Los caminos se dibujan como líneas azules.
7. **Ajustar el trazado del camino.** Con la herramienta "🖐️ Mover": doble clic sobre una conexión agrega un punto de control ahí (para curvarla y acoplarla a un pasillo real); arrastrás ese punto para reubicarlo; doble clic sobre el punto lo elimina. También podés arrastrar cualquier POI para reposicionarlo, o hacer doble clic sobre él para renombrarlo.
8. **Eliminar.** Con "🗑️ Eliminar" se puede tocar un POI, una conexión o una zona para borrarlos. La rueda del mouse hace zoom; se puede arrastrar el fondo para desplazar la vista (modo "Mover").
9. **Guardar.** Tocar "💾 Guardar y generar rutas". El backend valida que exista una única entrada, persiste el grafo (incluyendo puntos de control y zonas) y genera automáticamente una imagen por cada POI con su ruta resaltada hasta la entrada (mostrando también las zonas de fondo), siguiendo el trazado real.
10. **Visualizar las rutas generadas.** En el panel derecho, cada POI muestra debajo de su nombre la miniatura de la imagen generada con su camino hasta la entrada, y un link "📋 Ver instrucciones (JSON)" con las instrucciones paso a paso (entrada → POI) en formato JSON, que ya usan las zonas como referencia donde corresponda.
11. **Descargar todas las imágenes.** El botón "⬇️ Descargar imágenes (.zip)" en la parte superior arma y descarga un .zip con todas las rutas generadas para ese mapa. También podés abrirlas directamente desde `backend/generated/<idDelMapa>/` en tu disco si corrés el proyecto con Docker.
12. **Recargar la página.** Los datos y las imágenes generadas se recuperan desde MongoDB; todo el trabajo queda persistido.

---

## Instrucciones de navegación (JSON)

Cada vez que se guarda el grafo ("💾 Guardar y generar rutas"), además de la imagen por POI se calcula un JSON de instrucciones paso a paso, en sentido **entrada → POI destino** (nunca al revés, ni entre dos POIs cualesquiera — siempre partiendo de la entrada principal).

### Formato

```json
{
  "poiId": "sala-203",
  "poiName": "Sala 203",
  "entranceName": "Entrada Principal",
  "unidad": "plano_px",
  "pasos": [
    { "tipo": "avanzar", "distancia": 120.5 },
    { "tipo": "girar_derecha", "referencia": "Sala de Reuniones" },
    { "tipo": "avanzar", "distancia": 84.2 },
    { "tipo": "pasar_por", "referencia": "Hall Central" },
    { "tipo": "avanzar", "distancia": 45.0 },
    { "tipo": "girar_izquierda_leve" },
    { "tipo": "avanzar", "distancia": 30.1 },
    { "tipo": "llegada", "referencia": "Sala 203" }
  ]
}
```

**Tipos de paso (`tipo`):**
- `avanzar` — siempre trae `distancia` (en píxeles del plano subido, **no metros reales** — ver "Pendiente" más abajo).
- `girar_derecha_leve` / `girar_izquierda_leve` — giro suave (≈12°–40°).
- `girar_derecha` / `girar_izquierda` — giro normal (≈40°–135°).
- `dar_vuelta` — giro en U (>135°).
- `pasar_por` — sigue derecho, pero pasa junto a un POI con nombre (se usa como referencia sin cortar el tramo en dos).
- `llegada` — último paso, siempre con `referencia` = nombre del POI destino.

`referencia`, cuando aparece, es el nombre del POI en ese punto exacto de la ruta (nunca el de un waypoint sin nombre).

### Cómo consultarlo

- `GET /maps/:id/pois/:poiId/instructions` → devuelve solo este JSON (pensado para que lo consuma un servicio externo, por ejemplo un LLM vía Ollama que redacte el texto final en lenguaje natural a partir de estos pasos).
- `GET /maps/:id/pois/:poiId` → devuelve lo mismo de siempre (el POI, la entrada, la URL de la imagen) más un campo `instructions` con este JSON embebido.
- En el editor, cada POI con instrucciones generadas muestra un link **"📋 Ver instrucciones (JSON)"** debajo de su miniatura.

### Decisiones de diseño

- **Sentido de recorrido fijo (entrada → POI).** El pathfinding (`shortestPathToEntrance`) calcula la ruta en sentido POI → entrada (es más natural para Dijkstra, arrancando desde el nodo de origen), pero antes de generar las instrucciones se invierte la lista de puntos. Importante: el signo de "izquierda/derecha" en cada giro se recalcula sobre los vectores ya invertidos, no se puede simplemente invertir el resultado de un cálculo hecho en el otro sentido.
- **Clasificación de giro por ángulo con signo.** Se usa el ángulo entre el vector de llegada y el de salida en cada punto (producto cruz + `atan2` para el signo, producto punto para la magnitud). Positivo = derecha, negativo = izquierda — la convención está documentada con un ejemplo concreto en el comentario de `turnAngleDegrees()` en `navigation-instructions.util.ts`, por si en algún momento se necesita ajustarla.
- **Suavizado de zigzag.** Los waypoints intermedios sin nombre cuyo cambio de dirección es menor a un umbral (12° por defecto) se descartan al generar las instrucciones — el tramo se sigue considerando "recto". Los POIs con nombre **nunca** se descartan, aunque el giro ahí sea insignificante (en ese caso se emite un paso `pasar_por` en lugar de un giro), porque siguen siendo una referencia útil aunque no impliquen un cambio de dirección.
- **Sin escala real (pendiente para otra iteración).** `distancia` es la distancia geométrica en el sistema de coordenadas del plano subido (equivalente a píxeles de esa imagen), no metros reales. Agregar una calibración (ej. "marcá dos puntos y decime cuántos metros hay entre ellos" para obtener un factor px→metros por piso) es una extensión aislada: solo tocaría el paso final de redondeo de `distancia` en `navigation-instructions.util.ts`, sin afectar el resto del algoritmo.
- **Se recalcula en cada guardado, no incrementalmente.** Igual que las imágenes, las instrucciones de todos los POIs se regeneran por completo cada vez que se guarda el grafo (mismo `for` que genera las imágenes, para no recorrer el pathfinding dos veces), y se persisten en `poi.instructions` en MongoDB. El nombre del POI/entrada **no** se congela ahí — se vuelve a tomar en el momento de servir la respuesta (`GET .../instructions`), así que si renombrás un POI después de generar las instrucciones, el JSON que se sirve ya refleja el nombre nuevo sin necesidad de regenerar.

## Zonas

Además de los POIs puntuales, el editor permite dibujar **zonas**: recuadros con nombre (rectángulos alineados a los ejes, sin rotación) que sirven como una segunda fuente de referencias para las instrucciones de navegación, útiles para nombrar sectores más grandes que un solo punto (ej. "Salón Principal", "Baño", "Ala Este").

### Cómo se crean

Con la herramienta **"▭ Agregar zona"**, se arrastra sobre el plano (mousedown → mover → soltar) para definir el rectángulo, igual de simple que agregar un POI pero con dos esquinas en vez de un punto. Al soltar se pide el nombre con el mismo cuadro que se usa para los POIs. Doble clic sobre una zona la renombra; con la herramienta "🗑️ Eliminar" se puede tocar una zona para borrarla.

Las zonas **no son nodos del grafo de navegación**: no se conectan entre sí ni con POIs, y no participan del cálculo de la ruta más corta (Dijkstra). Son puramente una anotación geométrica sobre el plano.

### Cómo se integran con la generación de rutas

Cada vez que se guarda el grafo, además de las imágenes e instrucciones ya existentes, el cálculo de instrucciones (`navigation-instructions.util.ts`) ahora consulta las zonas como *fallback* de referencia:

1. Se calcula la ruta más corta (POIs + waypoints) como siempre, sin que las zonas influyan en el pathfinding.
2. Al construir los puntos de la ruta para narrar las instrucciones, cada waypoint que **no** es un POI con nombre se consulta contra las zonas (`findZoneAt(zones, x, y)`): si cae dentro de alguna, se le asigna el nombre de esa zona.
3. A partir de ahí, ese punto se comporta exactamente igual que un POI con nombre en el resto del pipeline: no se descarta como "zigzag" al simplificar la ruta, y genera un paso `pasar_por` (si el camino sigue derecho) o el `referencia` de un giro (si hay un cambio de dirección ahí), usando el nombre de la zona.
4. **Si dos zonas se solapan** en el mismo punto de la ruta, gana la que tiene **menor área** — por ejemplo, un "Baño" puntual dentro de un "Pasillo Este" más grande se reporta como "Baño", porque es la referencia más específica.

Esto significa que una ruta puede pasar por una zona sin que haya ningún POI ahí, y la instrucción igual va a decir algo como `{"tipo": "pasar_por", "referencia": "Salón Principal"}`, dando contexto adicional útil para un servicio que redacte el texto final (ej. una integración con Ollama).

### En la imagen generada

Las zonas también se dibujan en la imagen PNG de cada POI (antes que la ruta resaltada, para no taparla): un recuadro semitransparente con su nombre, usando el mismo criterio de color en toda la app.

### Modelo de datos

```ts
// backend/src/maps/schemas/map.schema.ts
class Zone {
  id: string;
  name: string;
  x: number;      // esquina superior izquierda
  y: number;
  width: number;
  height: number;
}
// Floor.zones: Zone[]  (default [])
```

El DTO de guardado (`SaveGraphDto.zones?: ZoneDto[]`) es opcional, así que mapas guardados antes de esta entrega (sin zonas) siguen funcionando sin cambios: `floor.zones` queda como `[]`.

### Limitaciones actuales (a propósito, fuera del alcance de esta iteración)

- No hay "zonas de tránsito" inferidas automáticamente: el usuario dibuja únicamente las zonas que le interesa nombrar.
- Las zonas no se pueden mover ni redimensionar después de creadas en este MVP (sí se pueden borrar y volver a dibujar, o renombrar con doble clic). Agregarlo sería una extensión aislada al `CanvasEditor.tsx`: convertir el `Rect` en `draggable` y agregar manijas de resize, sin tocar el resto del dominio.
- Las zonas no afectan el pathfinding (no se puede, por ejemplo, marcar una zona como "no transitable"); son solo una fuente de referencia textual.

---

## Posibles extensiones

La arquitectura actual permite incorporar lo siguiente sin una reestructuración importante:

- **Múltiples pisos**: el esquema ya modela `Map.floors` como un arreglo; agregar pisos implica extender la UI para elegir/crear el piso activo y repetir el flujo de plano + grafo por cada uno.
- **Escaleras / ascensores / rampas**: se modelarían como un tipo especial de POI (o de arista) que conecta un piso con otro; el algoritmo de rutas (`pathfinding.util.ts`) ya está aislado en su propio módulo y puede extenderse para saltar entre grafos de distintos pisos.
- **Rutas accesibles**: agregando un atributo de accesibilidad a POIs/aristas y un segundo cálculo de ruta que las priorice o las excluya, sin tocar el resto del dominio.
- **Integración con Ollama**: el endpoint `GET /maps/:id/pois/:poiId` ya devuelve el POI, el nodo de entrada y la URL de la imagen de ruta generada — la información mínima para que un servicio externo arme instrucciones de navegación en lenguaje natural a partir de ese contexto.

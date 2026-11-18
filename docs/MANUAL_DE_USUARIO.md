# Manual de usuario de ORCA

ORCA es un orquestador de agentes de IA para pruebas de software. Toma un ticket de Jira, entiende sus criterios de aceptación, escribe pruebas automáticas, las ejecuta con Playwright, analiza los fallos y te entrega un reporte de QA con un veredicto claro. Cuando una acción es delicada, como crear defectos en Jira, ORCA se detiene y te pide aprobación.

Este manual explica cómo usar la consola web. Para la arquitectura técnica, consulta [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 1. Primeros pasos

### Requisitos

- Node.js 22.6 o superior.

### Instalación (solo la primera vez)

```bash
npm install
```

```bash
npx playwright install chromium-headless-shell
```

### Arrancar ORCA

```bash
npm start
```

Abre **http://127.0.0.1:4000** en tu navegador.

ORCA también arranca una tienda de prueba, **ORCA Shop**, en http://127.0.0.1:4100. Es la aplicación que se prueba en el modo de demostración y trae un error de precios a propósito para que veas cómo ORCA lo detecta.

> Si después de una actualización la página se ve igual que antes, haz una recarga forzada: **Cmd + Shift + R** (Mac) o **Ctrl + Shift + R** (Windows/Linux).

### Indicador de conexión

Abajo a la izquierda verás un punto:

- **verde · live**: la consola recibe eventos en tiempo real.
- **rojo · reconnecting…**: se perdió la conexión con el servidor. Comprueba que `npm start` siga corriendo.

---

## 2. Conceptos clave

### Ticket

Una historia de usuario de Jira. ORCA prueba los tickets que están en el estado **Ready for QA**. Los tickets de tipo *Bug* son defectos y no se prueban.

### Run

Una ejecución completa del flujo de QA para un ticket. Cada run pasa por siete etapas:

| Etapa | Qué hace | Agente |
|---|---|---|
| **Ticket** | Lee el ticket de Jira. | Jira Monitoring |
| **Analyze** | Convierte el ticket en requisitos y criterios Given/When/Then, y señala ambigüedades. Al mismo tiempo comprueba que el entorno esté sano. | Requirement · Deployment & Monitoring |
| **Write tests** | Genera pruebas de Playwright (UI y API) a partir de los criterios. | Test Generation |
| **Run tests** | Ejecuta las pruebas contra la aplicación. | Deployment & Monitoring |
| **Diagnose** | Investiga cada fallo, lo cruza con los logs de la aplicación y propone la causa. Solo se ejecuta si algo falló. | Failure Analysis |
| **Report** | Calcula métricas, cobertura y el veredicto final. | Reporting & Optimization |
| **File bugs** | Crea los defectos en Jira. Solo ocurre si hay errores del producto y **siempre requiere tu aprobación**. | Jira Monitoring |

### Resultado de un run

Cada run muestra un único resultado, siempre acompañado de un motivo en una línea:

| Resultado | Significado | Qué hacer |
|---|---|---|
| **Ready to release** (verde) | Todas las pruebas pasaron y todos los criterios están cubiertos. | Nada. Puedes pasar las pruebas a la suite de regresión. |
| **Needs attention** (amarillo) | No hay errores del producto, pero algo impide confiar del todo: una prueba mal escrita, criterios ambiguos o criterios sin prueba. | Lee el motivo y corrige el ticket o la prueba. |
| **Blocked** (rojo) | Se encontró un error real del producto o el entorno no está sano. | No liberes. Revisa el diagnóstico y el defecto propuesto. |
| **Waiting for your approval** (amarillo) | El run está detenido hasta que apruebes o rechaces una acción. | Ve a **Approvals**. |
| **Testing…** (azul) | El run está en marcha. | Espera; la pantalla se actualiza sola. |
| **Run crashed** (rojo) | El propio run falló por un error técnico, no por las pruebas. | Abre el run y revisa los logs. |
| **Not tested yet** | El ticket nunca se ha probado. | Pulsa **Run QA**. |

### Categorías de fallo

Cuando una prueba falla, el agente de análisis la clasifica así:

| Categoría | Significado |
|---|---|
| **product bug** | La aplicación hace algo distinto a lo que pide el criterio. Es un defecto real. |
| **test needs fixing** | La prueba está mal, por ejemplo usa un selector que no existe. ORCA sugiere el correcto cuando lo encuentra. |
| **environment problem** | La aplicación no respondía o estaba demasiado lenta. |
| **test data problem** | Faltan datos de prueba o son incorrectos. |
| **unclear cause** | No hay evidencia suficiente para clasificarlo. |

Cada diagnóstico incluye un porcentaje de **confianza**. Si el mismo fallo se repite entre runs, aparece como **recurring ×N**.

---

## 3. Recorrido por la consola

El menú de la izquierda tiene tres grupos. En el móvil se abre con el botón ☰ de arriba a la izquierda.

### Overview (resumen)

Es la pantalla principal. Se lee de arriba abajo:

1. **Needs your action**: lo que te necesita ahora mismo.
   - Aprobaciones pendientes, con el botón **Review**.
   - Tickets *Blocked* o *Needs attention*, con su motivo y el botón **Open**.
   - Si no hay nada, verás *Nothing needs you right now*.
2. **Tickets through the QA pipeline**: una fila por ticket con siete barras, una por etapa del último run.

   | Color de la barra | Significado |
   |---|---|
   | Verde | Etapa completada |
   | Azul parpadeante | En curso |
   | Amarillo | Esperando tu aprobación |
   | Rojo | Falló |
   | Solo contorno | No fue necesaria (por ejemplo, *Diagnose* cuando todo pasó) |
   | Gris | Aún no empezó |

   Pasa el ratón sobre una barra para ver el detalle de esa etapa. El botón **Details** abre el run y **Run QA** lanza el primero.
3. **Agents**: qué hace cada agente ahora (*Idle* o *Working: …*), cuántas tareas lleva y su tasa de éxito.
4. **Activity**: lo que va ocurriendo, en frases cortas y con la hora. Se llena en vivo desde que abres la página.
5. **Connections**: a qué sistemas está conectado ORCA (Jira, LLM, código, CI, ejecutor de pruebas, servidores MCP).

El botón **Test all “Ready for QA” tickets** lanza un run por cada ticket listo, todos en paralelo.

### Approvals (aprobaciones)

Aquí ves las acciones delicadas que esperan tu decisión. El número junto al menú indica cuántas hay pendientes.

Para cada solicitud verás:

- El título, por ejemplo *Create 1 defect(s) in Jira for SHOP-102*.
- El resumen de lo que se va a hacer.
- **Payload sent to the agent**: los datos exactos que se enviarán.
- Un campo opcional para comentar el motivo de tu decisión.

Pulsa **Approve** para que el run continúe o **Reject** para descartar la acción. Ambas quedan registradas en el historial, con quién decidió y cuándo.

### Jira tickets

La lista de tickets con su estado en Jira y el resultado del último QA.

- Haz clic en la clave (por ejemplo `SHOP-101`) para ver la descripción, los criterios de aceptación y los comentarios.
- **Run QA** o **Run again** lanza el flujo para ese ticket.
- **Check Jira now** fuerza una consulta a Jira para detectar cambios en lugar de esperar al siguiente sondeo automático.
- **Simulate Jira activity** (solo en modo demo) mueve un ticket de estado para que veas cómo lo detecta el agente de Jira.

### Runs

La lista de todos los runs, del más reciente al más antiguo, con su resultado y su motivo. Más abajo hay un diagrama de **cómo funciona el flujo**: los pasos apilados en la misma columna se ejecutan en paralelo, los marcados con *if* solo corren si se cumple su condición y los marcados con *approval* esperan a una persona.

**Detalle de un run.** Al abrir un run verás:

- Arriba, el resultado, el motivo y las siete etapas con su nombre.
- **Steps**: cada paso con su agente, su estado, un resumen y su duración.
- **Logs**: el registro en vivo de lo que hizo cada agente.
- **Generated tests**: el código de las pruebas que se generaron.
- **Input / output**: los datos de entrada y salida del run.
- Botones arriba a la derecha: **QA report**, **Traceability** y **Cancel run** (solo mientras está en marcha).

### Results → QA reports

El reporte de QA de cada run: veredicto, tasa de aprobación, cobertura de criterios de aceptación, pruebas generadas y huecos de automatización, seguido del reporte completo. Cambia de run con el selector de arriba a la derecha. El reporte también se guarda como archivo Markdown en el disco; su ruta aparece bajo el título.

### Results → Test results

Todas las ejecuciones de pruebas, con una barra verde/roja de aprobados y fallidos y una tabla por prueba con su estado, duración y el primer renglón del error.

### Results → Failure analysis

- **Optimization insights**: recomendaciones a partir de todos los runs, fallos recurrentes y pruebas inestables (*flaky*).
- **Failure investigations**: cada fallo con su categoría, confianza, causa probable, evidencia, acciones sugeridas, los logs de la aplicación correlacionados y, si aplica, el defecto propuesto.

### Results → Traceability

Elige un ticket arriba a la derecha y verás la matriz completa:

**Requisito → criterio de aceptación → prueba → última ejecución → investigación o defecto**

Sirve para responder preguntas como "¿qué criterio no tiene prueba?" o "¿de qué requisito sale este defecto?". Un criterio sin prueba aparece marcado como **no test**.

### System → Environments & CI

El estado de los entornos (versión, commit, latencia y salud) y los últimos pipelines de CI/CD con su resultado.

---

## 4. Tareas habituales

### Probar un ticket

1. Ve a **Jira tickets** y pulsa **Run QA** en el ticket.
2. Se abre el detalle del run; mira cómo avanzan las etapas.
3. Al terminar, lee el resultado y el motivo en la cabecera.

### Probar todo lo que está listo

1. En **Overview**, pulsa **Test all “Ready for QA” tickets**.
2. Sigue el avance en el tablero de tickets.
3. Atiende lo que aparezca en **Needs your action**.

### Revisar y registrar un defecto

1. Cuando un run encuentra un *product bug*, se detiene en **File bugs** y aparece en **Needs your action**.
2. Pulsa **Review**, lee el resumen y el payload.
3. Pulsa **Approve** para crear el defecto en Jira o **Reject** si no corresponde. El run termina en ambos casos.

### Entender por qué falló una prueba

1. Abre el run y mira la etapa **Diagnose**, o ve a **Results → Failure analysis**.
2. Lee la causa probable y la evidencia.
3. Si es *test needs fixing*, aplica la acción sugerida (por ejemplo, el selector correcto) o ajusta el criterio en Jira.

---

## 5. Uso desde la terminal

Puedes lanzar el flujo sin abrir la consola:

```bash
node src/cli.js run SHOP-101
```

Todos los tickets en *Ready for QA*, aprobando automáticamente los defectos:

```bash
node src/cli.js run --all --approve
```

Usa `--reject` en lugar de `--approve` para rechazarlos. Si no indicas ninguno de los dos, la terminal rechaza los defectos por seguridad.

---

## 6. Escenarios de la demostración

Con los datos de ejemplo verás estos resultados:

| Ticket | Escenario | Resultado esperado |
|---|---|---|
| SHOP-101 | Inicio de sesión | Ready to release |
| SHOP-102 | Código de descuento | Blocked: la tienda cobra $99.00 en vez de $90.00. ORCA lo cruza con los logs y propone un defecto que debes aprobar. |
| SHOP-103 | API de productos | Ready to release |
| SHOP-104 | Restablecer contraseña | Needs attention: el criterio usa un selector inexistente y ORCA sugiere `reset-email-input`. |
| SHOP-105 | Historial de pedidos | Needs attention: el ticket es vago y no tiene criterios, así que no se generan pruebas. |

SHOP-105 empieza en *In Progress*. Pulsa **Simulate Jira activity** y luego **Check Jira now** para pasarlo a *Ready for QA*.

---

## 7. Conectar sistemas reales

Copia `.env.example` a `.env` y configura solo lo que necesites; sin configuración, todo funciona en local con datos de ejemplo. Reinicia ORCA después de cambiar `.env`.

| Sistema | Variables |
|---|---|
| **Jira Cloud** | `JIRA_MODE=cloud`, `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`. Opcionales: `JIRA_AC_FIELD` si los criterios están en un campo personalizado, y `JIRA_AUTO_TRIGGER=true` para lanzar el QA cuando un ticket llegue a `JIRA_TRIGGER_STATUS`. |
| **Modelo de IA** | `ORCA_LLM_PROVIDER=anthropic` y `ANTHROPIC_API_KEY`. Sin esto, los agentes usan reglas propias (en *Connections* verás *LLM off (rule-based agents)*). |
| **Aplicación a probar** | `ORCA_TARGET_BASE_URL` y `ORCA_START_DEMO_APP=false`. |
| **GitHub** | `GITHUB_TOKEN` y `GITHUB_REPO` para leer el código de tu repositorio; `CI_USE_GITHUB_ACTIONS=true` para leer pipelines de GitHub Actions. |
| **Herramientas MCP** | Copia `orca.mcp.example.json` a `orca.mcp.json` y declara los servidores. |
| **Proteger la consola** | `ORCA_API_TOKEN` exige un token en todas las llamadas a la API. |

---

## 8. Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| La página no carga | El servidor no está corriendo. | Ejecuta `npm start`. |
| El punto de conexión está en rojo | Se perdió la conexión con el servidor. | Comprueba la terminal donde corre ORCA; la consola se reconecta sola. |
| Veo la interfaz antigua | Caché del navegador. | Recarga forzada: Cmd/Ctrl + Shift + R. |
| Un run se queda en *Waiting for your approval* | Hay una aprobación pendiente. | Ve a **Approvals**. |
| *Run crashed* | Error técnico durante el run. | Abre el run y revisa **Logs**. |
| Todas las pruebas fallan con *environment problem* | La aplicación a probar no responde. | Revisa **Environments & CI** y la URL configurada. |
| No se generan pruebas | El ticket no tiene criterios de aceptación claros. | Añade criterios en Jira y vuelve a lanzar el QA. |
| *Activity* está vacío | El feed solo muestra lo ocurrido desde que abriste la página. | Lanza un run o revisa el historial en **Runs**. |

# mcp-datos-argentina 🇦🇷

[![CI](https://github.com/Gonza28fq/mcp-datos-argentina/actions/workflows/ci.yml/badge.svg)](https://github.com/Gonza28fq/mcp-datos-argentina/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/mcp-datos-argentina)](https://www.npmjs.com/package/mcp-datos-argentina)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-io.github.Gonza28fq%2Fmcp--datos--argentina-blue)](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.Gonza28fq/mcp-datos-argentina)
[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-green)](LICENSE)

Servidor [MCP](https://modelcontextprotocol.io) que le da a Claude (o cualquier cliente MCP) acceso a **datos públicos de Argentina en tiempo real**: dólar, BCRA, Central de Deudores, inflación, feriados, direcciones y geografía (Georef) y miles de series oficiales del INDEC y ministerios.

📖 **[Manual completo](docs/MANUAL.md)**: qué es MCP, cómo funciona el protocolo, instalación y referencia de cada tool.

> "¿A cuánto está el blue?" · "¿Cuánto son hoy $100.000 de enero 2023?" · "¿Cómo está el CUIT 30-54668997-9 en la Central de Deudores?" · "¿Cuándo es el próximo feriado?"

## Tools

| Tool | Qué hace | Fuente |
|---|---|---|
| `cotizaciones_dolar` | Oficial, blue, MEP, CCL, mayorista, cripto, tarjeta | dolarapi.com |
| `cotizacion_bcra` | Tipo de cambio oficial BCRA de cualquier moneda, por fecha | BCRA – Estadísticas cambiarias v1 |
| `buscar_variables_bcra` | Busca entre ~1600 variables (reservas, BADLAR, TAMAR, CER, UVA, ICL…) | BCRA – Estadísticas monetarias v4 |
| `serie_variable_bcra` | Serie histórica de una variable por id | BCRA – Estadísticas monetarias v4 |
| `consultar_deudor` | Situación crediticia de un CUIT/CUIL + cheques rechazados (valida dígito verificador) | BCRA – Central de Deudores v1 |
| `feriados` | Feriados nacionales del año (o solo los próximos) | argentinadatos.com |
| `inflacion` | IPC mensual y acumulada en un rango | argentinadatos.com |
| `ajustar_por_inflacion` | Lleva un monto de un mes a otro por IPC (hacia adelante o atrás) | argentinadatos.com |
| `riesgo_pais` | Último valor, variación diaria y del período, mínimo/máximo; historia desde 1999 | argentinadatos.com |
| `plazos_fijos` | Ranking de tasas por banco/billetera para un plazo y monto: TNA, TEA, interés y tasa real vs. inflación | argentinadatos.com |
| `normalizar_direccion` | Normaliza y geolocaliza una dirección; si no hay altura, sugiere la calle | Georef (datos.gob.ar) |
| `normalizar_direcciones_lote` | Hasta 500 direcciones en una llamada, con % de éxito | Georef (datos.gob.ar) |
| `buscar_lugar` | Provincias, departamentos, municipios, localidades y calles con id INDEC | Georef (datos.gob.ar) |
| `ubicacion_por_coordenadas` | Qué provincia/departamento/municipio contiene un punto | Georef (datos.gob.ar) |
| `buscar_series` | Busca entre las series oficiales (INDEC y ministerios): salarios, EMAE, empleo, IPC por rubro… | Series de Tiempo (datos.gob.ar) |
| `consultar_series` | Valores, variación %, variación interanual y cambio de frecuencia de hasta 10 series | Series de Tiempo (datos.gob.ar) |

Ninguna API requiere token. Las respuestas se cachean en memoria (2 min a 24 h según la fuente).

## Prompts

Plantillas listas que combinan varias tools. En Claude Code se invocan como `/mcp__datos-argentina__<nombre>`; en Claude Desktop, desde el menú **+**.

| Prompt | Qué arma | Argumentos |
|---|---|---|
| `informe_economico_del_dia` | Dólar y brechas, riesgo país, inflación, mejor plazo fijo y próximo feriado | — |
| `analisis_crediticio` | Central de Deudores de los últimos 24 meses, cheques rechazados y calificación orientativa | `cuit` |
| `plazo_fijo_vs_inflacion` | Mejores plazos fijos, tasa real y dólar MEP de equilibrio | `monto`, `dias` (opcional) |
| `poder_adquisitivo` | Un monto de un mes pasado actualizado por inflación y comparado con el dólar | `monto`, `desde` (YYYY-MM) |

## Resources

Catálogos que se pueden adjuntar como contexto sin llamar una tool (en Claude Code, con `@`).

| URI | Contenido |
|---|---|
| `datos-argentina://bcra/variables` | Las ~1600 variables monetarias del BCRA con id, unidad y periodicidad |
| `datos-argentina://bcra/situaciones` | Qué significa cada situación (1 a 6) de la Central de Deudores |
| `datos-argentina://georef/provincias` | Las 24 jurisdicciones con id INDEC y centroide |
| `datos-argentina://feriados/{anio}` | Feriados nacionales de un año (desde 2016, con autocompletado) |

## Salida estructurada

Todas las tools declaran `outputSchema` y devuelven los datos también en `structuredContent`, validados contra ese esquema. Un programa puede consumirlos tipados sin parsear el texto. Los campos de cada tool están en el [manual](docs/MANUAL.md).

## Instalación

Requiere Node.js 20 o superior. Publicado en npm como [`mcp-datos-argentina`](https://www.npmjs.com/package/mcp-datos-argentina) y listado en el [registro oficial de MCP](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.Gonza28fq/mcp-datos-argentina) como `io.github.Gonza28fq/mcp-datos-argentina`.

### Claude Code

```bash
claude mcp add --scope user datos-argentina -- npx -y mcp-datos-argentina
```

### Claude Desktop

En `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "datos-argentina": {
      "command": "npx",
      "args": ["-y", "mcp-datos-argentina"]
    }
  }
}
```

### Desde el código fuente

```bash
git clone https://github.com/Gonza28fq/mcp-datos-argentina.git
cd mcp-datos-argentina
npm install
npm run build
claude mcp add datos-argentina -- node /ruta/a/mcp-datos-argentina/dist/index.js
```

## Desarrollo

```bash
npm test           # tests unitarios (CUIT, cálculos de inflación)
npm run smoke      # levanta el servidor y llama cada tool contra las APIs reales
npm run inspector  # MCP Inspector para probar a mano
npm run docs       # regenera la referencia de tools en docs/MANUAL.md
```

Estructura:

```
src/
  index.ts      # arranque del servidor (stdio)
  tools.ts      # tools de BCRA, dólar, inflación y feriados
  georef.ts     # tools de normalización geográfica
  series.ts     # tools de series de tiempo oficiales
  mercado.ts    # riesgo país y plazos fijos
  plazofijo.ts  # selección de tasa por plazo/monto y cálculo de TEA y tasa real
  ventana.ts    # workaround del bug de transformaciones de Series de Tiempo
  comun.ts      # helpers compartidos
  http.ts       # fetch con timeout + caché
  cuit.ts       # validación de CUIT/CUIL
  inflacion.ts  # inflación acumulada y ajuste de montos
```

## Notas

- Los montos de la Central de Deudores se devuelven tal como los informa la API del BCRA. Su documentación pública no especifica la unidad (pesos o miles de pesos), así que conviene tomarlos como valores relativos.
- La inflación usa el IPC mensual de INDEC; el ajuste compone los meses posteriores al mes de origen hasta el de destino inclusive.
- La API de estadísticas v3 del BCRA fue deprecada (devuelve 410); este servidor usa la v4.
- **Bug conocido de Series de Tiempo:** al combinar `last`/`limit` con una transformación (variación, interanual), la API corre la ventana hacia atrás y omite los períodos más recientes (con la interanual, un año entero). `consultar_series` lo esquiva pidiendo con `start_date` (ver `src/ventana.ts`).
- Georef no tiene alturas cargadas para muchas calles del interior: en esos casos `normalizar_direccion` devuelve las calles candidatas en lugar de coordenadas exactas.
- Al agregar a frecuencia anual, la API omite el año en curso (incompleto).

## Roadmap

- [ ] Padrón de ARCA (constancia de inscripción) — requiere certificado del Web Service
- [x] Riesgo país y plazos fijos por banco (v0.3.0)
- [x] Publicación en npm (`npx mcp-datos-argentina`)
- [x] Listado en el registro oficial de MCP
- [x] Prompts MCP (informe del día, análisis crediticio, plazo fijo vs. inflación, poder adquisitivo)
- [x] Resources (catálogos de variables BCRA, situaciones, provincias, feriados)
- [x] Salida estructurada (`outputSchema` en las 16 tools)
- [ ] Transporte HTTP (Streamable HTTP) para uso remoto

Historial de cambios en [CHANGELOG.md](CHANGELOG.md).

## Licencia

MIT

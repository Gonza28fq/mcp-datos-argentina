# mcp-datos-argentina 🇦🇷

Servidor [MCP](https://modelcontextprotocol.io) que le da a Claude (o cualquier cliente MCP) acceso a **datos públicos de Argentina en tiempo real**: dólar, BCRA, Central de Deudores, inflación y feriados.

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

Ninguna API requiere token. Las respuestas se cachean en memoria (2 min a 24 h según la fuente).

## Instalación

```bash
npm install
npm run build
```

### Claude Code

```bash
claude mcp add datos-argentina -- node /ruta/a/mcp-datos-argentina/dist/index.js
```

### Claude Desktop

En `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "datos-argentina": {
      "command": "node",
      "args": ["C:/ruta/a/mcp-datos-argentina/dist/index.js"]
    }
  }
}
```

## Desarrollo

```bash
npm test           # tests unitarios (CUIT, cálculos de inflación)
npm run smoke      # levanta el servidor y llama cada tool contra las APIs reales
npm run inspector  # MCP Inspector para probar a mano
```

Estructura:

```
src/
  index.ts      # arranque del servidor (stdio)
  tools.ts      # definición de las 8 tools
  http.ts       # fetch con timeout + caché
  cuit.ts       # validación de CUIT/CUIL
  inflacion.ts  # inflación acumulada y ajuste de montos
```

## Notas

- Los montos de la Central de Deudores se devuelven tal como los informa la API del BCRA. Su documentación pública no especifica la unidad (pesos o miles de pesos), así que conviene tomarlos como valores relativos.
- La inflación usa el IPC mensual de INDEC; el ajuste compone los meses posteriores al mes de origen hasta el de destino inclusive.
- La API de estadísticas v3 del BCRA fue deprecada (devuelve 410); este servidor usa la v4.

## Roadmap

- [ ] Padrón de ARCA (constancia de inscripción) — requiere certificado del Web Service
- [ ] Riesgo país y plazos fijos por banco
- [ ] Publicación en npm (`npx mcp-datos-argentina`)
- [ ] Transporte HTTP (Streamable HTTP) para uso remoto

## Licencia

MIT

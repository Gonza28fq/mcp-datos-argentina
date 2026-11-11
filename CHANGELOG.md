# Changelog

Todos los cambios relevantes de este proyecto. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el proyecto usa [versionado semántico](https://semver.org/lang/es/).

## [Sin publicar]

## [0.5.0] - 2026-11-10

### Agregado
- `consultar_cheque_denunciado`: consulta en el BCRA si un cheque fue denunciado como extraviado, robado o adulterado. El banco se indica por nombre ("Nación", "Galicia", "ICBC", "Francés") o por código, y si el nombre es ambiguo devuelve las candidatas.
- Resource `datos-argentina://bcra/entidades-cheques` con los códigos de entidad.
- **Calculadoras**, con la lógica separada en `src/calculadoras.ts` y testeada sin red:
  - `calcular_aguinaldo`: SAC del semestre (50% del mejor sueldo), proporcional por días si hubo ingreso o egreso, con neto estimado y fecha de vencimiento.
  - `cuotas_vs_contado`: trae las cuotas a valor presente con la inflación esperada (por defecto, el promedio de los últimos 3 meses) y calcula el interés implícito de las cuotas.
  - `simular_credito_uva`: sistema francés en UVAs con el valor UVA del día (BCRA), ingreso mínimo según la relación cuota/ingreso y proyección de cuota y saldo en pesos.

## [0.4.0] - 2026-11-10

### Agregado
- **Prompts MCP**: plantillas listas que combinan varias tools.
  - `informe_economico_del_dia`: dólar y brechas, riesgo país, inflación, mejor plazo fijo y próximo feriado.
  - `analisis_crediticio` (`cuit`): Central de Deudores de 24 meses, cheques rechazados y calificación orientativa. Valida el dígito verificador.
  - `plazo_fijo_vs_inflacion` (`monto`, `dias`): mejores plazos fijos, tasa real y dólar MEP de equilibrio.
  - `poder_adquisitivo` (`monto`, `desde`): monto actualizado por inflación y comparado con el dólar.
- Los montos de los prompts aceptan formato argentino (`1.000.000`, `$ 1.500,50`).
- El manual (`docs/MANUAL.md`) incluye una tabla de prompts generada desde `prompts/list`.
- **Resources MCP**: `datos-argentina://bcra/variables`, `datos-argentina://bcra/situaciones`, `datos-argentina://georef/provincias` y la plantilla `datos-argentina://feriados/{anio}` (con autocompletado del año).
- **Salida estructurada**: las 16 tools declaran `outputSchema` y devuelven `structuredContent` validado. Los esquemas están en `src/esquemas.ts`; los campos que vienen de APIs externas son opcionales para tolerar cambios en la fuente.
- El smoke test (`npm run smoke`) ahora falla si una tool no tiene esquema, si su salida no lo cumple, si aparece un error inesperado o si un resource no se puede leer.
- Este `CHANGELOG.md`.

### Cambiado
- **El JSON de las respuestas siempre es un objeto.** Las tools que devolvían una lista ahora la envuelven en un campo con nombre (`cotizaciones`, `variables`, `valores`, `feriados`, `opciones`, `direcciones`, `resultados`, `series`). `cotizacion_bcra` devuelve el mismo formato con o sin moneda, y `consultar_deudor` el mismo con o sin deudas. Afecta solo a quien parseaba el JSON del texto; el resumen legible no cambia.
- `feriados` informa el año consultado y la fecha del próximo feriado; `plazos_fijos`, la inflación usada para la tasa real.
- Release: el workflow espera a que npm procese la versión antes de publicar en el Registro MCP, y saltea `npm publish` si la versión ya existe (permite re-correr el job).

## [0.3.1] - 2026-11-10

Primera versión publicada automáticamente desde GitHub Actions.

### Agregado
- CI en GitHub Actions: build y tests en Node 20, 22 y 24, más prueba contra las APIs reales (no bloqueante).
- Release automático al subir un tag `v*`: publica en npm por Trusted Publishing (OIDC, con *provenance*) y actualiza el Registro MCP.
- Badges de CI, npm, Registro MCP y licencia en el README.

### Cambiado
- La versión vive solo en `package.json`; `npm version` sincroniza `server.json`.
- El User-Agent informa la versión real y el repositorio.

## [0.3.0] - 2026-11-09

### Agregado
- `riesgo_pais`: último valor, variación diaria y del período, mínimo y máximo; historia desde 1999.
- `plazos_fijos`: ranking de tasas por banco y billetera con TNA, TEA, interés para un monto y tasa real contra la última inflación.
- Manual de usuario en `docs/MANUAL.md`, con referencia de tools autogenerada (`npm run docs`).
- Publicación en npm (`npx mcp-datos-argentina`) y listado en el Registro MCP oficial (`server.json`).

## [0.2.0] - 2026-11-09

### Agregado
- Georef (datos.gob.ar): `normalizar_direccion`, `normalizar_direcciones_lote` (hasta 500), `buscar_lugar` y `ubicacion_por_coordenadas`.
- Series de Tiempo (datos.gob.ar): `buscar_series` y `consultar_series` (hasta 10 series, variaciones y cambio de frecuencia).

### Corregido
- Rodeo de un error de la API de Series: combinar `last`/`limit` con una transformación corría la ventana de fechas.

## [0.1.0] - 2026-11-09

### Agregado
- Primera versión: `cotizaciones_dolar`, `cotizacion_bcra`, `buscar_variables_bcra`, `serie_variable_bcra` (API v4 del BCRA),
  `consultar_deudor` (Central de Deudores, con validación de CUIT), `feriados`, `inflacion` y `ajustar_por_inflacion`.
- Caché en memoria por fuente y transporte stdio.

[Sin publicar]: https://github.com/Gonza28fq/mcp-datos-argentina/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/Gonza28fq/mcp-datos-argentina/releases/tag/v0.5.0
[0.4.0]: https://github.com/Gonza28fq/mcp-datos-argentina/releases/tag/v0.4.0
[0.3.1]: https://github.com/Gonza28fq/mcp-datos-argentina/releases/tag/v0.3.1
[0.3.0]: https://github.com/Gonza28fq/mcp-datos-argentina/commit/7748c96
[0.2.0]: https://github.com/Gonza28fq/mcp-datos-argentina/commit/961dae9
[0.1.0]: https://github.com/Gonza28fq/mcp-datos-argentina/commit/250f4ee

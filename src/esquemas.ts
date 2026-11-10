/**
 * Esquemas de salida (outputSchema) de cada tool.
 *
 * El servidor los publica en tools/list y el SDK valida que structuredContent los cumpla:
 * un cliente puede consumir los datos tipados sin parsear el texto.
 * Los campos que vienen tal cual de una API externa son nullish: si la fuente deja de
 * informar uno, la tool sigue funcionando en vez de fallar la validación.
 */
import { z } from "zod";

const num = z.number().nullish();
const str = z.string().nullish();
const ref = z.object({ id: str, nombre: str });

// ---------- Dólar y BCRA ----------

export const salidaCotizacionesDolar = z.object({
  cotizaciones: z.array(
    z.object({
      casa: z.string(),
      nombre: z.string(),
      moneda: str,
      compra: num,
      venta: num,
      fechaActualizacion: str,
    }),
  ),
});

export const salidaCotizacionBcra = z.object({
  cotizaciones: z.array(
    z.object({
      fecha: z.string(),
      moneda: z.string(),
      descripcion: str,
      cotizacion: num.describe("Pesos por unidad de moneda."),
      pase: num.describe("Unidades de moneda por dólar."),
    }),
  ),
});

export const salidaBuscarVariablesBcra = z.object({
  total: z.number().int().describe("Cantidad de variables que coinciden (puede ser mayor que las devueltas)."),
  variables: z.array(
    z.object({
      id: z.number().int(),
      descripcion: z.string(),
      categoria: str,
      unidad: str,
      periodicidad: str,
      ultimaFecha: str,
      ultimoValor: num,
    }),
  ),
});

export const salidaSerieVariableBcra = z.object({
  id: z.number().int(),
  valores: z.array(z.object({ fecha: z.string(), valor: z.number() })).describe("Más reciente primero."),
});

export const salidaConsultarDeudor = z.object({
  cuit: z.string(),
  denominacion: str,
  periodos: z.array(
    z.object({
      periodo: z.string().describe("YYYY-MM"),
      montoTotal: z.number(),
      peorSituacion: z.number().int(),
      entidades: z.array(
        z.object({
          entidad: z.string(),
          situacion: z.number().int(),
          situacionDescripcion: z.string(),
          monto: z.number(),
          diasAtraso: num,
          procesoJudicial: z.boolean().nullish(),
        }),
      ),
    }),
  ).describe("Más reciente primero. Vacío si no registra deudas."),
  chequesRechazados: z.unknown().describe("Detalle tal como lo informa el BCRA, o null si no registra."),
});

// ---------- Calendario e inflación ----------

export const salidaFeriados = z.object({
  anio: z.number().int(),
  proximo: str.describe("Fecha del próximo feriado del año, o null si no quedan."),
  feriados: z.array(z.object({ fecha: z.string(), tipo: z.string(), nombre: z.string() })),
});

export const salidaInflacion = z.object({
  meses: z.array(z.object({ mes: z.string(), inflacionPct: z.number() })),
  acumuladaPct: z.number(),
});

export const salidaAjustarPorInflacion = z.object({
  montoOriginal: z.number(),
  montoAjustado: z.number(),
  inflacionAcumuladaPct: z.number(),
  mesesConsiderados: z.number().int(),
  primerMes: str,
  ultimoMes: str,
  advertencia: z.string().optional(),
});

// ---------- Mercado ----------

const puntoFechaValor = z.object({ fecha: z.string(), valor: z.number() });

export const salidaRiesgoPais = z.object({
  ultimo: puntoFechaValor,
  variacionDiariaPb: num,
  variacionPeriodoPb: z.number(),
  variacionPeriodoPct: z.number(),
  minimo: puntoFechaValor,
  maximo: puntoFechaValor,
  serie: z.array(puntoFechaValor),
});

export const salidaPlazosFijos = z.object({
  dias: z.number().int(),
  entidadesConTasa: z.number().int(),
  totalEntidades: z.number().int(),
  inflacionReferencia: z
    .object({ mes: z.string(), inflacionPct: z.number() })
    .nullable()
    .describe("Última inflación mensual usada para la tasa real (null si no se pudo obtener)."),
  opciones: z.array(
    z.object({
      entidad: z.string(),
      tnaPct: z.number(),
      teaPct: z.number(),
      efectivaMensualPct: z.number(),
      tasaRealMensualPct: z.number().optional(),
      interes: z.number().optional(),
      montoFinal: z.number().optional(),
      origenTasa: z.string(),
      enlace: z.string().optional(),
    }),
  ),
});

// ---------- Georef ----------

const direccionSimple = z.object({
  nomenclatura: str,
  calle: str,
  altura: num,
  piso: str,
  provincia: str,
  departamento: str,
  localidad: str,
  lat: num,
  lon: num,
  idCalle: str,
});

export const salidaNormalizarDireccion = z.object({
  direccionEncontrada: z.boolean(),
  total: z.number().int(),
  direcciones: z.array(direccionSimple).describe("Coincidencias, si se encontró la altura."),
  callesSugeridas: z
    .array(
      z.object({
        calle: str,
        categoria: str,
        localidad: str,
        departamento: str,
        provincia: str,
        idCalle: str,
      }),
    )
    .describe("Calles con ese nombre, si no se pudo geolocalizar la altura."),
});

export const salidaNormalizarDireccionesLote = z.object({
  total: z.number().int(),
  encontradas: z.number().int(),
  resultados: z.array(direccionSimple.partial().extend({ entrada: z.string(), encontrada: z.boolean() })),
});

export const salidaBuscarLugar = z.object({
  tipo: z.string(),
  total: z.number().int(),
  resultados: z
    .array(z.record(z.string(), z.unknown()))
    .describe("Tal como los devuelve Georef: id, nombre, centroide y unidades que los contienen."),
});

export const salidaUbicacionPorCoordenadas = z.object({
  lat: z.number(),
  lon: z.number(),
  provincia: ref,
  departamento: ref,
  municipio: ref,
});

// ---------- Series de tiempo ----------

export const salidaBuscarSeries = z.object({
  series: z.array(
    z.object({
      id: z.string(),
      descripcion: z.string(),
      unidades: str,
      frecuencia: str,
      desde: str,
      hasta: str,
      dataset: str,
      fuente: str,
    }),
  ),
});

export const salidaConsultarSeries = z.object({
  series: z.array(z.object({ id: z.string(), descripcion: z.string(), unidades: str })),
  datos: z
    .array(z.record(z.string(), z.union([z.string(), z.number(), z.null()])))
    .describe("Una fila por fecha: { fecha, <id de serie>: valor, ... }."),
});

/**
 * Inicialización compartida de OpenTelemetry (T40, ADR-013): trazas, métricas y logs con
 * contexto W3C. La exportación es asíncrona y jamás bloquea al llamador: si el Collector u
 * `otel-lgtm` no responden, `iniciarTelemetria` igual arranca (los exportadores reintentan y
 * descartan en silencio) y las validaciones de negocio nunca esperan a la telemetría (PB-21).
 *
 * No incluye instrumentación específica de un componente ni reglas de negocio: cada componente
 * (C1, C2, C4) usa `trace.getTracer(...)` y `metrics.getMeter(...)` (este módulo; instrumentos
 * diferidos, válidos aunque se creen al importar) y llama una vez a `iniciarTelemetria` en su
 * arranque (`main.ts`/`index.ts`).
 */
import { context, metrics as metricsApi, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type {
  Context, Meter, MeterOptions, MeterProvider as ProveedorMedidores, Observable, ObservableCallback, Span, Tracer,
} from '@opentelemetry/api';
import { W3CBaggagePropagator, W3CTraceContextPropagator, CompositePropagator } from '@opentelemetry/core';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

export { context, propagation, SpanKind, SpanStatusCode, trace };
export type { Context, Span, Tracer };

/**
 * Límites de los histogramas de latencia V1 (C1 y C2). Los predeterminados de OTel no incluyen
 * 300 ni 400 ms, así que la proporción de T1 (≤ 300 ms, T2 §8.2) no se podía calcular con
 * `le="300"`; 500 ms es el p95 de CA2 y 2000 ms el plazo del perfil de carga.
 */
export const LIMITES_LATENCIA_MS: readonly number[] = [
  5, 10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000,
];

/**
 * A diferencia de `trace`, la API de métricas de OTel no tiene proveedor proxy: un
 * `metrics.getMeter()` ejecutado al importar un módulo, antes de `iniciarTelemetria`, devuelve un
 * medidor no-op para siempre. Los puntos de entrada importan su grafo de módulos antes de iniciar
 * la telemetría, así que los instrumentos se crean aquí de forma diferida y se vuelven a enlazar
 * cada vez que cambia el proveedor global.
 */
const revinculadores = new Set<() => void>();

function getMeterDiferido(nombre: string, version?: string, opciones?: MeterOptions): Meter {
  let proveedor: ProveedorMedidores = metricsApi.getMeterProvider();
  let real = proveedor.getMeter(nombre, version, opciones);
  const actual = (): Meter => {
    const vigente = metricsApi.getMeterProvider();
    if (vigente !== proveedor) {
      proveedor = vigente;
      real = vigente.getMeter(nombre, version, opciones);
    }
    return real;
  };
  const sincrono = <T>(crear: (m: Meter) => T): (() => T) => {
    let origen = actual();
    let instrumento = crear(origen);
    return () => {
      const m = actual();
      if (m !== origen) {
        origen = m;
        instrumento = crear(m);
      }
      return instrumento;
    };
  };
  const observable = <T extends Observable>(crear: (m: Meter) => T): T => {
    const callbacks = new Set<ObservableCallback>();
    let origen: Meter | undefined;
    let instrumento: T | undefined;
    const vincular = (): T => {
      const m = actual();
      if (m !== origen || !instrumento) {
        if (instrumento) for (const cb of callbacks) instrumento.removeCallback(cb);
        origen = m;
        instrumento = crear(m);
        for (const cb of callbacks) instrumento.addCallback(cb);
      }
      return instrumento;
    };
    vincular();
    revinculadores.add(() => { vincular(); });
    const proxy: Observable = {
      addCallback(cb) {
        const i = vincular();
        if (callbacks.has(cb)) return;
        callbacks.add(cb);
        i.addCallback(cb);
      },
      removeCallback(cb) {
        callbacks.delete(cb);
        vincular().removeCallback(cb);
      },
    };
    return proxy as T;
  };
  return {
    createCounter(n, o) {
      const i = sincrono((m) => m.createCounter(n, o));
      return { add: (v, a, c) => i().add(v, a, c) };
    },
    createUpDownCounter(n, o) {
      const i = sincrono((m) => m.createUpDownCounter(n, o));
      return { add: (v, a, c) => i().add(v, a, c) };
    },
    createHistogram(n, o) {
      const i = sincrono((m) => m.createHistogram(n, o));
      return { record: (v, a, c) => i().record(v, a, c) };
    },
    createGauge(n, o) {
      const i = sincrono((m) => m.createGauge(n, o));
      return { record: (v, a, c) => i().record(v, a, c) };
    },
    createObservableGauge: (n, o) => observable((m) => m.createObservableGauge(n, o)),
    createObservableCounter: (n, o) => observable((m) => m.createObservableCounter(n, o)),
    createObservableUpDownCounter: (n, o) => observable((m) => m.createObservableUpDownCounter(n, o)),
    // Los callbacks por lote reciben instrumentos del SDK; con los proxies de aquí no aplican.
    addBatchObservableCallback: (cb, obs) => actual().addBatchObservableCallback(cb, obs),
    removeBatchObservableCallback: (cb, obs) => actual().removeBatchObservableCallback(cb, obs),
  };
}

export const metrics = {
  getMeter: getMeterDiferido,
  getMeterProvider: (): ProveedorMedidores => metricsApi.getMeterProvider(),
  /** Registra el proveedor global y reenlaza los instrumentos observables ya creados. */
  setGlobalMeterProvider(provider: ProveedorMedidores): boolean {
    const registrado = metricsApi.setGlobalMeterProvider(provider);
    for (const revincular of revinculadores) revincular();
    return registrado;
  },
};

export interface OpcionesTelemetria {
  /** Nombre estable del servicio (p. ej. `nexo-reader-client`, `nexo-local-coordinator`). */
  servicio: string;
  version?: string;
  /** `deployment.environment`; por defecto `NODE_ENV` o `desarrollo`. */
  ambiente?: string;
  /** Por defecto `OTEL_EXPORTER_OTLP_ENDPOINT`; vacío o ausente desactiva la exportación (no la instrumentación). */
  endpoint?: string;
  /** Milisegundos de espera por intento de exportación antes de descartar el lote (no bloquea negocio). */
  timeoutMs?: number;
}

export interface ContextoTraza {
  traceId?: string;
  spanId?: string;
}

export interface ControlTelemetria {
  tracer: Tracer;
  /** `true` si hay un endpoint OTLP configurado (exportación activa, no garantiza que responda). */
  exportando: boolean;
  /** Contexto de traza activo (para enriquecer logs JSON, T2 §8.4). */
  contextoActivo(): ContextoTraza;
  /** Cierre ordenado: nunca lanza; falla en silencio si el backend no responde. */
  apagar(): Promise<void>;
}

const propagador = new CompositePropagator({
  propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
});

let providersGlobalesRegistrados = false;

/**
 * Arranca (una sola vez por proceso) los proveedores globales de trazas, métricas y logs, y
 * registra el propagador W3C Trace Context. Segura de invocar sin `OTEL_EXPORTER_OTLP_ENDPOINT`:
 * en ese caso las trazas/métricas se siguen generando en el proceso (para el `trace_id`/`span_id`
 * de los logs y la propagación entre C1→C2→C4) pero no se exportan a ningún backend.
 */
export function iniciarTelemetria(opciones: OpcionesTelemetria): ControlTelemetria {
  const endpoint = (opciones.endpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '').replace(/\/+$/, '');
  const timeoutMillis = opciones.timeoutMs ?? 3000;
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: opciones.servicio,
    [ATTR_SERVICE_VERSION]: opciones.version ?? '0.1.0',
    'deployment.environment': opciones.ambiente ?? process.env.NODE_ENV ?? 'desarrollo',
  });

  const tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: endpoint
      ? [new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces`, timeoutMillis }))]
      : [],
  });

  const meterProvider = new MeterProvider({
    resource,
    readers: endpoint
      ? [new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics`, timeoutMillis }),
        exportIntervalMillis: 10_000,
      })]
      : [],
  });

  const loggerProvider = new LoggerProvider({
    resource,
    processors: endpoint
      ? [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter({ url: `${endpoint}/v1/logs`, timeoutMillis }) })]
      : [],
  });

  // Solo el primer llamador de un proceso registra los proveedores globales (evita choques cuando
  // varios componentes arrancan en el mismo proceso, p. ej. pruebas de integración).
  if (!providersGlobalesRegistrados) {
    tracerProvider.register({ propagator: propagador });
    metrics.setGlobalMeterProvider(meterProvider);
    providersGlobalesRegistrados = true;
  }

  if (!endpoint) {
    console.warn(`[telemetria] ${opciones.servicio}: sin OTEL_EXPORTER_OTLP_ENDPOINT; trazas/métricas/logs no se exportan`);
  }

  return {
    tracer: trace.getTracer(opciones.servicio, opciones.version),
    exportando: Boolean(endpoint),
    contextoActivo(): ContextoTraza {
      const span = trace.getSpan(context.active());
      const ctx = span?.spanContext();
      return ctx && trace.isSpanContextValid(ctx) ? { traceId: ctx.traceId, spanId: ctx.spanId } : {};
    },
    async apagar(): Promise<void> {
      await Promise.allSettled([tracerProvider.shutdown(), meterProvider.shutdown(), loggerProvider.shutdown()]);
    },
  };
}

/** Cabeceras W3C (`traceparent`/`tracestate`) del contexto activo, para clientes HTTP salientes. */
export function inyectarCabeceras(cabeceras: Record<string, string> = {}): Record<string, string> {
  propagation.inject(context.active(), cabeceras);
  return cabeceras;
}

/** Extrae el contexto W3C de las cabeceras de una solicitud entrante (`req.headers`). */
export function extraerContexto(cabeceras: Record<string, string | string[] | undefined>): Context {
  return propagation.extract(context.active(), cabeceras);
}

/** Construye un `Context` remoto a partir de un `traceparent` W3C aislado (para `Span Link`, T2 §8.3). */
export function contextoDesdeTraceparent(traceparent: string): Context {
  return propagation.extract(context.active(), { traceparent });
}

/**
 * Ejecuta `fn` dentro de un span activo de `tracer`, cerrándolo con el estado adecuado
 * (ERROR y `recordException` si `fn` lanza) sin alterar el valor devuelto ni el error propagado.
 */
export async function conSpan<T>(
  tracer: Tracer,
  nombre: string,
  fn: (span: Span) => Promise<T> | T,
  opciones: { kind?: SpanKind; padre?: Context; atributos?: Record<string, string | number | boolean> } = {},
): Promise<T> {
  return tracer.startActiveSpan(nombre, { kind: opciones.kind, attributes: opciones.atributos },
    opciones.padre ?? context.active(), async (span) => {
      try {
        const resultado = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return resultado;
      } catch (error) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : String(error) });
        throw error;
      } finally {
        span.end();
      }
    });
}

/**
 * `mixin` de pino (T2 §8.4): agrega `trace_id`/`span_id` a cada línea de log cuando hay un span
 * activo, sin tocar el resto de campos ni el nivel.
 */
export function pinoMixinTraza(): () => Partial<Record<'trace_id' | 'span_id', string>> {
  return () => {
    const span = trace.getSpan(context.active());
    const ctx = span?.spanContext();
    if (!ctx || !trace.isSpanContextValid(ctx)) return {};
    return { trace_id: ctx.traceId, span_id: ctx.spanId };
  };
}

/** Campos prohibidos por T2 §8.4 (QR, boleta completa, identidad, secretos, cabeceras de sesión); ver README. */
export const CAMPOS_LOG_PROHIBIDOS = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.contrasena',
  '*.token',
  '*.secret',
  '*.qr',
  '*.codigoCompleto',
] as const;


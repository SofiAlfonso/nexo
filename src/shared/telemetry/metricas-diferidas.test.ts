import { metrics as metricsApi } from '@opentelemetry/api';
import {
  AggregationTemporality, InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { afterEach, describe, expect, it } from 'vitest';
import { metrics } from './index.ts';

// Reproduce el arranque real: los módulos crean sus instrumentos al importarse, antes de que
// `iniciarTelemetria` registre el proveedor global.
const meter = metrics.getMeter('prueba.diferida');
const contador = meter.createCounter('prueba_contador_total');
const gauge = meter.createObservableGauge('prueba_gauge');
gauge.addCallback((r) => { r.observe(7); });

afterEach(() => { metricsApi.disable(); });

async function exportar(provider: MeterProvider, exporter: InMemoryMetricExporter) {
  await provider.forceFlush();
  return exporter.getMetrics().flatMap((rm) => rm.scopeMetrics.flatMap((sm) => sm.metrics));
}

describe('metrics.getMeter diferido', () => {
  it('enlaza instrumentos creados antes de registrar el proveedor global', async () => {
    contador.add(5);
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const provider = new MeterProvider({
      readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })],
    });
    metrics.setGlobalMeterProvider(provider);

    contador.add(2);
    const exportadas = await exportar(provider, exporter);
    const suma = exportadas.find((m) => m.descriptor.name === 'prueba_contador_total');
    expect(suma?.dataPoints[0]?.value).toBe(2);
    const observado = exportadas.find((m) => m.descriptor.name === 'prueba_gauge');
    expect(observado?.dataPoints[0]?.value).toBe(7);
    await provider.shutdown();
  });
});

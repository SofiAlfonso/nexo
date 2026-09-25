import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LoteEvidencia } from '@nexo/shared/contracts';
import { ValidarPrimerIngreso } from '@nexo/shared/domain';
import { AutoridadNodoUnico } from '../../../src/local-coordinator/application/autoridad.ts';
import { DespachadorOutbox } from '../../../src/local-coordinator/application/despachador-outbox.ts';
import { RegistroLatidos } from '../../../src/local-coordinator/application/latidos.ts';
import { ContadorV1 } from '../../../src/local-coordinator/application/prioridad.ts';
import { cargarConfig } from '../../../src/local-coordinator/config.ts';
import { crearClienteE1Http } from '../../../src/local-coordinator/infrastructure/e1/cliente-e1.ts';
import { dockerDisponible, EVENTO, iniciarD1, RelojAjustable, solicitud } from './entorno.ts';
import type { EntornoD1 } from './entorno.ts';

/** C4 simulado: idempotente por (tipo, idOrigen); `modo` controla caída y pérdida del acuse. */
class CentralFalsa {
  modo: 'caido' | 'pierde-acuse' | 'ok' = 'caido';
  readonly recibidos = new Map<string, number>();
  lotes = 0;
  private servidor: Server | null = null;

  async iniciar(): Promise<string> {
    this.servidor = createServer((req, res) => {
      let datos = '';
      req.on('data', (c: Buffer) => { datos += c.toString(); });
      req.on('end', () => {
        if (req.url !== '/v1/lotes-evidencia' || this.modo === 'caido') {
          res.writeHead(503, { 'content-type': 'application/json' }).end('{"error":"NO_DISPONIBLE","mensaje":"caído"}');
          return;
        }
        const lote = LoteEvidencia.parse(JSON.parse(datos));
        this.lotes++;
        const resultados = lote.registros.map((r) => {
          const clave = `${r.tipo}|${r.idOrigen}`;
          const previo = this.recibidos.get(clave) ?? 0;
          this.recibidos.set(clave, previo + 1);
          return { tipo: r.tipo, idOrigen: r.idOrigen, estado: previo ? 'duplicado' as const : 'aceptado' as const };
        });
        if (this.modo === 'pierde-acuse') {
          this.modo = 'ok';
          res.writeHead(502).end();
          return;
        }
        const aceptados = resultados.filter((r) => r.estado === 'aceptado').length;
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
          idLote: lote.idLote, repetido: false, recibidoEn: new Date().toISOString(),
          aceptados, duplicados: resultados.length - aceptados, resultados,
        }));
      });
    });
    await new Promise<void>((ok) => this.servidor!.listen(0, '127.0.0.1', ok));
    return `http://127.0.0.1:${(this.servidor!.address() as AddressInfo).port}`;
  }

  decisionesAceptadas(): number {
    return [...this.recibidos.keys()].filter((k) => k.startsWith('decision|')).length;
  }

  async cerrar(): Promise<void> {
    await new Promise<void>((ok) => this.servidor?.close(() => ok()) ?? ok());
  }
}

describe.skipIf(!dockerDisponible)('E1: outbox de C2 hacia C4', () => {
  let entorno: EntornoD1;
  const central = new CentralFalsa();
  let url: string;

  beforeAll(async () => {
    entorno = await iniciarD1();
    url = await central.iniciar();
  });
  afterAll(async () => {
    await central.cerrar();
    await entorno?.cerrar();
  });

  it('el outbox crece con C4 caído y drena sin duplicados al volver', async () => {
    const config = cargarConfig({ EVENTO_ID: EVENTO, COORDINADOR_ID: 'C2-INT', LOTE_EVIDENCIA_MAX: '10' });
    const reloj = new RelojAjustable();
    const autoridad = new AutoridadNodoUnico(config.coordinadorId);
    const caso = new ValidarPrimerIngreso({ unidades: entorno.almacen.unidades, alcance: entorno.almacen.alcance, autoridad, reloj });
    const latidos = new RegistroLatidos();
    const despachador = new DespachadorOutbox({
      outbox: entorno.almacen.outbox, latidos, v1: new ContadorV1(), cliente: crearClienteE1Http(url, { timeoutMs: 2_000 }),
      config, reloj, estado: () => ({ estado: autoridad.actual().estado, versionPermisos: 37, versionPoliticas: 2 }),
    });

    const N = 25;
    for (let i = 1; i <= N; i++) {
      await caso.ejecutar(solicitud(`TA-8801-${String(i).padStart(4, '0')}`));
    }
    await caso.ejecutar(solicitud('TA-8801-0001', { lectorId: 'LX-2210-114', puntoId: 'P-02' }));
    const total = N + 1;

    for (let i = 0; i < 3; i++) expect((await despachador.ejecutarCiclo()).error).toBeDefined();
    expect((await entorno.almacen.outbox.resumen(reloj.ahora())).pendientes).toBe(total);
    expect(despachador.metricas()).toMatchObject({ enLinea: false, fallosConsecutivos: 3 });

    central.modo = 'pierde-acuse';
    expect((await despachador.ejecutarCiclo()).error).toBeDefined();

    for (let i = 0; i < 10; i++) {
      const r = await despachador.ejecutarCiclo();
      expect(r.error).toBeUndefined();
      if (r.pendientes === 0) break;
    }

    expect((await entorno.almacen.outbox.resumen(reloj.ahora())).pendientes).toBe(0);
    expect(central.decisionesAceptadas()).toBe(total);
    const enviados = await entorno.pool.query<{ n: string; lotes: string }>(
      'SELECT count(*) n, count(DISTINCT id_lote) lotes FROM outbox_envio',
    );
    expect(Number(enviados.rows[0]!.n)).toBe(total);
    for (const [clave, veces] of central.recibidos) {
      if (clave.startsWith('decision|')) expect(veces).toBeLessThanOrEqual(2);
    }
    expect(despachador.metricas()).toMatchObject({ enLinea: true, fallosConsecutivos: 0, pendientes: 0 });

    const vacio = await despachador.ejecutarCiclo();
    expect(vacio).toMatchObject({ enviados: 0, pendientes: 0 });
    expect(central.decisionesAceptadas()).toBe(total);
  });
});

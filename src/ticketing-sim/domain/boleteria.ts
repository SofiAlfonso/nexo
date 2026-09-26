import { CambioBoleteria, VersionBoleteria } from '@nexo/shared/contracts';
import type { IndiceVersiones } from '@nexo/shared/contracts';
import { z } from 'zod';

export const Localidad = z.enum(['NORTE', 'SUR', 'ORIENTAL', 'OCCIDENTAL', 'PALCOS']);
export type Localidad = z.infer<typeof Localidad>;

interface Emision {
  referencia: string;
  localidad: string;
  comprador?: CambioBoleteria['comprador'];
}

interface OpcionesBoleteria {
  boleteria?: string;
  eventoExterno?: string;
  emisiones: Emision[];
  anuladasIniciales?: string[];
  ahora?: () => Date;
}

interface EstadoBoleta {
  localidad: Localidad;
  anulada: boolean;
}

const EstadoExportado = z.object({
  boleteria: z.string().min(1),
  eventoExterno: z.string().min(1),
  versiones: z.array(VersionBoleteria).min(1),
  boletas: z.array(z.object({
    referencia: z.string().min(1),
    localidad: Localidad,
    anulada: z.boolean(),
  })),
});

export class BoletaDesconocida extends Error {
  constructor(referencia: string) {
    super(`Boleta desconocida: ${referencia}`);
  }
}

export class BoletaYaAnulada extends Error {
  constructor(referencia: string) {
    super(`Boleta ya anulada: ${referencia}`);
  }
}

export class BoletaYaEmitida extends Error {
  constructor(referencia: string) {
    super(`Boleta ya emitida: ${referencia}`);
  }
}

export class LocalidadInvalida extends Error {
  constructor(localidad: string) {
    super(`Localidad inválida: ${localidad}`);
  }
}

function validarLocalidad(localidad: string): Localidad {
  const resultado = Localidad.safeParse(localidad);
  if (!resultado.success) throw new LocalidadInvalida(localidad);
  return resultado.data;
}

export class Boleteria {
  private readonly nombre: string;
  private readonly eventoExterno: string;
  private readonly ahora: () => Date;
  private readonly versiones: VersionBoleteria[] = [];
  private readonly boletas = new Map<string, EstadoBoleta>();

  constructor({
    boleteria = 'TaquillaAndina',
    eventoExterno = 'TA-FECHA-14',
    emisiones,
    anuladasIniciales = [],
    ahora = () => new Date(),
  }: OpcionesBoleteria) {
    this.nombre = boleteria;
    this.eventoExterno = eventoExterno;
    this.ahora = ahora;
    const instante = this.ahora().toISOString();
    const anuladas = new Set(anuladasIniciales);
    if (anuladas.size !== anuladasIniciales.length) throw new Error('Anulación inicial repetida');
    const cambios: CambioBoleteria[] = [];
    for (const emision of emisiones) {
      if (this.boletas.has(emision.referencia)) throw new BoletaYaEmitida(emision.referencia);
      const localidad = validarLocalidad(emision.localidad);
      this.boletas.set(emision.referencia, { localidad, anulada: anuladas.has(emision.referencia) });
      if (!anuladas.has(emision.referencia)) {
        cambios.push(CambioBoleteria.parse({
          operacion: 'emision', referenciaExterna: emision.referencia, localidad, instante,
          ...(emision.comprador === undefined ? {} : { comprador: emision.comprador }),
        }));
      }
    }
    this.publicar(true, cambios, instante);
    if (anuladas.size > 0) {
      this.publicar(false, anuladasIniciales.map((referencia) => {
        const boleta = this.boletas.get(referencia);
        if (!boleta) throw new BoletaDesconocida(referencia);
        return { operacion: 'anulacion', referenciaExterna: referencia, localidad: boleta.localidad, instante };
      }), instante);
    }
  }

  private publicar(instantanea: boolean, cambios: CambioBoleteria[], publicadaEn = this.ahora().toISOString()): VersionBoleteria {
    const version = VersionBoleteria.parse({
      numero: this.versiones.length, eventoExterno: this.eventoExterno, publicadaEn, instantanea, cambios,
    });
    this.versiones.push(version);
    return structuredClone(version);
  }

  indice(): IndiceVersiones {
    return {
      boleteria: this.nombre,
      eventoExterno: this.eventoExterno,
      ultimaVersion: this.versiones.length - 1,
      versiones: this.versiones.map((version) => ({
        numero: version.numero, publicadaEn: version.publicadaEn, cambios: version.cambios.length,
      })),
    };
  }

  version(n: number): VersionBoleteria | null {
    const version = this.versiones[n];
    return version ? structuredClone(version) : null;
  }

  anular(referencia: string): VersionBoleteria {
    const boleta = this.obtenerVigente(referencia);
    const version = this.publicar(false, [this.cambio('anulacion', referencia, boleta.localidad)]);
    boleta.anulada = true;
    return version;
  }

  emitir(referencia: string, localidad: string): VersionBoleteria {
    if (this.boletas.has(referencia)) throw new BoletaYaEmitida(referencia);
    const valida = validarLocalidad(localidad);
    const version = this.publicar(false, [this.cambio('emision', referencia, valida)]);
    this.boletas.set(referencia, { localidad: valida, anulada: false });
    return version;
  }

  cambiarLocalidad(referencia: string, localidad: string): VersionBoleteria {
    const boleta = this.obtenerVigente(referencia);
    const valida = validarLocalidad(localidad);
    const version = this.publicar(false, [this.cambio('cambio-localidad', referencia, valida)]);
    boleta.localidad = valida;
    return version;
  }

  private obtenerVigente(referencia: string): EstadoBoleta {
    const boleta = this.boletas.get(referencia);
    if (!boleta) throw new BoletaDesconocida(referencia);
    if (boleta.anulada) throw new BoletaYaAnulada(referencia);
    return boleta;
  }

  private cambio(operacion: CambioBoleteria['operacion'], referencia: string, localidad: Localidad): CambioBoleteria {
    return CambioBoleteria.parse({
      operacion, referenciaExterna: referencia, localidad, instante: this.ahora().toISOString(),
    });
  }

  exportar(): string {
    return JSON.stringify({
      boleteria: this.nombre,
      eventoExterno: this.eventoExterno,
      versiones: this.versiones,
      boletas: [...this.boletas].map(([referencia, estado]) => ({ referencia, ...estado })),
    });
  }

  static restaurar(json: string, ahora: () => Date = () => new Date()): Boleteria {
    const estado = EstadoExportado.parse(JSON.parse(json) as unknown);
    const instancia = new Boleteria({
      boleteria: estado.boleteria, eventoExterno: estado.eventoExterno, emisiones: [], ahora,
    });
    instancia.versiones.splice(0, instancia.versiones.length, ...structuredClone(estado.versiones));
    instancia.boletas.clear();
    for (const boleta of estado.boletas) {
      if (instancia.boletas.has(boleta.referencia)) throw new BoletaYaEmitida(boleta.referencia);
      instancia.boletas.set(boleta.referencia, { localidad: boleta.localidad, anulada: boleta.anulada });
    }
    for (const [numero, version] of instancia.versiones.entries()) {
      if (version.numero !== numero || version.eventoExterno !== estado.eventoExterno || version.instantanea !== (numero === 0)) {
        throw new Error('Estado de versiones inválido');
      }
    }
    return instancia;
  }
}

export function semillaPiloto(): Pick<OpcionesBoleteria, 'emisiones' | 'anuladasIniciales'> {
  const emisiones: Emision[] = Array.from({ length: 16_240 }, (_, n) => ({
    referencia: `TA-${8800 + Math.floor(n / 1000)}-${String(n % 1000).padStart(4, '0')}`,
    localidad: n < 4980 ? 'NORTE' : n < 8340 ? 'SUR' : n < 12350 ? 'ORIENTAL' : n < 15710 ? 'OCCIDENTAL' : 'PALCOS',
    ...(n < 10 ? { comprador: {
      nombre: 'Comprador de prueba', documento: 'DOC-PRUEBA', correo: 'prueba@example.invalid',
    } } : {}),
  }));
  return { emisiones, anuladasIniciales: ['TA-8800-0001'] };
}

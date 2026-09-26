import type { Diferencia } from '../../../../shared/contracts/o2.ts';

export type NuevaDiferencia = Omit<Diferencia, 'id' | 'estado' | 'resolucion' | 'resueltaPor' | 'resueltaEnS'>;

/**
 * Diferencia `diario` (prototipo §9): termina un episodio y los diarios ya sincronizados
 * reportan más intentos que decisiones confirmadas en D2 ("N intentos sin decisión confirmada").
 * Única opción: registrar sin aceptación (no generan admisión ni cobro).
 */
export function diferenciaDiario(casos: number, detectadaEnS: number): NuevaDiferencia {
  return {
    tipo: 'diario',
    titulo: `${casos} intentos sin decisión confirmada`,
    origen: 'Diarios de los puntos',
    detalle: 'Los diarios sincronizados reportan más intentos que decisiones confirmadas en la evidencia recibida.',
    casos,
    referencia: null,
    intentoId: null,
    opciones: [{ id: 'registrar-sin-aceptacion', texto: 'Registrar sin aceptación', nota: 'No generan admisión ni cobro' }],
    detectadaEnS,
  };
}

/**
 * Diferencia `anulacion` (prototipo §9): llega una anulación de una boleta que ya había sido
 * aceptada antes de recibirla.
 */
export function diferenciaAnulacion(referencia: string, intentoId: string, detectadaEnS: number): NuevaDiferencia {
  return {
    tipo: 'anulacion',
    titulo: `${referencia} aceptada antes de recibir su anulación`,
    origen: 'Integración con la boletería',
    detalle: 'La boleta fue aceptada como admisión antes de que llegara su anulación desde la boletería.',
    casos: 1,
    referencia,
    intentoId,
    opciones: [
      { id: 'excluir-del-cobro', texto: 'Excluir del cobro', nota: 'No cuenta como admisión facturable' },
      { id: 'mantener-admision', texto: 'Mantener la admisión', nota: 'Solo si el cliente lo acuerda por escrito' },
    ],
    detectadaEnS,
  };
}

export interface CondicionCierre {
  id: 'ventana-cerrada' | 'diarios-sincronizados' | 'buzon-vacio' | 'cambios-al-dia' | 'preliminar-entregado' | 'diferencias-resueltas';
  texto: string;
  ok: boolean;
}

export interface DatosCondicionesCierre {
  ventanaCerrada: boolean;
  diariosSincronizados: boolean;
  buzonVacio: boolean;
  cambiosAlDia: boolean;
  preliminarEntregado: boolean;
  diferenciasResueltas: boolean;
}

/**
 * Condiciones para declarar conciliado (`condicionesCierre`, prototipo §9): ventana de ingreso
 * cerrada; diarios sincronizados; decisiones en la nube (buzón vacío y enlace arriba); cambios de
 * la boletería al día; informe preliminar entregado; todas las diferencias resueltas.
 */
export function evaluarCondicionesCierre(datos: DatosCondicionesCierre): CondicionCierre[] {
  return [
    { id: 'ventana-cerrada', texto: 'Ventana de ingreso cerrada', ok: datos.ventanaCerrada },
    { id: 'diarios-sincronizados', texto: 'Diarios de los puntos sincronizados', ok: datos.diariosSincronizados },
    { id: 'buzon-vacio', texto: 'Todas las decisiones llegaron a la nube', ok: datos.buzonVacio },
    { id: 'cambios-al-dia', texto: 'Cambios de la boletería al día', ok: datos.cambiosAlDia },
    { id: 'preliminar-entregado', texto: 'Informe preliminar entregado', ok: datos.preliminarEntregado },
    { id: 'diferencias-resueltas', texto: 'Todas las diferencias resueltas', ok: datos.diferenciasResueltas },
  ];
}

export function condicionesPendientes(condiciones: CondicionCierre[]): string[] {
  return condiciones.filter((condicion) => !condicion.ok).map((condicion) => condicion.id);
}

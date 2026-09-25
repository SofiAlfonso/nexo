import type { Incidente } from '../../../../shared/contracts/o2.ts';

export const UMBRAL_SIN_COMUNICACION_MS = 60_000;
export type NuevoIncidente = Omit<Incidente, 'id'>;

export function sinComunicacion(ultimaComunicacion: Date, ahora: Date): boolean {
  return ahora.getTime() - ultimaComunicacion.getTime() > UMBRAL_SIN_COMUNICACION_MS;
}

export function segundosDelDia(instante: Date): number {
  return instante.getHours() * 3600 + instante.getMinutes() * 60 +
    instante.getSeconds();
}

export function incidenteSinComunicacion(puntoId: string, detectadoEn: Date): NuevoIncidente {
  const t = segundosDelDia(detectadoEn);
  return {
    tipo: 'SIN_COMUNICACION',
    clasificacion: 'SIN_COMUNICACION',
    prioridad: 'alta',
    puntoId,
    componente: null,
    zona: null,
    titulo: 'Puerta sin comunicación',
    descripcion: `El punto ${puntoId} lleva más de 60 s sin reportar un latido.`,
    responsable: 'SUPERVISOR',
    estado: 'nuevo',
    recibidaEnS: t,
    actuadaEnS: null,
    resueltaEnS: null,
    recuperadaEnS: null,
    metaRecuperacionS: null,
    relojDesdeS: t,
    destacado: false,
    checklist: [
      { texto: 'Redirigir el flujo a las puertas vecinas', hecho: false },
      { texto: 'Revisar el enlace de red de la puerta', hecho: false },
      { texto: 'Confirmar la sincronización del diario', hecho: false },
    ],
    bitacora: [{ t, autor: 'sistema', tipo: 'sistema', texto: 'Detectado por vigilancia de latidos (>60s)' }],
  };
}

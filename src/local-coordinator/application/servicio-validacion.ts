import { resultadoSinConfirmacion } from '@nexo/shared/domain';
import type { ResultadoValidacion, SolicitudIngreso, ValidarPrimerIngreso } from '@nexo/shared/domain';
import type { ConfigCoordinador } from '../config.ts';
import type { ContadorV1 } from './prioridad.ts';

export class ServicioValidacion {
  private readonly caso: ValidarPrimerIngreso;
  private readonly contador: ContadorV1;
  private readonly config: ConfigCoordinador;
  private readonly reloj: { ahora(): Date };
  constructor(
    caso: ValidarPrimerIngreso, contador: ContadorV1, config: ConfigCoordinador,
    reloj: { ahora(): Date } = { ahora: () => new Date() },
  ) {
    this.caso = caso;
    this.contador = contador;
    this.config = config;
    this.reloj = reloj;
  }

  async ejecutar(solicitud: SolicitudIngreso): Promise<ResultadoValidacion> {
    const liberar = this.contador.iniciar();
    let timer: NodeJS.Timeout | undefined;
    const trabajo = Promise.resolve().then(() => this.caso.ejecutar(solicitud)).finally(liberar);
    try {
      // El plazo limita la respuesta, no cancela el commit: un reintento recupera la decisión.
      return await Promise.race([
        trabajo,
        new Promise<ResultadoValidacion>((resolve) => {
          timer = setTimeout(() => resolve(resultadoSinConfirmacion(
            solicitud.idOrigen, this.reloj.ahora(), this.config.coordinadorId, null,
          )), this.config.plazoValidacionMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

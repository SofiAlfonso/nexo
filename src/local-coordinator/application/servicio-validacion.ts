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
    const venceEn = new Date(this.reloj.ahora().getTime() + this.config.plazoValidacionMs);
    const trabajo = Promise.resolve().then(() => this.caso.ejecutar({ ...solicitud, venceEn })).finally(liberar);
    try {
      // El caso no confirma pasado `venceEn`; D1 acota cada sentencia al mismo plazo.
      // Un commit ya en curso al vencer puede aterrizar: el reintento con el mismo idOrigen lo recupera.
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

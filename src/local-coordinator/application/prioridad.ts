/**
 * Prioridad de V1 sobre E1 (ADR-011): el servidor cuenta validaciones en curso
 * y el despachador del outbox espera mientras haya alguna.
 */
export class ContadorV1 {
  private activas = 0;

  iniciar(): () => void {
    this.activas++;
    let cerrado = false;
    return () => {
      if (!cerrado) {
        cerrado = true;
        this.activas--;
      }
    };
  }

  enCurso(): number {
    return this.activas;
  }

  /** Espera hasta que no haya validaciones en curso o venza `maxEsperaMs`. */
  async esperarLibre(maxEsperaMs: number, pasoMs = 5): Promise<void> {
    const limite = Date.now() + maxEsperaMs;
    while (this.activas > 0 && Date.now() < limite) {
      await new Promise((r) => setTimeout(r, pasoMs));
    }
  }
}

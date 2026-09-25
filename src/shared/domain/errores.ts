/** Errores de dominio. Clases sin parameter properties (Node 24 ejecuta TS por borrado de tipos). */

/** Entrada inválida antes de evaluar permisos (PB-03). */
export class ErrorEntradaInvalida extends Error {
  readonly campo: string;
  constructor(campo: string, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorEntradaInvalida';
    this.campo = campo;
  }
}

/** Mismo `idOrigen` con contenido distinto (PB-04): error de integridad, 409 en V1. */
export class ErrorConflictoIdempotencia extends Error {
  readonly idOrigen: string;
  constructor(idOrigen: string) {
    super(`El idOrigen ${idOrigen} ya se usó con otro contenido`);
    this.name = 'ErrorConflictoIdempotencia';
    this.idOrigen = idOrigen;
  }
}

/** Credencial revocada o de otro evento (PB-14): no se consulta la boleta; 403 en V1. */
export class ErrorSinConfianza extends Error {
  readonly lectorId: string;
  constructor(lectorId: string, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorSinConfianza';
    this.lectorId = lectorId;
  }
}

/** La clave de consumo ya existe en D1 (UNIQUE). La lanza el adaptador. */
export class ErrorConsumoDuplicado extends Error {
  constructor(mensaje = 'La clave de consumo ya está registrada') {
    super(mensaje);
    this.name = 'ErrorConsumoDuplicado';
  }
}

/** Otro proceso registró el mismo `idOrigen` entre la búsqueda y la inserción. La lanza el adaptador. */
export class ErrorIntentoDuplicado extends Error {
  constructor(mensaje = 'El idOrigen ya está registrado') {
    super(mensaje);
    this.name = 'ErrorIntentoDuplicado';
  }
}

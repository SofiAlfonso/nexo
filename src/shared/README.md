# Paquete compartido

`@nexo/shared` contiene código compartido entre componentes; `contracts/` mantiene esquemas Zod y tipos de V1, H1, E1, P1, P2, O2 y Auth como fuente única de verdad.
`domain/` contiene el motor de primer ingreso usado por C2 y las reglas del prototipo `dominio.js`; `telemetry/` inicializa OpenTelemetry común.
No importar ningún componente desde `shared` ni incluir aquí lógica exclusiva de un componente.
La implementación de estas áreas se completa en la ola 1.

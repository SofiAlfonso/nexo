# ADR-008: Identidad y confianza de los dispositivos

- **Estado**: Pendiente de PoC (bloqueante)
- **Fecha**: 14 de septiembre de 2026 (registro del taller 2); actualizado 25 de septiembre de 2026
- **Origen**: taller 2, entregable 02 (docs/context/taller2.md §3)

## Contexto

Cada lector C1 solicita decisiones al coordinador local C2 y una LAN o VPN no prueba su identidad.
Un lector suplantado o perdido podría solicitar accesos fuera de su alcance, incluso durante un corte de internet.
La respuesta tampoco puede reutilizarse para otro intento o dispositivo.

## Decisión

Cada lector tendrá una credencial individual, autenticación mutua con C2 y alcance limitado a cliente, evento, punto y periodo.
C2 conservará la revocación de credenciales aun sin internet.
Las respuestas quedarán vinculadas al intento, al lector y al contenido; un lector que no pueda registrar su intento no aceptará nuevos accesos.

## Alternativas consideradas

- Clave compartida: impide revocar un lector sin afectar a todos.
- Confiar en la LAN o VPN: la ubicación de red no autentica dispositivos.
- Exigir hardware propio: eleva el costo sin sustituir la prueba de identidad.

## Consecuencias

Hay que emitir, distribuir, rotar y revocar credenciales individuales, además de proteger las claves fuera del repositorio.
Una autenticación fallida o una respuesta repetida debe impedir la apertura, sin convertir a la nube en autoridad por escaneo.
La PoC de identidad y antirrepetición sigue siendo bloqueante antes de operar con público.

## Criterio para aceptar

Demostrar que un lector autorizado se autentica mutuamente, que otro lector o un certificado revocado no puede validar ni durante un corte de internet, y que una respuesta de otro intento, lector o contenido no abre el paso.
Verificar que la imposibilidad de registrar el intento detiene nuevas aceptaciones.

## Aplicación en el taller 3

- Implementar mTLS C1–C2 con CA de laboratorio y credencial revocable por lector después del hito M1.
- Generar certificados y revocaciones de laboratorio con `scripts/certs.ps1` (envoltorio del generador Node). Las claves y la CA privadas se guardan solo en `deploy/certs/`, ignorado por Git salvo su README y `.gitignore`; en Kubernetes se distribuyen mediante Secrets (G18).
- C2 conserva HTTP por defecto para `npm run dev`. Con `COORDINATOR_TLS=true` exige `COORDINATOR_TLS_CERT_FILE`, `COORDINATOR_TLS_KEY_FILE`, `COORDINATOR_TLS_CA_FILE` y `COORDINATOR_TLS_REVOKED_FILE`. El archivo `revoked.json` contiene `version`, `issuerFingerprint256` y `revoked` (entradas con `readerId`, `serialNumber`, `fingerprint256`, `revokedAt` y `reason`). Una lista ausente, inválida o emitida para otra CA impide arrancar.
- Cada certificado de lector lleva CN `nexo-reader:<lectorId>` y SAN URI `urn:nexo:reader:<lectorId>`; C2 toma la identidad del SAN, valida la CA emisora, vigencia y revocación y exige que coincida con `lectorId` antes de procesar V1 o H1. El alcance evento/punto y la revocación lógica del lector siguen verificándose en D1.

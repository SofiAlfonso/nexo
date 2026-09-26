# Credenciales mTLS de laboratorio (T25)

Usa **Node 24**, sin OpenSSL ni dependencias adicionales. El envoltorio
PowerShell `scripts/certs.ps1` delega en `scripts/certs.mjs`:

```powershell
.\scripts\certs.ps1 init
.\scripts\certs.ps1 issue-server --dns localhost --ip 127.0.0.1
.\scripts\certs.ps1 issue-reader --reader-id LX-2210-0107
.\scripts\certs.ps1 status --reader-id LX-2210-0107
.\scripts\certs.ps1 revoke --reader-id LX-2210-0107 --reason lost
.\scripts\certs.ps1 status --reader-id LX-2210-0107
```

`--store nombre` en cualquier comando selecciona un almacén independiente bajo
`deploy/certs/private/nombre/`. Por defecto se usa `deploy/certs/private/`.
Esa carpeta está ignorada por Git; **no subas su contenido**. `ca.key` es una
clave de laboratorio sin contraseña (modo 0600 donde el sistema lo soporta);
guárdala fuera de máquinas compartidas. Para producción, usar una CA gestionada,
claves protegidas y un proceso de rotación de certificados, no este script.

La raíz contiene `ca.crt`, `ca.key` y `revoked.json`. Cada lector obtiene
`readers/<readerId>/tls.crt` y `tls.key`; C2 obtiene
`coordinator/tls.crt` y `tls.key`. Distribuye a C2 `ca.crt`, su certificado
y clave, y la lista de revocaciones; a cada lector **solo** su propio certificado
y clave y `ca.crt`. No distribuyas `ca.key`. Un identificador ya emitido nunca
se vuelve a emitir en el mismo almacén, incluso después de revocarlo; para
rotarlo, coordina una nueva identidad y su configuración de autorización.
El identificador admite, por ejemplo, `LX-2210-0107` (D1) o `107` (pruebas).

La CA es ECDSA P-256 (vigencia 365 días); los certificados individuales duran
30 días. C1 presenta un certificado con `CN=nexo-reader:<readerId>`, SAN
`URI:urn:nexo:reader:<readerId>`, EKU clientAuth; C2 presenta EKU serverAuth
y SAN DNS/IP (`localhost`/`127.0.0.1` por defecto). Todos tienen extensiones
X.509v3 `basicConstraints` y `keyUsage` críticas. La emisión no modifica la
autoridad de validación: **solo C2** decide ingresos.

## Revocación local sin internet

`revoke` conserva en disco `revoked.json` con el formato que consume C2
(`COORDINATOR_TLS_REVOKED_FILE=deploy/certs/private/revoked.json`):

```json
{
  "version": 1,
  "issuerFingerprint256": "<SHA-256 de ca.crt, 64 hex minúsculos sin dos puntos>",
  "revoked": [
    {
      "readerId": "LX-2210-0107",
      "serialNumber": "<serial X.509 en hex mayúsculas>",
      "fingerprint256": "<SHA-256 del certificado, 64 hex minúsculos sin dos puntos>",
      "revokedAt": "<fecha ISO-8601>",
      "reason": "lost"
    }
  ]
}
```

El serial es exactamente `X509Certificate.serialNumber` de Node; las huellas
son `X509Certificate.fingerprint256` normalizadas quitando `:` y convirtiendo
a minúsculas. Razones: `lost` (por defecto), `compromised`, `retired`. Repetir
`revoke` no duplica la entrada ni cambia fecha y motivo originales. C2 debe
validar el certificado con **su** CA de confianza, cotejar
`issuerFingerprint256` con esa CA, rechazar cualquier serial o huella
revocados y autenticar el `readerId` contra SAN y el alcance autorizado antes
de decidir. El fichero JSON **no es una CRL X.509 ni está firmado**: proteger
su almacenamiento y no aceptar una lista proporcionada por el lector.
Publicar/reemplazar la lista en C2 de forma atómica y recargarla tras una
revocación; la generación por sí sola no bloquea lectores en C2.

Configuración C2 (además de `COORDINATOR_TLS=true`):
`COORDINATOR_TLS_CERT_FILE=deploy/certs/private/coordinator/tls.crt`,
`COORDINATOR_TLS_KEY_FILE=deploy/certs/private/coordinator/tls.key`,
`COORDINATOR_TLS_CA_FILE=deploy/certs/private/ca.crt` y
`COORDINATOR_TLS_REVOKED_FILE=deploy/certs/private/revoked.json` (rutas resueltas
respecto al proceso de C2). Una lista vacía conserva `version: 1`, la huella
de la CA y `revoked: []`.

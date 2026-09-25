# Scripts de despliegue

**Responsabilidad**: alojar los futuros scripts de creación, verificación,
restauración y eliminación del entorno local (Minikube), así como scripts
de construcción local de imágenes.

**Qué no debe implementarse aquí**: secretos embebidos en los scripts. Los
secrets se crean externamente y nunca se almacenan en Git (ver
[config/README.md](../../config/README.md)).

**Componente relacionado**: transversal — automatiza el ciclo de vida del
entorno de todos los componentes (C1–C5, D1–D2).

## Sembrar datos locales

`seed.ps1` inserta datos idempotentes en D1 y D2, publicados por Compose en
`localhost:5433` y `localhost:5434`. PowerShell invoca `seed.ts`, que aplica
las migraciones antes de ejecutar cada SQL de semilla en una transacción;
las bases deben estar creadas y accesibles. Se requieren PowerShell, Node.js
24 o posterior y las dependencias instaladas con `npm ci` (`pg`, `tsx` y `argon2`).

La contraseña común de laboratorio para los cinco operadores se exige por
`SEED_OPERATOR_PASSWORD`; el script genera su hash Argon2 en cada ejecución y
nunca imprime ni persiste la contraseña. No existe contraseña predeterminada.
`seed.ts` calcula el hash y lo sustituye en el SQL de D2; la contraseña en
texto claro no se guarda en las bases.
La semilla inicial crea los cinco usuarios; una repetición conserva los hashes
ya guardados y no sirve para cambiar una contraseña existente.
Configure también las contraseñas de conexión que correspondan al entorno:

| Variable | Valor por omisión / uso |
|---|---|
| `SEED_OPERATOR_PASSWORD` | Obligatoria; contraseña inicial de los cinco operadores |
| `D1_DATABASE_URL`, `D2_DATABASE_URL` | Opcionales; tienen prioridad sobre las variables PostgreSQL de su base |
| `LOCAL_POSTGRES_HOST`, `LOCAL_POSTGRES_PORT`, `LOCAL_POSTGRES_DB`, `LOCAL_POSTGRES_USER`, `LOCAL_POSTGRES_PASSWORD` | Conexión de D1; predeterminados de host/puerto/base/usuario: `localhost`, `5433`, `nexo_venue`, `nexo_venue`; contraseña obligatoria |
| `CENTRAL_POSTGRES_HOST`, `CENTRAL_POSTGRES_PORT`, `CENTRAL_POSTGRES_DB`, `CENTRAL_POSTGRES_USER`, `CENTRAL_POSTGRES_PASSWORD` | Conexión de D2; predeterminados de host/puerto/base/usuario: `localhost`, `5434`, `nexo_central`, `nexo_central`; contraseña obligatoria |
| `D1_HOST`, `D1_PORT`, `D1_POSTGRES_DB`, `D1_POSTGRES_USER`, `D1_POSTGRES_PASSWORD` | Alias aceptados por `seed.ps1` para D1 |
| `D2_HOST`, `D2_PORT`, `D2_POSTGRES_DB`, `D2_POSTGRES_USER`, `D2_POSTGRES_PASSWORD` | Alias aceptados por `seed.ps1` para D2 |

Ejemplo en PowerShell; la entrada es oculta y las variables solo viven en el
proceso actual:

```powershell
function Set-ProcessSecret([string] $Name, [string] $Prompt) {
    $secret = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try {
        [Environment]::SetEnvironmentVariable(
            $Name,
            [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer),
            'Process'
        )
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        $secret.Dispose()
    }
}
Set-ProcessSecret 'SEED_OPERATOR_PASSWORD' 'Contraseña para los operadores'
Set-ProcessSecret 'D1_POSTGRES_PASSWORD' 'Contraseña de D1'
Set-ProcessSecret 'D2_POSTGRES_PASSWORD' 'Contraseña de D2'
docker compose -f deploy/compose/docker-compose.dev.yml up -d
.\deploy\scripts\seed.ps1
```

Para pruebas de integración, `deploy/scripts/seed.ts` exporta
`async seed(d1Pool: Pool, d2Pool: Pool, password: string): Promise<void>`.
La función inserta los datos dentro de una transacción por base y no aplica
migraciones; la prueba debe aplicar primero `migrate(d1Pool)` y
`migrate(d2Pool)`. Importar el módulo no inicia el CLI. Para invocarlo
directamente, configure `SEED_OPERATOR_PASSWORD`, `D1_DATABASE_URL` /
`D2_DATABASE_URL` o las variables de fábrica `LOCAL_POSTGRES_*` /
`CENTRAL_POSTGRES_*`, y ejecute:

```powershell
node --import tsx .\deploy\scripts\seed.ts
```

La semilla crea los operadores `supervisor`, `lider-tecnico`, `logistica`,
`cierre` y `finanzas`; 1 cliente, 1 recinto, 3 eventos, 5 zonas, 20 puntos,
20 lectores y 16.240 boletas, además de los casos de validación y permisos
versión 1 en D1 y D2. Las boletas por zona son Norte 4.980, Sur 3.360,
Oriental 4.010, Occidental 3.360 y Palcos 530.

Para sembrar y generar el catálogo real de prueba del lector en el mismo paso,
pase `--export <ruta>` al CLI. Use una ruta **fuera de Git**:

```powershell
$boletaFile = Join-Path $HOME 'Documents\boletas-lector.json'
.\deploy\scripts\seed.ps1 --export $boletaFile
```

El comando aplica migraciones, siembra ambas bases y exporta los datos activos
de D1. También puede invocarse directamente con
`node --import tsx .\deploy\scripts\seed.ts --export $boletaFile`.

El JSON contiene `eventos: [{eventoId, boletas: [{codigo, zona, estado,
usada}]}]`, `lectores: [{lectorId, puntoId, eventoId, zonas}]` y `casos` con
ejemplos de válidas, anuladas, ya consumidas, zona equivocada, desconocidas y
copias concurrentes. `usada` refleja consumos reales de D1; las zonas usan los
nombres de V1 (`Norte`, `Sur`, etc.), no los IDs internos `Z-*` de D2.
`--boletas <ruta>` del lector carga este archivo. El script falla si no hay
exactamente un evento abierto o si faltan boletas, lectores o casos de prueba.

Para que los casos de validación sigan siendo ejecutables, `EVT-2026-02` se
siembra abierto con una ventana operativa de `now() - 1 hour` a `now() + 12
hours`; el reingreso queda deshabilitado. D2 conserva el horario descriptivo
original del prototipo (16 sep. 2026, 17:00–20:15) en `contratos.condiciones`.

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
copias concurrentes. `usada` refleja consumos reales de D1; al regenerar, los
ejemplos de ingreso válido y copia concurrente eligen boletas vigentes aún
libres y el ejemplo de uso previo elige un consumo existente. Si se agotan las
boletas libres, se omiten esos ejemplos sin bloquear la exportación. Las zonas usan los
nombres de V1 (`Norte`, `Sur`, etc.), no los IDs internos `Z-*` de D2.
`--boletas <ruta>` del lector carga este archivo. El script falla si no hay
exactamente un evento abierto o si faltan boletas o lectores.

Para que los casos de validación sigan siendo ejecutables, `EVT-2026-02` se
siembra abierto con una ventana operativa de `now() - 1 hour` a `now() + 12
hours`; el reingreso queda deshabilitado. D2 conserva el horario descriptivo
original del prototipo (16 sep. 2026, 17:00–20:15) en `contratos.condiciones`.

## Orquestación en Minikube (T26/T27)

`up.mjs`, `down.mjs`, `reset.mjs` y `load.mjs` (con envoltorios `.ps1`)
automatizan el ciclo de vida del laboratorio Kubernetes descrito en
[deploy/minikube/README.md](../minikube/README.md) y los manifiestos de
`deploy/kubernetes/` (namespaces, `data/` con los StatefulSets de D1/D2 y
`application/` con Deployments/Jobs/NetworkPolicies de C2/C4/Toxiproxy/
boletería). Comparten `k8s-lib.mjs` (ejecución de `kubectl`/`minikube`,
espera de rollouts, Secrets de laboratorio desde `config/examples/`).

- **`up`** — construye las 5 imágenes con `minikube image build`
  (`imagePullPolicy: Never`, sin publicar a ningún registro), crea los
  Secrets de D1/D2/central si faltan, aplica
  `deploy/kubernetes/namespaces/` y `kubectl apply -k deploy/kubernetes/`
  (StatefulSets de D1/D2, Deployments de C2/C4/Toxiproxy/boletería,
  NetworkPolicies), corre el Job `nexo-db-init` (migraciones + semilla) y
  espera los rollouts. Reutiliza los PVC/Secrets existentes si ya corrió
  antes: repetir `up` tras `down` no reinicia los datos.
- **`down`** — elimina Jobs puntuales, Deployments/Services de aplicación y
  los StatefulSets/Services de datos, pero conserva los PVC y Secrets (un
  `up` posterior reutiliza D1/D2 tal como quedaron).
- **`reset --confirm`** — `down` además de borrar los PVC y los Secrets de
  laboratorio; deja el clúster como recién creado. Requiere `--confirm`
  porque destruye datos.
- **`load`** — exporta las boletas activas de D1 con un Pod puntual
  (imagen `nexo/db-init:dev`, mismo patrón que `nexo-db-init`: mantenimiento,
  no tráfico de negocio), recorta la exportación a una muestra representativa
  por zona/estado (un ConfigMap de Kubernetes no admite más de 1 MiB) y corre
  `nexo-reader-load` (el lector emulado, C1, como Job) contra
  `http://nexo-coordinator:8081` con el perfil `nominal` durante 30 s.

`observability/` no lo toca ninguno de estos scripts (otra sesión ya lo
despliega); `up` solo aplica `namespaces/` y `deploy/kubernetes/{data,application}`.
`nexo-ticketing` (boletería simulada) está implementada (T23,
`src/ticketing-sim/`); si no arranca, no bloquea el resto del despliegue.

**Prueba de frontera**: `npx vitest run --config vitest.integration.config.ts
tests/integration/k8s/network-policies.test.ts` verifica contra el clúster
vivo que C2 no alcanza D2 directamente, que C2 alcanza D1 y C4 vía Toxiproxy,
y que D2 es alcanzable desde `nexo-central` (para C4).

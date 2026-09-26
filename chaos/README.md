# nexo-chaos (solo laboratorio Minikube)

La CLI prepara perturbaciones reproducibles para F1–F4. **No ejecute los YAML
reales hasta la ola 3**, después de confirmar los nombres de recursos con
S2-k8s y de medir el estado estable descrito en `docs/context/taller2.md`
§11.3. Las definiciones están en `experiments/*/experiment.yaml`; use datos
sintéticos, un evento, un punto y una instancia. Producción está bloqueada.

```powershell
node chaos/scripts/nexo-chaos.ts validate chaos/experiments/red-01-central-connection/experiment.yaml
node chaos/scripts/nexo-chaos.ts plan chaos/experiments/red-01-central-connection/experiment.yaml
node chaos/scripts/nexo-chaos.ts run chaos/experiments/red-01-central-connection/experiment.yaml --confirm
node chaos/scripts/nexo-chaos.ts status
node chaos/scripts/nexo-chaos.ts abort
node chaos/scripts/nexo-chaos.ts restore
```

`plan` registra la huella del YAML validado; `run --confirm` exige un plan de
esa misma versión. `run --confirm --dry-run` escribe evidencia sin alterar
recursos y puede cerrarse con `restore`. Solo puede haber una ejecución
activa. Cada ejecución queda en `evidence/<uuid>.json`, con objetivos,
estado anterior, acciones y resultado de la reversión. El bloqueo
`evidence/.active.json` se conserva si no se logra revertir: inspeccione
`status`, solucione la causa y repita `restore`. No borre el bloqueo a mano.

Un watchdog independiente invoca `restore` al vencer la duración (máximo 15
minutos); `status` y `plan` también recuperan una ejecución vencida si el
watchdog dejó de funcionar. `abort` y `restore` revierten antes del plazo. El
proceso requiere acceso a `kubectl` con el contexto Minikube correcto y
acceso al API Toxiproxy cuando se pruebe F1. Para F1, en otra terminal:
`kubectl -n nexo-venue port-forward service/toxiproxy 8474:8474`; en la
terminal de la CLI defina `NEXO_TOXIPROXY_URL=http://127.0.0.1:8474`.
Mantenga ese port-forward accesible hasta después del plazo de reversión;
si desaparece, `restore` deja el bloqueo de seguridad hasta recuperar el
acceso. Verifique el contexto y los recursos con S2-k8s antes del primer
ensayo con efectos.

Los experimentos no contienen datos personales ni secretos. **No suba a Git
registros reales con datos de clientes**; la evidencia del laboratorio debe
usar solo identificadores sintéticos.
